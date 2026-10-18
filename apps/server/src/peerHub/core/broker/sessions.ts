import { discoveryKey } from "../index/text.ts";
// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off globalDate:off - agents' sessions in this computer's checkouts, durable runtime generations, and wall-clock activity.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The agent sessions of this computer: what the broker keeps of each, finding or creating one
 * when its first hook comes, how the Hub and plugins see it, and what git says it changed.
 *
 * @module peerHub/core/broker/sessions
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { PeerPluginId, PeerWorkStatus } from "@t3tools/contracts";

import type { ContextHolder, WorkAgent } from "../contexts/text.ts";
import {
  AGENT_NAMES,
  type AgentKind,
  changedPaths,
  type CoordinationView,
  editedFiles,
  emptyMemory,
  repositoryPath,
  type SessionMemory,
} from "../coordination/edits.ts";
import type { HubCoordSession, HubCoordView } from "../hub/coordApi.ts";
import type { CommandsOn } from "../index/text.ts";
import type { PeerIndexEntry, PeerRuntimeProvider, PeerSessionView } from "../plugin.ts";
import { checkoutKind } from "../vcs.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { sleepMs } from "./sync.ts";

export interface LocalSession {
  readonly id: string;
  credential: Buffer | undefined;
  runtimeGeneration: string;
  readonly repositoryId: string | undefined;
  /** The agent's harness, whose hooks report it: its id is `<agent>:<session id>`. */
  readonly agent: string;
  adapter?: "hooks" | "mcp";
  /** A published runtime key when its native session id is not yet available. */
  runtimeKey?: string;
  readonly workspace: string;
  readonly project: string;
  readonly root: string;
  cwd: string;
  pane: string | undefined;
  /** The transcript the agent's harness keeps for the session. */
  transcript: string | undefined;
  label: string;
  labelFromPrompt: boolean;
  branch: string | undefined;
  status: PeerWorkStatus;
  files: string[];
  claims: string[];
  /** Path intents sent to the Hub stay held there until the session leaves its report. */
  intentPaths?: Set<string>;
  intent: string | undefined;
  lastActivity: number;
  lastPresent?: number;
  readonly memory: SessionMemory;
  /** What its memory file holds (`sessionMemory.ts`), as last written or read back: `""` for none. */
  memoryFile: string;
  /** Its hooks being answered now: what they tell it has not reached it yet. */
  answering: number;
  /** Files whose edit its person was asked about, with what an approval settles: the edit happening means they approved. */
  readonly asked: Map<
    string,
    {
      readonly keys: ReadonlyArray<string>;
      readonly overlaps: ReadonlyArray<string>;
      readonly filesAt: ReadonlyMap<string, string | undefined>;
    }
  >;
  /** The file the agent keeps its own working context in. */
  readonly ownContextPath: string;
  /** The file it keeps now: its own, or its work's shared context while it keeps that. */
  contextPath: string;
  /** It keeps the shared context of its work (task, or no task). */
  keeps: boolean;
  /**
   * The shared context's version (and text) it last heard, or wrote on while keeping it. A session
   * Peer met again after a restart has the version from its memory file, and no text.
   */
  sharedHeard: number;
  sharedHeardText: string | undefined;
  sharedToldAt: number;
  /** What Peer tells it at its next step, e.g. that it keeps the shared context now. */
  readonly pending: Array<
    | string
    | {
        readonly text: string;
        readonly deliveries: ReadonlyArray<import("./pipeline.ts").PreparedDelivery>;
        readonly first?: boolean | undefined;
      }
  >;
  /** Its SessionStart is being answered, which settles who keeps its work's context itself. */
  starting: boolean;
  /** Who it last heard is on its work, while it keeps the shared context. */
  roster: ReadonlyArray<WorkAgent> | undefined;
  /** The size its kept context had when it was last told to compact it. */
  compactedAt: number;
  /** It was asked, as the keeper of a closed task, to mark what the project should keep. */
  toldClosed: boolean;
  /** The files git saw changed in its repository when it last looked: changes after it are its. */
  dirty: Set<string>;
  /** Git said what was changed before the session started (a big repository may take longer than a hook waits). */
  dirtyKnown: boolean;
  /** The commit HEAD named when Peer last looked: commits on top of it made by its commands are its. */
  head: string | undefined;
  /** When its current shell command started; 0 when none runs. */
  shellAt: number;
  /** The lines it marked [project] in the shared context while keeping it: its findings. */
  readonly marked: Set<string>;
  /** Its "For the team" lines as last read: what it shares with the project. */
  team: ReadonlyArray<string>;
  readonly startedAt: number;
  /** When the agent last changed its working context, or when Peer created it. */
  contextAt: number;
  nudgedAt: number;
  /** The agent wrote its working context this session, or found one it had written before. */
  contextKept: boolean;
  /** It was reminded once, at its first change, that its working context was still empty. */
  remindedAtStart: boolean;
  task: string | undefined;
  /** The Peer thread it runs in (`peer:<thread id>`), once Peer found it. */
  thread: string | undefined;
  /** How often Peer looked for its thread: a thread's session id may be recorded after it starts. */
  threadTries: number;
  threadLastLookedAt?: number;
  /** Findings of other agents it has heard. */
  readonly heard: Set<string>;
  /** The other works whose shared context it read (`peer context`): what it read, to tell it when that changes. */
  readonly read: Map<string, ReadWork>;
  /** What the active plugins gave its index at its last step. */
  index: SessionIndex;
  /**
   * What the agent was told of each other work (`discoveryKey`), since its session started or its
   * context was compacted: it is not told twice, only what changed. And when an ask last carried
   * something, so a pause can be told from a flow of asks.
   */
  readonly told: Map<string, string>;
  askIndexAt: number;
  /** Its conversation started again since its memory file was written: the file forgets `told` too. */
  toldForgotten: boolean;
  /** The work whose shared context it kept when its memory file was written, read back after a restart. */
  keptBefore?: string | undefined;
  /** What Peer added to its context, in characters, by the hook that carried it. */
  readonly injected: Map<string, number>;
  modAt?: number;
  readonly modHandled: Map<string, number>;
  readonly deliveries: Map<
    string,
    {
      readonly text: string;
      readonly event: string;
      acknowledged: boolean;
      readonly refs?: ReadonlyArray<import("./pipeline.ts").PreparedDelivery>;
    }
  >;
  /** What it did with the team's work and knowledge, newest last: people see it in Peer. */
  readonly advice: Advice[];
  /** Plugins' own state for it (`PeerSessionView.local`); a new runtime generation drops it. */
  pluginState: Map<string, unknown>;
  /** What plugins told it (`PeerSessionView.told`): kept in its memory file, dropped with `pluginState`. */
  readonly pluginTold: Map<string, Set<string>>;
  /** Its runtime generation changed since its memory file was written: the file forgets `pluginTold`. */
  pluginsForgotten: boolean;
}

