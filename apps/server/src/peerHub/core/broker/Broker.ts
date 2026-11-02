// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - a local socket for agents' hooks and CLI, and its sync timer.
/**
 * CoordinationBroker — the local end of coordination. Agents' hooks and the
 * `peer` CLI talk to it over a Unix socket only this user can open. It keeps
 * the agent sessions of this computer and reports them to the hub. Before an
 * agent changes a file the hub hears of it, recording its claim and the
 * overlaps in the same step, so the first edits of one file on two computers
 * hear of each other; the agent goes on whatever the hub answers, or if it
 * answers nothing. Every event goes to a JSON-lines log, so a run can be read
 * back exactly.
 *
 * The class holds the broker's state, its lifecycle and what core reads of it. Its work lives in a
 * module per part, as functions run on the broker (`this`), listed at the end of the class.
 *
 * @module peerHub/core/broker/Broker
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { coordinationRepository } from "../localCoordination/localPlace.ts";
import { PeerHubError } from "@t3tools/contracts";

import { coordinationScripts } from "../adapters/scripts.ts";
import type { CoordinationView } from "../coordination/edits.ts";
import * as Overlaps from "../coordination/overlaps.ts";
import type { HubCoordSession, HubCoordView, HubOverlap } from "../hub/coordApi.ts";
import * as Board from "../index/board.ts";
import type { PeerSessionView } from "../plugin.ts";
import * as Cli from "./cli.ts";
import * as Delivery from "./delivery.ts";
import * as Hooks from "./hooks.ts";
import type { PeerBrokerHost } from "./host.ts";
import * as Landing from "./landing.ts";
import * as Log from "./log.ts";
import * as Owner from "./owner.ts";
import * as Runs from "./runs.ts";
import * as Server from "./server.ts";
import * as SessionMemory from "./sessionMemory.ts";
import { companionAt } from "./companions.ts";
import * as Sessions from "./sessions.ts";
import * as Sync from "./sync.ts";
import * as Wake from "./wake.ts";
import * as ToolSessions from "./toolSessions.ts";

export class CoordinationBroker {
  readonly creatingSessions = new Map<string, Promise<Sessions.LocalSession | null>>();
  checkoutRevision = 0;
  readonly checkoutChanges = new Map<string, Promise<void>>();

  async reconcileAcceptedWake(session: Sessions.LocalSession): Promise<void> {
    const accepted = this.acceptedWakes.get(session.id);
    if (
      accepted === undefined ||
      this.queueing.has(session.id) ||
      session.thread === undefined ||
      this.host.nativeWakePending === undefined
    )
      return;
    const pending = await this.host.nativeWakePending(session.id, session.thread).catch(() => true);
    if (
      !pending &&
      this.acceptedWakes.get(session.id) === accepted &&
      !this.queueing.has(session.id)
    ) {
      this.acceptedWakes.delete(session.id);
      this.dormantSessions.delete(session.id);
    }
  }

  async beginCheckoutChange(root: string): Promise<() => void> {
    const key = NodePath.resolve(root);
    const refused = () =>
      new PeerHubError({
        detail:
          "End the active agent runtimes in this repository before changing its team binding, then try again.",
        refused: true,
      });
    if (this.checkoutChanges.has(key)) throw refused();
    this.checkoutRevision += 1;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.checkoutChanges.set(key, done);
    const release = () => {
      this.checkoutChanges.delete(key);
      finish();
    };
    try {
      const target = await coordinationRepository(root);
      for (const session of [...this.sessions.values(), ...this.dormantSessions.values()]) {
        await this.reconcileAcceptedWake(session);
        if (
          !this.sessions.has(session.id) &&
          !this.queueing.has(session.id) &&
          !this.acceptedWakes.has(session.id)
        )
          continue;
        if (NodePath.resolve(session.root) === key) throw refused();
        if (
          target !== null &&
          (await coordinationRepository(session.root))?.identity === target.identity
        )
          throw refused();
      }
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  server: NodeHttp.Server | null = null;
  timer: ReturnType<typeof setInterval> | null = null;
  readonly sessions = new Map<string, Sessions.LocalSession>();
  /** Delivery memory for idle-released native conversations; never reported as live agents. */
  readonly dormantSessions = new Map<string, Sessions.LocalSession>();
  /** Accepted delivery deltas a concurrent native start must retain when it installs its session. */
  readonly acceptedWakes = new Map<string, (session: Sessions.LocalSession) => void>();
  readonly views = new Map<string, HubCoordView>();
  readonly viewAt = new Map<string, number>();
  readonly reported = new Set<string>();
  /** The sessions of this computer each workspace's hub last heard in a report. */
  readonly reportedSessions = new Map<string, ReadonlySet<string>>();
  /**
   * Where the hub answered 404 or 405 to `intent` (a hub without it), until when (epoch ms): each edit
   * would pay a 404 to learn it again. By project: a hub that has it answers 404 for a project it
   * does not know, which must not stop the workspace's other projects from asking.
   */
  readonly intentUnsupportedUntil = new Map<string, number>();
  readonly intentLegacyLogged = new Set<string>();
  readonly waiters = new Set<Wake.Waiter>();
  /** Codex sessions Peer is handing a note to through Codex now. */
  readonly queueing = new Set<string>();
  /** How often a runtime refused to wake a session whose news waits in `pending`. */
  readonly wakesRefused = new Map<string, number>();
  /** Ends plugins' commands still running when the broker stops. */
  readonly stopping = new AbortController();
  /** Who hears that a workspace's view changed (`PeerAgents.viewChanges`). */
  readonly viewListeners = new Set<(workspace: string) => void>();
  /** The `git status` runs in flight, by repository. */
  readonly gitRuns = new Map<string, Promise<string | null>>();
  readonly ignoredCwds = new Map<string, number>();
  dirtySince: number | null = null;
  lastSync = 0;
  syncing: Promise<void> | null = null;
  /** The round waking idle agents now, and whether another was asked for meanwhile. */
  waking: Promise<void> | null = null;
  wakeAgain = false;
  /** The round writing what sessions were told to disk (`sessionMemory.ts`), while one runs. */
  savingMemories: Promise<void> | null = null;
  /** What agents are told to type; their Bash hook points it at the script. */
  readonly cli = "peer";
  readonly scripts: { readonly hook: string; readonly wait: string; readonly peer: string };
  readonly host: PeerBrokerHost;
  /** Whose broker this is, and who hears that it stopped for another (`owner.ts`). */
  readonly kind: Owner.PeerBrokerKindValue;
  readonly onHandover: (() => void) | undefined;
  readonly ownerPath: string;
  owner: Owner.Owner | null = null;
  stopped: Promise<void> | null = null;
  /** Stops hearing runs end (`runEnded`). */
  stopRunEnds: (() => void) | null = null;

  constructor(
    host: PeerBrokerHost,
    options: {
      readonly kind?: Owner.PeerBrokerKindValue;
      readonly onHandover?: () => void;
    } = {},
  ) {
    this.host = host;
    this.kind = options.kind ?? "app";
    this.onHandover = options.onHandover;
    this.ownerPath = NodePath.join(host.scriptsDir, "owner.json");
    this.scripts = {
      hook: NodePath.join(host.scriptsDir, "hook"),
      wait: NodePath.join(host.scriptsDir, "wait"),
      // In a directory of its own: a session's PATH gets it and nothing else.
      peer: NodePath.join(host.scriptsDir, "bin", "peer"),
    };
  }

  async start(): Promise<void> {
    if (this.server !== null) return;
    await this.takeOver();
    this.stopped = null;
    const binDir = NodePath.dirname(this.scripts.peer);
    await NodeFSP.mkdir(binDir, { recursive: true });
    const texts = coordinationScripts(
      this.host.socketPath,
      binDir,
      Cli.longerWaits(await this.plugins()),
      Owner.coreLaunchCommand(NodePath.resolve(binDir, "..", "..")),
    );
    for (const [name, text] of Object.entries(texts)) {
      const path = this.scripts[name as keyof typeof texts];
      const temporary = `${path}.${process.pid}.tmp`;
      await NodeFSP.writeFile(temporary, text, { mode: 0o755 });
      await NodeFSP.chmod(temporary, 0o755);
      await NodeFSP.rename(temporary, path);
    }
    // Where `peer` lived before it had a directory of its own.
    await NodeFSP.rm(NodePath.join(this.host.scriptsDir, "peer"), { force: true });
    await NodeFSP.mkdir(NodePath.dirname(this.host.socketPath), { recursive: true });
    await NodeFSP.rm(this.host.socketPath, { force: true });
    const server = NodeHttp.createServer((request, response) => {
      void this.route(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.host.socketPath, () => resolve());
    });
    // Only this user's processes may talk to it.
    await NodeFSP.chmod(this.host.socketPath, 0o600);
    this.server = server;
    this.owner = { kind: this.kind, pid: process.pid, startedAt: new Date().toISOString() };
    await Owner.writeOwner(this.ownerPath, this.owner);
    // A run whose live session no broker holds now lost it in a crash (design D5).
    await this.host.runs?.recover(new Set(this.sessions.keys())).catch(() => undefined);
    this.stopRunEnds = this.host.runs?.onEnded((run) => this.runEnded(run.id)) ?? null;
    this.timer = setInterval(() => void this.tick(), 500);
    this.record("broker.started", { socket: this.host.socketPath });
    void this.forgetOldMemories();
  }

  /**
   * One broker per computer: Peer Core refuses to start beside a live broker; the app asks a live
   * Peer Core to hand over and waits for its socket to go. A dead owner is replaced as before.
   */
  async takeOver(): Promise<void> {
    const live = await Owner.readOwnerAt(this.ownerPath, this.host.socketPath);
    if (live === null || live.pid === process.pid) return;
    if (this.kind === "peer-core") {
      throw new PeerHubError({
        detail: `Peer coordination already runs on this computer: ${live.kind === "app" ? "the Peer app" : "Peer Core"}${live.pid > 0 ? `, pid ${live.pid}` : ""}.`,
        refused: true,
      });
    }
    if (live.kind !== "peer-core") return;
    this.record("broker.takeover", { from: live.kind, pid: live.pid });
    if (await Owner.requestHandover(this.host.socketPath))
      await Owner.waitForSocketGone(this.host.socketPath, 10_000);
  }

  /** Another broker takes over (`POST /owner/handover`): stop, then say so. */
  async handOver(): Promise<void> {
    this.record("broker.handover", {});
    await this.stop();
    this.onHandover?.();
  }

  stop(): Promise<void> {
    this.stopped ??= this.stopOnce();
    return this.stopped;
  }

  private async stopOnce(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopping.abort();
    for (const waiter of this.waiters) waiter.answer("");
    this.waiters.clear();
    // What its agents were told stays theirs for when Peer starts again.
    await this.saveMemories();
    this.dormantSessions.clear();
    // Tell the hub this computer's agents are no longer coordinated; their runs stay, detached.
    this.stopRunEnds?.();
    for (const session of this.sessions.values()) this.leaveRun(session);
    await this.host.runs?.flushed();
    this.sessions.clear();
    const plugins = await this.plugins();
    for (const workspace of this.reported) {
      await this.report(plugins, workspace, []).catch(() => undefined);
    }
    this.reported.clear();
    const server = this.server;
    this.server = null;
    if (server !== null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
    }
    if (this.owner !== null) await Owner.removeOwner(this.ownerPath).catch(() => undefined);
    this.owner = null;
    await NodeFSP.rm(this.host.socketPath, { force: true });
    this.record("broker.stopped", {});
    await this.host.log.idle();
  }

  snapshot(): {
    readonly sessions: ReadonlyArray<
      HubCoordSession & { readonly workspace: string; readonly local: boolean }
    >;
    readonly overlaps: ReadonlyArray<HubOverlap & { readonly workspace: string }>;
  } {
    const sessions = [];
    const overlaps = [];
    for (const [workspace, view] of this.views) {
      for (const session of this.merged(workspace, view).sessions) {
        sessions.push({ ...session, workspace, local: this.sessions.has(session.id) });
      }
      for (const overlap of view.overlaps) overlaps.push({ ...overlap, workspace });
    }
    return { sessions, overlaps };
  }

  /** Runtime labels require a live adapter handshake; the runtime alone reports after an action. */
  coordinationLevel(nativeId: string): "A" | "B" | "C" {
    const session = this.sessions.get(nativeId);
    if (session === undefined) return "C";
    if (session.adapter === "mcp") return "C";
    return session.modAt !== undefined && Date.now() - session.modAt < 180_000 ? "A" : "B";
  }

  /** The agent session most recently active in a herdr pane, as its hooks reported it. */
  sessionInPane(
    pane: string,
  ): { readonly id: string; readonly path: string | undefined } | undefined {
    let latest: Sessions.LocalSession | undefined;
    for (const session of this.sessions.values()) {
      if (session.pane !== pane) continue;
      if (latest === undefined || session.lastActivity > latest.lastActivity) latest = session;
    }
    return latest === undefined
      ? undefined
      : { id: latest.id.slice(latest.agent.length + 1), path: latest.transcript };
  }

  /** The hub says a workspace's coordination changed: read it within a moment. */
  hubChanged(): void {
    this.dirtySince ??= Date.now();
  }

  /** This computer's sessions as plugins see them. */
  sessionViews(): ReadonlyArray<PeerSessionView> {
    return [...this.sessions.values()].map((session) => this.sessionView(session));
  }

  /** A workspace's coordination: the hub's view with this computer's sessions as they are now. */
  viewOf(workspace: string): CoordinationView {
    return this.merged(workspace, this.views.get(workspace));
  }

  /** Calls `listener` with each workspace whose view changed, until the returned stop is called. */
  onViewChange(listener: (workspace: string) => void): () => void {
    this.viewListeners.add(listener);
    return () => void this.viewListeners.delete(listener);
  }

  /** Reports and refreshes a workspace now, waiting at most `budgetMs`. */
  syncWithin(workspace: string, budgetMs: number): Promise<void> {
    return this.syncNow(workspace, budgetMs);
  }

  /** Reports and refreshes a workspace now, waiting until it is done however long that takes. */
  reportNow(workspace: string): Promise<void> {
    return this.sync(workspace);
  }

  /** A line in the coordination log. */
  logEvent(event: string, fields: Readonly<Record<string, unknown>>): void {
    this.record(event, fields);
  }

  // The log (log.ts).
  record = Log.record;

  // Agent sessions (sessions.ts).
  nameOf = Sessions.nameOf;
  asHub = Sessions.asHub;
  sessionView = Sessions.sessionView;
  merged = Sessions.merged;
  sessionFor = Sessions.sessionFor;
  companionAt = companionAt;
  createSession = Sessions.createSession;
  unplacedAnswer = Sessions.unplacedAnswer;
  paneOf = Sessions.paneOf;
  touch = Sessions.touch;
  markDirty = Sessions.markDirty;
  me = Sessions.me;
  taskFor = Sessions.taskFor;
  findThread = Sessions.findThread;
  retireSuperseded = Sessions.retireSuperseded;
  restoreMemory = SessionMemory.restoreMemory;
  saveMemories = SessionMemory.saveMemories;
  forgetOldMemories = SessionMemory.forgetOldMemories;
  runtimeOf = Sessions.runtimeOf;
  statusWithin = Sessions.statusWithin;
  baselineOf = Sessions.baselineOf;
  readShellChanges = Sessions.readShellChanges;
  editedPaths = Sessions.editedPaths;
  samePath = Sessions.samePath;

  // Runs (runs.ts).
  planRun = Runs.planRun;
  memoryPathFor = Runs.memoryPathFor;
  enterRun = Runs.enterRun;
  adoptRun = Runs.adoptRun;
  openRoom = Runs.openRoom;
  attachRun = Runs.attachRun;
  runTask = Runs.runTask;
  leaveRun = Runs.leaveRun;
  runEnded = Runs.runEnded;
  withRunNotice = Runs.withRunNotice;
  runsRoute = Runs.runsRoute;
  runCommand = Runs.runCommand;

  // Hooks (hooks.ts).
  hookInTime = Hooks.hookInTime;
  unverifiedTool = Hooks.unverifiedTool;
  hook = Hooks.hook;
  answerHook = Hooks.answerHook;
  pipelineStep = Hooks.pipelineStep;
  toolContext = Hooks.toolContext;
  isPeerWork = Hooks.isPeerWork;
  beforeShell = Hooks.beforeShell;
  shellVerdicts = Hooks.shellVerdicts;

  // Nothing lands unread (landing.ts).
  landingMessages = Landing.landingMessages;
  landingStop = Landing.landingStop;

  // What reaches an agent (delivery.ts).
  startContextFor = Delivery.startContextFor;
  startedContext = Delivery.startedContext;
  news = Delivery.news;
  newsContext = Delivery.newsContext;
  modReport = Delivery.modReport;

  // Waking idle agents (wake.ts).
  wait = Wake.wait;
  wakingNews = Wake.wakingNews;
  wakeWaiters = Wake.wakeWaiters;
  wakeIdle = Wake.wakeIdle;
  wakeCodex = Wake.wakeCodex;
  wakeRuntime = Wake.wakeRuntime;
  wakeDormant = Wake.wakeDormant;

  // Syncing with the Hub (sync.ts).
  plugins = Sync.plugins;
  reportFor = Sync.reportFor;
  report = Sync.report;
  syncNow = Sync.syncNow;
  sync = Sync.sync;
  tick = Sync.tick;
  afterViewChange = Sync.afterViewChange;
  notifyPeople = Sync.notifyPeople;

  // The socket (server.ts).
  route = Server.route;

  // The `peer` command (cli.ts).
  callerOf = Cli.callerOf;
  runCli = Cli.runCli;
  localRuntimeAgents = ToolSessions.localRuntimeAgents;
  bindTools = ToolSessions.bindTools;
  callTools = ToolSessions.callTools;
  endTools = ToolSessions.endTools;
  help = Cli.help;

  // Overlaps and intent (../coordination/overlaps.ts).
  beforeTool = Overlaps.beforeTool;
  settlePluginAsks = Overlaps.settlePluginAsks;
  decideEdits = Overlaps.decideEdits;
  askHub = Overlaps.askHub;
  mergeIntent = Overlaps.mergeIntent;
  settle = Overlaps.settle;
  announce = Overlaps.announce;
  markSeen = Overlaps.markSeen;

  // The board (../index/board.ts).
  taskNamer = Board.taskNamer;
  taskNamed = Board.taskNamed;
  boardAgent = Board.boardAgent;
  board = Board.board;
}
