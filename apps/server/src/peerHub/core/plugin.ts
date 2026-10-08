/**
 * The Peer plugin definition: what one optional Peer feature contributes to agents, clients and
 * the Hub, and the capability slots core fills from plugins. Every plugin is compiled in and listed
 * once in `registry.ts`. Plugin code reaches core only through this module and the core services
 * (`core/<area>/Peer*.ts`), and never imports another plugin.
 *
 * Contributions are Effects. A plugin's services are built whether or not it is active; core asks
 * `PeerPlugins` which plugins are active and skips the others entirely.
 *
 * @module peerHub/core/plugin
 */
import type {
  EnvironmentAuthorizationError,
  PeerAgentView,
  PeerHarness,
  PeerHubError,
  PeerHubStartAgentResult,
  PeerPluginId,
  PeerTask,
  PeerWorkPullRequest,
  PeerWorkStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import type { AgentKind } from "../coordination.ts";
import type { ReportedSession, ReportedThread } from "../hubApi.ts";
import type { PersistedWorkspace } from "./state/PeerState.ts";

export type { AgentKind, PersistedWorkspace, ReportedSession, ReportedThread };

/**
 * The core services a plugin's layer and contributions may require (design decision 3). Each
 * joins this union as it is carved out of the PeerHub facade.
 */
export type PeerCore = never;

/** What Settings, the status and the registry know of a plugin without building it. */
export interface PeerPluginInfo {
  /** Kebab-case; its folder, contract files, web and mobile entries and Hub feature use it too. */
  readonly id: PeerPluginId;
  /** Its name in Settings → Workspaces → Peer plugins. */
  readonly title: string;
  readonly summary: string;
  readonly defaultEnabled: boolean;
  /** False keeps it out of the catalog entirely (memory while frozen). */
  readonly available?: boolean;
  /** The Hub feature it needs; the signed-in Hub must serve it at this revision or a later one. */
  readonly hubFeature?: { readonly id: string; readonly revision: number };
}

/** One optional Peer feature. Listed once in `core/registry.ts` through `bindPlugin`. */
export interface PeerPlugin<R = never> extends PeerPluginInfo {
  /** The plugin's own services, built whatever its state. */
  readonly layer: Layer.Layer<R, never, PeerCore>;
  /** Binds its transports (commands, hooks, RPC, ...) to those services. */
  readonly make: Effect.Effect<PeerContributions, never, R | PeerCore>;
}

/** A plugin as the registry holds it: its services bound to its contributions. */
export interface PeerPluginEntry extends PeerPluginInfo {
  /** Builds the plugin's services in the caller's scope, then its contributions. */
  readonly contributions: Effect.Effect<PeerContributions, never, PeerCore | Scope.Scope>;
}

/** Hides a plugin's own services behind its contributions, so one list can hold every plugin. */
export const bindPlugin = <R>({ layer, make, ...info }: PeerPlugin<R>): PeerPluginEntry => ({
  ...info,
  contributions: Layer.build(layer).pipe(
    Effect.flatMap((own) =>
      Effect.updateContext(make, (core: Context.Context<PeerCore>) => Context.merge(core, own)),
    ),
  ),
});

export interface PeerContributions {
  readonly commands?: ReadonlyArray<PeerCommand>;
  readonly hooks?: PeerHooks;
  readonly hubChanges?: PeerHubListener;
  readonly status?: PeerStatusContribution;
  readonly rpc?: PeerRpcContribution;
  /** A toolkit registered at server start; core refuses its calls while the plugin is inactive. */
  readonly mcp?: Layer.Layer<never, never, PeerCore>;
  readonly lifecycle?: (event: PeerLifecycleEvent) => Effect.Effect<void>;
  /** Forked while the plugin is active, interrupted when it is not; restarted after a failure. */
  readonly run?: Effect.Effect<void, never, Scope.Scope>;
  /**
   * Undoes the plugin's effects outside its own state when its owner turns it off. It runs under
   * the state lock, so it must not take the lock itself; its failure is shown as the plugin's error.
   */
  readonly turnOff?: Effect.Effect<void, PeerHubError>;
  // Capability slots: at most one plugin fills each, and core works without them.
  readonly runtime?: PeerRuntimeProvider;
  readonly indexSource?: PeerIndexSource;
  readonly gitHost?: PeerGitHost;
  /** Adds sessions to a coordination report: herdr's observations, memory's runtimes. */
  readonly reportSessions?: (
    workspace: string,
    reported: ReadonlyArray<ReportedSession>,
  ) => Effect.Effect<ReadonlyArray<ReportedSession>>;
  /** What a plugin adds to one of this computer's threads in the work report (observe). */
  readonly threadReport?: (threadKey: string) => { readonly observable?: boolean };
  readonly taskLauncher?: PeerTaskLauncher;
  readonly requestAcceptor?: PeerRequestAcceptor;
}

export type PeerLifecycleEvent =
  | { readonly kind: "signed-in" }
  /** Before the Hub session is dropped. */
  | { readonly kind: "signing-out" }
  | { readonly kind: "synced"; readonly workspaces: ReadonlyArray<PersistedWorkspace> }
  | { readonly kind: "left-workspace"; readonly workspace: string };

/** An agent session as plugins see it. */
export interface PeerSessionView {
  /** `claude:<native id>` or `codex:<native id>`. */
  readonly id: string;
  readonly agent: AgentKind;
  readonly adapter: "mod" | "hooks";
  readonly runtimeGeneration: string;
  readonly workspace: string;
  readonly project: string;
  readonly repositoryId: string | undefined;
  readonly root: string;
  readonly cwd: string;
  readonly task: string | undefined;
  /** `peer:<thread id>` when Peer runs it. */
  readonly thread: string | undefined;
  /** Its herdr pane. */
  readonly pane: string | undefined;
  readonly status: PeerWorkStatus;
  readonly files: ReadonlyArray<string>;
  readonly claims: ReadonlyArray<string>;
  /** Plugin-owned per-session state, dropped with the session and on a new runtime generation. */
  readonly local: <S>(plugin: PeerPluginId, init: () => S) => S;
}

export interface PeerHooks {
  /** A block of the session's start text, at most 2,000 characters. */
  readonly sessionStart?: (ctx: PeerHookContext) => Effect.Effect<string | null>;
  readonly notices?: ReadonlyArray<{
    /** True only for text the agent must answer (like overlap notes). */
    readonly wakes: boolean;
    /** At most 1,200 characters per plugin and step. */
    readonly read: (ctx: PeerHookContext) => Effect.Effect<string | null>;
  }>;
  readonly preTool?: {
    readonly on: "edits" | "shell" | "all";
    /** No side effects: core may discard the verdict. */
    readonly decide: (ctx: PeerToolContext) => Effect.Effect<PeerVerdict | null>;
    /** What applies when `decide` misses its budget (G7). */
    readonly fallback: (ctx: PeerToolContext) => PeerVerdict | null;
  };
  /** At most 1,200 characters. */
  readonly postTool?: (ctx: PeerToolContext) => Effect.Effect<string | null>;
  readonly preCompact?: (ctx: PeerHookContext) => Effect.Effect<string | null>;
  readonly stop?: (ctx: PeerHookContext) => Effect.Effect<void>;
  readonly sessionEnd?: (ctx: PeerHookContext) => Effect.Effect<void>;
  /** Paths Peer lets the agent touch without asking its person (Codex PermissionRequest). */
  readonly ownPaths?: (session: PeerSessionView) => ReadonlyArray<string>;
}

export interface PeerHookContext {
  readonly session: PeerSessionView;
  readonly event:
    | "session-start"
    | "prompt"
    | "pre-tool"
    | "post-tool"
    | "pre-compact"
    | "stop"
    | "session-end";
  /** At session start: startup, resume, compact or clear. */
  readonly source?: string;
  readonly prompt?: string;
  /** The person typed it (not a wake). */
  readonly fromPerson?: boolean;
  /** Budget left; longer work queues its text for the next step. */
  readonly remainingMs: number;
}

export interface PeerToolContext extends PeerHookContext {
  /** Edit, Write, MultiEdit, NotebookEdit, Bash, apply_patch, ... */
  readonly tool: string;
  /** Repository-relative files the call edits (pre) or edited (post). */
  readonly paths: ReadonlyArray<string>;
  /** The shell command, for Bash. */
  readonly command?: string;
}

/** Plugins can only make an action stricter; letting Peer's own files through is `ownPaths`. */
export interface PeerVerdict {
  readonly decision: "deny" | "ask";
  /** What the agent (deny) or its person (ask) reads. */
  readonly reason: string;
}

export interface PeerCommand {
  /** `peer <name>`; unique across core and every plugin. */
  readonly name: string;
  /** E.g. `request <email> "<prompt>" [--title "<title>"] [--op <id>]`. */
  readonly usage: string;
  /** The help line's description. */
  readonly summary: string;
  /** How long the `peer` shim waits for it, in seconds; 15 when absent. */
  readonly waitSeconds?: number;
  readonly run: (input: PeerCommandInput) => Effect.Effect<string, PeerCommandError>;
}

export interface PeerCommandInput {
  readonly session: PeerSessionView;
  readonly args: ReadonlyArray<string>;
  /** The args without `--flags` and their values. */
  readonly plain: ReadonlyArray<string>;
  /** The plain args joined, clipped to 600 characters. */
  readonly text: string;
  readonly flag: (name: `--${string}`) => string | undefined;
  readonly cwd: string | undefined;
}

/** A command's refusal; the `peer` shim prints the message and exits non-zero. */
export class PeerCommandError extends Schema.TaggedError<PeerCommandError>()("PeerCommandError", {
  /** The HTTP status the shim turns into a failing exit. */
  status: Schema.Number,
  message: Schema.String,
}) {}

export interface PeerHubListener {
  /** Ping names it follows; `resync` always reaches it. */
  readonly changes: ReadonlyArray<string>;
  /** Also pings this environment caused (default false). */
  readonly ownEcho?: boolean;
  readonly onPing: (ping: PeerHubPing) => Effect.Effect<void>;
}

export interface PeerHubPing {
  readonly workspace: string;
  readonly change: string;
  /** The environment that caused it, if any. */
  readonly origin: string | null;
  /** The ping's scalar fields: ids and counters only. */
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PeerStatusContribution {
  /** The plugin's slice, read from memory (no I/O); core places it (see `core/status`). */
  readonly read: Effect.Effect<unknown>;
}

export interface PeerRpcContribution {
  /** From `packages/contracts/src/peer/<id>.rpc.ts`. */
  readonly group: RpcGroup.Any;
  /** The RpcGroup handlers for `group`. */
  readonly handlers: (wrap: PeerRpcWrap) => unknown;
}

/** `ws.ts`'s per-connection wrappers (scope authorization and tracing); core adds the active guard. */
export interface PeerRpcWrap {
  readonly effect: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly stream: <A, E, R>(
    method: string,
    stream: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E | EnvironmentAuthorizationError, R>;
}

/** How waking an idle agent through its runtime went; only the receiving hook proves delivery. */
export interface PeerWakeOutcome {
  readonly status: "queued" | "uncertain" | "unavailable";
  readonly reason?: string;
}

/** Runs agents beside Peer's own threads (herdr). */
export interface PeerRuntimeProvider {
  /** Thread keys it owns, e.g. `herdr:`. */
  readonly prefix: string;
  readonly title: (pane: string) => string | undefined;
  readonly pane: (agent: AgentKind, cwd: string, named: string | undefined) => string | undefined;
  readonly status: (
    sessionId: string,
    pane: string | undefined,
  ) => PeerWorkStatus | null | undefined;
  readonly wake: (sessionId: string, pane: string, text: string) => Effect.Effect<PeerWakeOutcome>;
  readonly view: (threadKey: string) => Effect.Effect<PeerAgentView>;
  readonly threads: (workspace: string) => Effect.Effect<ReadonlyArray<ReportedThread>>;
}

/** Launches an agent for a task in its own checkout (herdr). Core validates, assigns and publishes. */
export interface PeerTaskLauncher {
  /** Why it cannot launch now ("herdr is not running …"), or null. */
  readonly unavailable: Effect.Effect<string | null>;
  readonly launch: (input: {
    readonly checkout: string;
    readonly baseBranch: string;
    readonly worktrees: string;
    readonly task: PeerTask;
    readonly harness: PeerHarness;
    readonly prompt: string;
    /** PEER_TASK and PEER_CLAUDE_MOD_DIR, from core. */
    readonly env: Readonly<Record<string, string>>;
  }) => Effect.Effect<PeerHubStartAgentResult & { readonly threadKey: string }, PeerHubError>;
}

/** Takes a pending request addressed to this person for this task, once (requests). */
export interface PeerRequestAcceptor {
  readonly accept: (input: {
    readonly workspace: string;
    readonly project: string;
    readonly task: string;
    readonly requestId: string;
  }) => Effect.Effect<{ readonly prompt: string }, PeerHubError>;
}

/** One entry an index source adds to core's index: a `.ai` knowledge entry, say. */
export interface PeerIndexEntry {
  readonly id: string;
  /** decision, convention, learning or incident. */
  readonly kind: string;
  readonly title: string;
  readonly status: string | undefined;
  readonly date: string | undefined;
  readonly summary: string;
  readonly tags: ReadonlyArray<string>;
  /** The paths and globs it governs, relative to the repository. */
  readonly paths: ReadonlyArray<string>;
  /** Where it is, relative to the repository. */
  readonly file: string;
  /** The start of its text. */
  readonly body: string;
}

/** Fills core's index (knowledge): entries for the index, start text and `peer find`. */
export interface PeerIndexSource {
  readonly entries: (session: PeerSessionView) => Effect.Effect<ReadonlyArray<PeerIndexEntry>>;
  readonly section: (entries: ReadonlyArray<PeerIndexEntry>, shown: number) => string | null;
}

/** Clones, explains and finds pull requests for the repositories it owns (github). */
export interface PeerGitHost {
  readonly owns: (url: string) => boolean;
  readonly clone: (url: string) => Effect.Effect<{
    readonly url: string;
    readonly args: ReadonlyArray<string>;
    readonly configure: (checkout: string) => Effect.Effect<void>;
  } | null>;
  readonly explain: (
    output: string,
    repo: { readonly url: string; readonly branch: string },
  ) => { readonly message: string; readonly signIn: boolean };
  readonly pullRequests: (input: {
    readonly workId: string;
    readonly repositoryUrl: string;
    readonly branch: string;
    readonly known: ReadonlyArray<string>;
  }) => ReadonlyArray<PeerWorkPullRequest> | undefined;
}