/**
 * What the active plugins give a session's index: the entries the index source (knowledge) has for
 * its checkout, and which plugin commands Peer's texts may name. Read before each step that may say
 * them, so the texts a step composes at once have them.
 */
export interface SessionIndex {
  readonly entries: ReadonlyArray<PeerIndexEntry>;
  readonly on: CommandsOn;
}

/** No index source and no plugin command, until a step reads what the plugins give. */
export const NO_INDEX: SessionIndex = { entries: [], on: () => false };

/**
 * A work's context as an agent read it, to tell it what changed there since. A session Peer met
 * again after a restart has the version from its memory file, and no text.
 */
export interface ReadWork {
  readonly version: number;
  readonly text: string | undefined;
  /** A change notice is not a read receipt: retain the exact input above until an explicit read. */
  notifiedVersion: number;
  /** When it was last told of a change, or read it. */
  toldAt: number;
}

/** What an agent did with the team's work and knowledge, or what Peer noted, for people to see in Peer. */
export interface Advice {
  readonly about: "work" | "knowledge";
  /** A work's scope, or `kx:<entry id>`. */
  readonly scope: string;
  readonly name: string;
  /** The agent read it, asked its agents, a model found it for it, or an entry governs files it changes. */
  readonly how: "read" | "asked" | "found" | "governs";
  readonly why: string;
  readonly entryKind?: string;
  readonly path?: string;
  readonly at: number;
}

export const MAX_FILES = 200;

/** How long a hook waits for git to say what changed: a hook must not wait on a big repository. */
const GIT_STATUS_MS = 1500;

/** A part of a path made of one id: no separators, no dots to climb with. */
export const safePart = (part: string) => part.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);

