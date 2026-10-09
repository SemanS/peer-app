// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - a local socket for agents' hooks and CLI, and its sync timer.
/**
 * CoordinationBroker — the local end of coordination. Agents' hooks and the
 * `peer` CLI talk to it over a Unix socket only this user can open. It keeps
 * the agent sessions of this computer and reports them to the hub. Before an
 * agent changes a file the hub decides, recording its claim and the overlaps
 * in the same step, so the first edits of one file on two computers cannot
 * both pass; within its deadline, or by an explicit fallback. A hub without
 * that leaves the decision to the last view, as it was. Every event goes to
 * a JSON-lines log, so a run can be read back exactly.
 *
 * The class holds the broker's state, its lifecycle and what core reads of it. Its work lives in a
 * module per part, as functions run on the broker (`this`), listed at the end of the class.
 *
 * @module peerHub/core/broker/Broker
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { coordinationScripts } from "../adapters/scripts.ts";
import * as ContextCli from "../contexts/contextCli.ts";
import * as Contexts from "../contexts/contexts.ts";
import * as Findings from "../contexts/findings.ts";
import type { PeerAdvice } from "../coordination/PeerAgents.ts";
import type { CoordinationView } from "../coordination/edits.ts";
import { closerOf, settleAskedAt } from "../coordination/news.ts";
import * as Overlaps from "../coordination/overlaps.ts";
import type {
  HubContext,
  HubCoordSession,
  HubCoordView,
  HubFinding,
  HubOverlap,
} from "../hub/coordApi.ts";
import type { PeerIndexWork } from "../index/PeerIndex.ts";
import * as Board from "../index/board.ts";
import type { PeerSessionView } from "../plugin.ts";
import * as Cli from "./cli.ts";
import * as Delivery from "./delivery.ts";
import * as Hooks from "./hooks.ts";
import type { PeerBrokerHost } from "./host.ts";
import * as Log from "./log.ts";
import * as Server from "./server.ts";
import * as Sessions from "./sessions.ts";
import * as Sync from "./sync.ts";
import * as Wake from "./wake.ts";

export class CoordinationBroker {
  readonly creatingSessions = new Map<string, Promise<Sessions.LocalSession | null>>();
  server: NodeHttp.Server | null = null;
  timer: ReturnType<typeof setInterval> | null = null;
  readonly sessions = new Map<string, Sessions.LocalSession>();
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
  readonly announcedToPeople = new Set<string>();
  readonly waiters = new Set<Wake.Waiter>();
  /** Codex sessions Peer is handing a note to through Codex now. */
  readonly queueing = new Set<string>();
  /** Copies of the project's other works' contexts being made, per workspace. */
  readonly boardMirroring = new Map<string, Promise<void>>();
  /** Ends plugins' commands still running when the broker stops (a model a `peer find` asked). */
  readonly stopping = new AbortController();
  /** Who hears that a workspace's view changed (`PeerAgents.viewChanges`). */
  readonly viewListeners = new Set<(workspace: string) => void>();
  /** The `git status` runs in flight, by repository. */
  readonly gitRuns = new Map<string, Promise<string>>();
  readonly ignoredCwds = new Map<string, number>();
  /** Shared contexts of the work this computer's agents are on, by `sharedKey`. */
  readonly shared = new Map<string, Contexts.SharedMirror>();
  readonly claimedAt = new Map<string, number>();
  lastCli: { readonly session: string; readonly at: number } | null = null;
  dirtySince: number | null = null;
  lastSync = 0;
  syncing: Promise<void> | null = null;
  /** The round waking idle agents now, and whether another was asked for meanwhile. */
  waking: Promise<void> | null = null;
  wakeAgain = false;
  logQueue: Promise<void> = Promise.resolve();
  /** What agents are told to type; their Bash hook points it at the script. */
  readonly cli = "peer";
  readonly scripts: { readonly hook: string; readonly wait: string; readonly peer: string };
  readonly host: PeerBrokerHost;

  constructor(host: PeerBrokerHost) {
    this.host = host;
    this.scripts = {
      hook: NodePath.join(host.scriptsDir, "hook"),
      wait: NodePath.join(host.scriptsDir, "wait"),
      // In a directory of its own: a session's PATH gets it and nothing else.
      peer: NodePath.join(host.scriptsDir, "bin", "peer"),
    };
  }

  async start(): Promise<void> {
    if (this.server !== null) return;
    const binDir = NodePath.dirname(this.scripts.peer);
    await NodeFSP.mkdir(binDir, { recursive: true });
    const texts = coordinationScripts(
      this.host.socketPath,
      binDir,
      Cli.longerWaits(await this.plugins()),
    );
    for (const [name, text] of Object.entries(texts)) {
      const path = this.scripts[name as keyof typeof texts];
      await NodeFSP.writeFile(path, text, { mode: 0o755 });
      await NodeFSP.chmod(path, 0o755);
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
    this.timer = setInterval(() => void this.tick(), 500);
    this.log("broker.started", { socket: this.host.socketPath, policy: this.host.policy() });
    void this.forgetOldContexts();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopping.abort();
    for (const waiter of this.waiters) waiter.answer("");
    this.waiters.clear();
    // The next agent on their work keeps what this computer's agents kept (the hub hands it
    // over anyway once their sessions stop reporting, so an unreachable hub does not hold this up).
    await Promise.race([
      Promise.all([...this.sessions.values()].map((session) => this.release(session))),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    // Tell the hub this computer's agents are no longer coordinated.
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
    await NodeFSP.rm(this.host.socketPath, { force: true });
    this.log("broker.stopped", {});
    await this.logQueue;
  }

  snapshot(): {
    readonly sessions: ReadonlyArray<
      HubCoordSession & { readonly workspace: string; readonly local: boolean }
    >;
    readonly overlaps: ReadonlyArray<
      HubOverlap & {
        readonly workspace: string;
        /** The agent session that closes it once its agents agree. */
        readonly closer: string | undefined;
        /** When a person asked its agents to settle it, unless an agent wrote since. */
        readonly askedAt: string | undefined;
      }
    >;
    readonly findings: ReadonlyArray<HubFinding & { readonly workspace: string }>;
    readonly contexts: ReadonlyArray<HubContext & { readonly workspace: string }>;
    /** What Peer told this computer's agents, newest first. */
    readonly advice: ReadonlyArray<
      Omit<Sessions.Advice, "at"> & {
        readonly workspace: string;
        readonly project: string;
        readonly session: string;
        readonly at: string;
      }
    >;
  } {
    const sessions = [];
    const overlaps = [];
    const findings = [];
    const contexts = [];
    const advice = [...this.sessions.values()]
      .flatMap((session) =>
        session.advice.map((entry) => ({
          ...entry,
          workspace: session.workspace,
          project: session.project,
          session: session.id,
          at: new Date(entry.at).toISOString(),
        })),
      )
      .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 100);
    for (const [workspace, view] of this.views) {
      const merged = this.merged(workspace, view);
      for (const session of merged.sessions) {
        sessions.push({ ...session, workspace, local: this.sessions.has(session.id) });
      }
      for (const overlap of view.overlaps) {
        overlaps.push({
          ...overlap,
          workspace,
          closer: closerOf(overlap, merged.sessions),
          askedAt: settleAskedAt(overlap.notes),
        });
      }
      for (const finding of view.findings ?? []) findings.push({ ...finding, workspace });
      for (const context of view.contexts ?? []) contexts.push({ ...context, workspace });
    }
    return { sessions, overlaps, findings, contexts, advice };
  }

  /** Runtime labels require a live adapter handshake; the runtime alone reports after an action. */
  coordinationLevel(nativeId: string): "A" | "B" | "C" {
    const session = this.sessions.get(nativeId);
    if (session === undefined) return "C";
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

  /** Each workspace's view as the hub last sent it, with what its features add (knowledge's candidates). */
  hubViews(): ReadonlyArray<{ readonly workspace: string; readonly view: HubCoordView }> {
    return [...this.views].map(([workspace, view]) => ({ workspace, view }));
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

  /** A session claims `path` (last, should it hold it already); the hub hears at the next sync. */
  claimFor(sessionId: string, path: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    session.claims = [...session.claims.filter((claim) => claim !== path), path];
    this.markDirty();
  }

  /** A session gives up its claim on `path`; the hub hears at the next sync. */
  releaseFor(sessionId: string, path: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    session.claims = session.claims.filter((claim) => claim !== path);
    this.markDirty();
  }

  /**
   * A session's note on one of its overlaps, under `op`: the hub adds no second note for it. Having
   * posted there, the session need not again before it edits the overlap's files.
   */
  async noteFor(sessionId: string, overlapId: string, text: string, op: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    const updated = await this.host.note(
      session.workspace,
      session.project,
      overlapId,
      text,
      session.id,
      op,
    );
    this.applyOverlap(session.workspace, updated);
    this.acknowledge(session, updated);
  }

  /** Reports and refreshes a workspace now, waiting at most `budgetMs`. */
  syncWithin(workspace: string, budgetMs: number): Promise<void> {
    return this.syncNow(workspace, budgetMs);
  }

  /** Reports and refreshes a workspace now, waiting until it is done however long that takes. */
  reportNow(workspace: string): Promise<void> {
    return this.sync(workspace);
  }

  /** Notes for people in Peer what a session did with the team's work or knowledge. */
  adviseOn(sessionId: string, advice: PeerAdvice): void {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) this.noteAdvice(session, { ...advice, at: Date.now() });
  }

  /** A line in the coordination log. */
  logEvent(event: string, fields: Readonly<Record<string, unknown>>): void {
    this.log(event, fields);
  }

  /** The other works on a session's project, those with agents at work on them first. */
  worksFor(sessionId: string): ReadonlyArray<PeerIndexWork> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return [];
    return this.works(session)
      .toSorted(Board.byActivity)
      .map(({ entry, labels, text }) => ({
        scope: entry.scope,
        handle: entry.handle,
        name: entry.name,
        agents: entry.agents,
        gist: entry.gist,
        labels,
        text,
      }));
  }

  // ---- the broker's work, by part: each is a function of its module, run on this broker ----

  // The log (log.ts).
  log = Log.log;

  // Agent sessions (sessions.ts).
  nameOf = Sessions.nameOf;
  asHub = Sessions.asHub;
  sessionView = Sessions.sessionView;
  merged = Sessions.merged;
  sessionFor = Sessions.sessionFor;
  createSession = Sessions.createSession;
  paneOf = Sessions.paneOf;
  touch = Sessions.touch;
  markDirty = Sessions.markDirty;
  me = Sessions.me;
  holder = Sessions.holder;
  taskFor = Sessions.taskFor;
  findThread = Sessions.findThread;
  runtimeOf = Sessions.runtimeOf;
  statusWithin = Sessions.statusWithin;
  baselineOf = Sessions.baselineOf;
  readShellChanges = Sessions.readShellChanges;
  editedPaths = Sessions.editedPaths;
  samePath = Sessions.samePath;

  // Hooks (hooks.ts).
  hookInTime = Hooks.hookInTime;
  unverifiedTool = Hooks.unverifiedTool;
  hook = Hooks.hook;
  answerHook = Hooks.answerHook;
  pipelineStep = Hooks.pipelineStep;
  toolContext = Hooks.toolContext;
  pluginsOwn = Hooks.pluginsOwn;
  isPeerWork = Hooks.isPeerWork;
  beforeShell = Hooks.beforeShell;
  handoffRefusal = Hooks.handoffRefusal;
  shellVerdicts = Hooks.shellVerdicts;

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

  // Syncing with the Hub (sync.ts).
  plugins = Sync.plugins;
  reportFor = Sync.reportFor;
  report = Sync.report;
  syncNow = Sync.syncNow;
  sync = Sync.sync;
  tick = Sync.tick;
  applyOverlap = Sync.applyOverlap;
  afterViewChange = Sync.afterViewChange;
  notifyPeople = Sync.notifyPeople;

  // The socket (server.ts).
  route = Server.route;

  // The `peer` command (cli.ts).
  callerOf = Cli.callerOf;
  runCli = Cli.runCli;
  help = Cli.help;

  // Overlaps and intent (../coordination/overlaps.ts).
  personNote = Overlaps.personNote;
  personResolve = Overlaps.personResolve;
  personSettle = Overlaps.personSettle;
  agentName = Overlaps.agentName;
  beforeTool = Overlaps.beforeTool;
  settlePluginAsks = Overlaps.settlePluginAsks;
  decideEdits = Overlaps.decideEdits;
  viewAnswers = Overlaps.viewAnswers;
  askHub = Overlaps.askHub;
  mergeIntent = Overlaps.mergeIntent;
  ackOverlap = Overlaps.ackOverlap;
  settle = Overlaps.settle;
  decide = Overlaps.decide;
  settleNews = Overlaps.settleNews;
  acknowledge = Overlaps.acknowledge;
  announce = Overlaps.announce;
  markSeen = Overlaps.markSeen;

  // Working and shared contexts (../contexts/contexts.ts).
  restoreContext = Contexts.restoreContext;
  forgetOldContexts = Contexts.forgetOldContexts;
  readTeamLines = Contexts.readTeamLines;
  nudge = Contexts.nudge;
  checkpointPrivate = Contexts.checkpointPrivate;
  keptBy = Contexts.keptBy;
  sharedKey = Contexts.sharedKey;
  mirrorOf = Contexts.mirrorOf;
  sharedOf = Contexts.sharedOf;
  keeperOf = Contexts.keeperOf;
  agentsOn = Contexts.agentsOn;
  mirror = Contexts.mirror;
  writeMirror = Contexts.writeMirror;
  stash = Contexts.stash;
  takeUp = Contexts.takeUp;
  keep = Contexts.keep;
  read = Contexts.read;
  release = Contexts.release;
  saveShared = Contexts.saveShared;
  pushShared = Contexts.pushShared;
  pushNow = Contexts.pushNow;
  followShared = Contexts.followShared;

  // What an agent hears of its team's work (../contexts/findings.ts).
  findingsOf = Findings.findingsOf;
  findingNews = Findings.findingNews;
  closeNews = Findings.closeNews;
  rosterNews = Findings.rosterNews;
  sharedNews = Findings.sharedNews;

  // `peer context` and followed reads (../contexts/contextCli.ts).
  contextCli = ContextCli.contextCli;
  requestedFindings = ContextCli.requestedFindings;
  markRead = ContextCli.markRead;
  followedNews = ContextCli.followedNews;

  // The board and the index (../index/board.ts).
  taskNamer = Board.taskNamer;
  subjectOf = Board.subjectOf;
  handleOf = Board.handleOf;
  scopeNamed = Board.scopeNamed;
  boardAgent = Board.boardAgent;
  works = Board.works;
  board = Board.board;
  indexWorks = Board.indexWorks;
  advise = Board.advise;
  noteAdvice = Board.noteAdvice;
  discoveryFor = Board.discoveryFor;
  indexOf = Board.indexOf;
  indexSection = Board.indexSection;
  contextPointer = Board.contextPointer;
  mirrorBoard = Board.mirrorBoard;
  copyBoard = Board.copyBoard;
}