export function nameOf(this: CoordinationBroker, workspace: string) {
  return (email: string) => this.host.nameOf(workspace, email);
}

export function asHub(this: CoordinationBroker, session: LocalSession): HubCoordSession {
  return {
    id: session.id,
    runtimeGeneration: session.runtimeGeneration,
    project: session.project,
    email: this.host.email() ?? "",
    environment: this.host.environment,
    label: session.label,
    agent: session.agent,
    ...(session.task === undefined ? {} : { task: session.task }),
    ...(session.branch === undefined ? {} : { branch: session.branch }),
    status: session.status,
    ...(session.intent === undefined ? {} : { intent: session.intent }),
    files: session.files,
    claims: session.claims,
    seenAt: new Date(session.lastActivity).toISOString(),
    activeAt: new Date(session.lastActivity).toISOString(),
  };
}

/** A session as plugins see it. */
export function sessionView(this: CoordinationBroker, session: LocalSession): PeerSessionView {
  const pluginState = session.pluginState,
    mirror = this.mirrorOf(session);
  return {
    id: session.id,
    agent: session.agent,
    adapter: session.modAt === undefined ? (session.adapter ?? "hooks") : "mod",
    runtimeGeneration: session.runtimeGeneration,
    workspace: session.workspace,
    project: session.project,
    repositoryId: session.repositoryId,
    root: session.root,
    cwd: session.cwd,
    task: session.task,
    ...(session.branch ? { branch: session.branch } : {}),
    thread: session.thread,
    pane: session.pane,
    status: session.status,
    keeps: session.keeps,
    files: [...session.files],
    claims: [...session.claims],
    contextReads: [...session.read].flatMap(([scope, read]) =>
      read.text === undefined ? [] : [{ scope, version: read.version, text: read.text }],
    ),
    sharedContext:
      mirror === undefined
        ? null
        : { scope: mirror.scope, version: mirror.version, text: mirror.text },
    contextReadVersion: (scope) => session.read.get(scope)?.version,
    tellIndex: (scope) => {
      const entry = this.indexWorks(session, Number.POSITIVE_INFINITY).find(
        (entry) => entry.scope === scope,
      );
      if (entry) session.told.set(scope, discoveryKey(entry));
    },
    local: <S>(plugin: PeerPluginId, init: () => S): S => {
      if (!pluginState.has(plugin)) pluginState.set(plugin, init());
      return pluginState.get(plugin) as S;
    },
    told: (plugin) => {
      const told = session.pluginTold.get(plugin) ?? new Set<string>();
      session.pluginTold.set(plugin, told);
      return told;
    },
  };
}

/** The hub's view with this computer's sessions as they are now, not as last reported. */
export function merged(
  this: CoordinationBroker,
  workspace: string,
  view: HubCoordView | undefined,
): CoordinationView {
  const local = [...this.sessions.values()].filter((s) => s.workspace === workspace);
  const localIds = new Set(local.map((s) => s.id));
  return {
    sessions: [
      ...(view?.sessions ?? []).filter((s) => !localIds.has(s.id)),
      ...local.map((s) => this.asHub(s)),
    ],
    overlaps: view?.overlaps ?? [],
  };
}

export async function sessionFor(
  this: CoordinationBroker,
  agent: AgentKind,
  body: Record<string, unknown>,
  pane: string | undefined,
): Promise<LocalSession | null> {
  if (typeof body.session_id !== "string") return null;
  const id = `${agent}:${body.session_id}`;
  const existing = this.sessions.get(id);
  if (existing !== undefined) return existing;
  const creating = this.creatingSessions.get(id);
  if (creating !== undefined) return creating;
  const run = this.createSession(agent, body, pane).finally(() => this.creatingSessions.delete(id));
  this.creatingSessions.set(id, run);
  return run;
}

export async function createSession(
  this: CoordinationBroker,
  agent: string,
  body: Record<string, unknown>,
  pane: string | undefined,
  adapter: "hooks" | "mcp" = "hooks",
  explicitThread?: string,
): Promise<LocalSession | null> {
  const sid = typeof body.session_id === "string" ? body.session_id : null;
  if (sid === null) return null;
  const id = `${agent}:${sid}`;
  const existing = this.sessions.get(id);
  if (existing !== undefined) return existing;
  const cwd = typeof body.cwd === "string" ? body.cwd : null;
  if (cwd === null) return null;
  const ignoredAt = this.ignoredCwds.get(cwd);
  if (ignoredAt !== undefined && Date.now() - ignoredAt < 60_000) return null;
  const place = await this.host.placeOf(cwd);
  if (place === null) {
    this.ignoredCwds.set(cwd, Date.now());
    this.record("session.ignored", { session: id, cwd, why: "not in a workspace project" });
    return null;
  }
  const title = pane === undefined ? undefined : (await this.plugins()).runtime?.title(pane);
  const branch = await this.host.branchOf(place.root);
  // An agent Peer runs in a thread is on the task its thread was put on, whatever its branch.
  const thread = explicitThread ?? (await this.host.threadOf(sid).catch(() => undefined));
  const now = Date.now();
  const ownContextPath = NodePath.join(
    this.host.contextsDir,
    safePart(place.workspace),
    safePart(place.project),
    `${safePart(sid)}.md`,
  );
  const session: LocalSession = {
    id,
    credential: undefined,
    runtimeGeneration: NodeCrypto.randomUUID(),
    repositoryId: place.repositoryId,
    agent,
    adapter,
    workspace: place.workspace,
    project: place.project,
    root: place.root,
    cwd,
    pane,
    transcript: typeof body.transcript_path === "string" ? body.transcript_path : undefined,
    label: title ?? `${AGENT_NAMES[agent as AgentKind] ?? agent} session`,
    labelFromPrompt: false,
    branch,
    status: "idle",
    files: [],
    claims: [],
    intent: undefined,
    lastActivity: now,
    memory: emptyMemory(),
    memoryFile: "",
    answering: 0,
    asked: new Map(),
    ownContextPath,
    contextPath: ownContextPath,
    keeps: false,
    sharedHeard: 0,
    sharedHeardText: "",
    sharedToldAt: 0,
    pending: [],
    starting: false,
    roster: undefined,
    compactedAt: 0,
    toldClosed: false,
    // What was changed before it started is not its doing.
    ...(await this.baselineOf(place.root)),
    marked: new Set(),
    team: [],
    startedAt: now,
    contextAt: now,
    nudgedAt: 0,
    contextKept: false,
    remindedAtStart: false,
    task: this.host.taskOf(
      place.workspace,
      place.project,
      [...(thread === undefined ? [] : [thread]), `herdr:${agent}:${sid}`],
      [branch, title],
    ),
    thread,
    threadTries: 1,
    threadLastLookedAt: now,
    heard: new Set(),
    read: new Map(),
    index: NO_INDEX,
    told: new Map(),
    askIndexAt: 0,
    toldForgotten: false,
    injected: new Map(),
    modHandled: new Map(),
    deliveries: new Map(),
    advice: [],
    pluginState: new Map(),
    pluginTold: new Map(),
    pluginsForgotten: false,
  };
  // A session Peer meets again (Peer restarted, or the session outlived its TTL) keeps what
  // it shares: reporting it without its lines would take its findings back. Nor is it told
  // again what it heard.
  if (await this.retireSuperseded(session)) return null;
  await this.restoreContext(session);
  const remembered = await this.restoreMemory(session);
  this.sessions.set(id, session);
  this.record("session.started", {
    session: id,
    workspace: place.workspace,
    project: place.project,
    root: place.root,
    pane,
    branch: session.branch,
    thread,
    task: session.task,
    transcript: session.transcript,
    remembered,
  });
  return session;
}

/**
 * The runtime pane a hook came from (herdr's): Claude Code's say so; Codex's only when the runtime
 * agrees, as Codex may run its hooks in a shared server whose environment names another pane.
 */
export async function paneOf(
  this: CoordinationBroker,
  agent: AgentKind,
  body: Record<string, unknown>,
  named: string | undefined,
): Promise<string | undefined> {
  if (agent === "claude") return named;
  if (typeof body.cwd !== "string") return undefined;
  return (await this.plugins()).runtime?.pane(agent, body.cwd, named);
}

export function touch(this: CoordinationBroker, session: LocalSession) {
  session.lastActivity = Date.now();
  this.queueing.delete(session.id);
  // An agent at work again is no longer waiting to be woken.
  for (const waiter of this.waiters) {
    if (waiter.session === session.id) {
      this.waiters.delete(waiter);
      waiter.answer("");
    }
  }
}

export function markDirty(this: CoordinationBroker) {
  this.dirtySince ??= Date.now();
}

/** Who a session's agent is, as its teammates name it: "Ana's agent". */
export function me(this: CoordinationBroker, session: LocalSession) {
  const email = this.host.email();
  return email === null
    ? "your person's agent"
    : `${this.host.nameOf(session.workspace, email)}'s agent`;
}

export function holder(this: CoordinationBroker, session: LocalSession): ContextHolder {
  return {
    id: session.id,
    project: session.project,
    task: session.task,
    files: session.files,
    claims: session.claims,
  };
}

/**
 * The task a session works on now: the one its Peer thread or runtime agent was
 * put on, or the one its branch or its runtime's title names.
 */
export function taskFor(
  this: CoordinationBroker,
  session: LocalSession,
  runtime: PeerRuntimeProvider | undefined,
) {
  const title = session.pane === undefined ? undefined : runtime?.title(session.pane);
  return this.host.taskOf(
    session.workspace,
    session.project,
    [
      ...(session.thread === undefined ? [] : [session.thread]),
      session.runtimeKey ?? `herdr:${session.id}`,
    ],
    [session.branch, title],
  );
}

/** Looks for a session's Peer thread again: its native identity can arrive after the first hooks. */
export async function findThread(this: CoordinationBroker, session: LocalSession) {
  if (session.thread !== undefined) return;
  const now = Date.now();
  // Native identity may arrive after the first hooks. Continue looking, at a bounded rate.
  if (session.threadTries >= 6 && now - (session.threadLastLookedAt ?? 0) < 60_000) return;
  session.threadTries += 1;
  session.threadLastLookedAt = now;
  const thread = await this.host
    .threadOf(session.id.slice(session.agent.length + 1))
    .catch(() => undefined);
  if (thread === undefined) return;
  session.thread = thread;
  this.record("session.thread", { session: session.id, thread });
}

/** A known thread selected another provider session; its previous agent must not be woken. */
export async function retireSuperseded(this: CoordinationBroker, session: LocalSession) {
  if (session.thread === undefined || this.host.threadAgent === undefined) return false;
  const selected = await this.host.threadAgent(session.thread).catch(() => null);
  if (
    selected === null ||
    (selected.agent === session.agent &&
      (selected.nativeId === undefined || session.id === `${selected.agent}:${selected.nativeId}`))
  )
    return false;
  await this.release(session);
  this.sessions.delete(session.id);
  for (const waiter of this.waiters) {
    if (waiter.session !== session.id) continue;
    this.waiters.delete(waiter);
    waiter.answer("");
  }
  this.record("session.expired", { session: session.id });
  return true;
}

/**
 * How a session's runtime runs: its runtime plugin's word (herdr's), else what the last work report
 * saw of its Peer thread's provider runtime; null when nothing runs it, undefined when nobody
 * knows, which leaves its hooks' activity as the lease.
 */
export function runtimeOf(
  this: CoordinationBroker,
  runtime: PeerRuntimeProvider | undefined,
  session: LocalSession,
) {
  const said = runtime?.status(session.id, session.pane);
  if (said !== undefined) return said;
  if (session.thread !== undefined) return this.host.threadRuntime?.(session.thread, session.id);
  return session.pane === undefined ? undefined : null;
}

/**
 * What git says changed in a repository, or null when it does not say within `ms` (a big
 * repository) or fails (jj holding the index while it snapshots): either way it is read again at
 * the next step, never taken for "nothing changed". One run per repository at a time: a slow one is
 * waited for again, not stacked.
 */
export async function statusWithin(
  this: CoordinationBroker,
  root: string,
  ms: number,
): Promise<string | null> {
  let run = this.gitRuns.get(root);
  if (run === undefined) {
    run = this.host
      .gitStatus(root)
      .catch(() => {
        this.record("git.failed", { root });
        return null;
      })
      .finally(() => this.gitRuns.delete(root));
    this.gitRuns.set(root, run);
  }
  const status = await Promise.race([run, sleepMs(ms).then(() => undefined)]);
  if (status === undefined) this.record("git.slow", { root, ms });
  return status ?? null;
}

/** Why the session's checkout cannot be used under its version control (a jj too old), if so. */
export const unsupportedCheckout = (session: LocalSession): Promise<string | undefined> =>
  checkoutKind(session.root).then(
    (found) => (found?.kind === "jj-unsupported" ? found.reason : undefined),
    () => undefined,
  );

/** The files already changed in a repository as a session starts, and whether git said in time. */
export async function baselineOf(this: CoordinationBroker, root: string) {
  const [status, head] = await Promise.all([
    this.statusWithin(root, GIT_STATUS_MS),
    within(this.host.gitHead?.(root), GIT_STATUS_MS),
  ]);
  return {
    dirty: new Set(changedPaths(status ?? "")),
    dirtyKnown: status !== null,
    head,
    shellAt: 0,
  };
}

/** A git read that gives up after `ms`; undefined when it did not answer or the host has none. */
async function within<T>(read: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  if (read === undefined) return undefined;
  return Promise.race([read.catch(() => undefined), sleepMs(ms).then(() => undefined)]);
}

/**
 * The files the session's last shell command committed: when HEAD moved while it ran, the files of
 * the commits made on top of where HEAD was since the command started. Merges and older commits a
 * pull brought in are not its.
 */
async function committedByCommand(
  this: CoordinationBroker,
  session: LocalSession,
): Promise<ReadonlyArray<string>> {
  const started = session.shellAt;
  session.shellAt = 0;
  const before = session.head;
  const head = await within(this.host.gitHead?.(session.root), GIT_STATUS_MS);
  if (head !== undefined) session.head = head;
  if (started === 0 || before === undefined || head === undefined || head === before) return [];
  const read = this.host.gitCommittedSince?.(session.root, before, started);
  return (await within(read, GIT_STATUS_MS)) ?? [];
}

/**
 * What a shell command changed: the files git sees changed now and did not
 * before, less those other sessions here changed. Agents edit with sed too.
 */
export async function readShellChanges(
  this: CoordinationBroker,
  session: LocalSession,
): Promise<ReadonlyArray<string>> {
  const status = await this.statusWithin(session.root, GIT_STATUS_MS);
  // A repository too big to look at in time is looked at again at the next step.
  if (status === null) return [];
  const now = new Set(changedPaths(status));
  const committed = await committedByCommand.call(this, session);
  if (!session.dirtyKnown) {
    // The first time git says what is changed here: whatever was, was there before the agent, or
    // is somebody's else; attributing it would make false overlaps for its teammates.
    session.dirty = new Set([...now, ...session.dirty]);
    session.dirtyKnown = true;
    return [];
  }
  const others = new Set(
    [...this.sessions.values()]
      .filter((other) => other !== session && other.root === session.root)
      .flatMap((other) => other.files),
  );
  const changed = [
    ...new Set([...[...now].filter((path) => !session.dirty.has(path)), ...committed]),
  ].filter((path) => !others.has(path));
  session.dirty = now;
  if (changed.length === 0) return [];
  session.files = [...session.files.filter((file) => !changed.includes(file)), ...changed].slice(
    -MAX_FILES,
  );
  this.markDirty();
  this.record("files.shell", { session: session.id, files: changed });
  return changed;
}

/** The files a tool call edits, absolute: a Codex patch names them from the session's directory. */
export function editedPaths(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
): string[] {
  return editedFiles(body.tool_name, body.tool_input).map((path) =>
    NodePath.resolve(session.cwd, path),
  );
}

/** Whether two paths are one file, however the agent wrote it (macOS has /var under /private). */
export function samePath(this: CoordinationBroker, a: string, b: string): boolean {
  return NodePath.resolve(a) === NodePath.resolve(b) || realPath(a) === realPath(b);
}

/**
 * A path as the agent named it, relative to the session's repository. git
 * names the repository by its real path (/private/var/… on macOS) while agents
 * use the path they were given (/var/…), and the file may not exist yet: the
 * nearest existing directory decides.
 */
export function inRepository(
  session: { readonly root: string; readonly cwd: string },
  path: string,
) {
  const absolute = NodePath.normalize(
    NodePath.isAbsolute(path) ? path : NodePath.join(session.cwd, path),
  );
  return repositoryPath(session.root, absolute) ?? repositoryPath(session.root, realPath(absolute));
}

function realPath(path: string): string {
  const missing: string[] = [];
  let existing = path;
  for (;;) {
    try {
      return NodePath.join(NodeFS.realpathSync(existing), ...missing);
    } catch {
      const parent = NodePath.dirname(existing);
      if (parent === existing) return path;
      missing.unshift(NodePath.basename(existing));
      existing = parent;
    }
  }
}
