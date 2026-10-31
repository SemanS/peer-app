// @effect-diagnostics nodeBuiltinImport:off - a digest for what plugins compare by content.
export { writePreservingLink } from "./adapters/files.ts";
import type { CliError } from "./broker/cliContract.ts";
export { CliError, usage, refused, uncertain, hubFailure, render } from "./broker/cliContract.ts";
export { isSignedOut, isMissingRoute } from "./hub/hubApi.ts";
// Whether a shell command is a landing step, and which: a plugin that judges shell commands may need to know.
export { isLanding, landingKind } from "./broker/landing.ts";
// The settle plugin says the nudge core says, and picks the closer core picks.
export { settleCandidate, settleNudge } from "./coordination/news.ts";
// Each `jj` run of a shell command with its global options (`-R`, `--at-op`, `--ignore-immutable`, ...) and subcommand
// words. Landing reads jj commands through the same parser, so a plugin that judges one cannot read it differently.
export { jjInvocations, shellWrite } from "../handoffCommands.ts";
export type { JjGlobalOption, JjInvocation } from "../handoffCommands.ts";
import * as NodeCrypto from "node:crypto";
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
  PeerHandoffDelivery,
  PeerHarness,
  PeerHubError,
  PeerHubStartAgentResult,
  PeerIntentResponse,
  PeerOverlapRecord,
  PeerProjectPolicy,
  PeerPluginId,
  PeerTask,
  PeerWorkPullRequest,
  PeerWorkStatus,
  PeerStaleReads,
  PeerHubStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { HttpClient } from "effect/http";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import type * as ServerConfig from "../../config.ts";
import type * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import type * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import type * as ProjectService from "../../project/ProjectService.ts";
import type * as Settings from "../../serverSettings.ts";
import type { AgentAwarenessRelay } from "../../relay/AgentAwarenessRelay.ts";
import type * as PeerAgents from "./coordination/PeerAgents.ts";
import type { AgentKind } from "./coordination/edits.ts";
import type { ReportedSession } from "./hub/coordApi.ts";
import type { HubPing, ReportedThread } from "./hub/hubApi.ts";
import type * as PeerHubClient from "./hub/PeerHubClient.ts";
import type * as PeerIndex from "./index/PeerIndex.ts";
import type * as PeerPlugins from "./plugins/PeerPlugins.ts";
import type * as PeerState from "./state/PeerState.ts";
import type * as PeerStatus from "./status/PeerStatus.ts";
import type { PersistedWorkspace } from "./state/PeerState.ts";
import type * as PeerWork from "./work/PeerWork.ts";

export type { AgentKind, PersistedWorkspace, ReportedSession, ReportedThread };

/**
 * What a plugin's layer and contributions may require: core's services, and the T3 services plugins
 * build on: provider settings, the server's configuration and HTTP client, its projects and threads.
 */
import type * as PeerLog from "./log/PeerLog.ts";
export type PeerCore =
  | AgentAwarenessRelay
  | PeerLog.PeerLog
  | PeerAgents.PeerAgents
  | PeerState.PeerState
  | PeerHubClient.PeerHubClient
  | PeerIndex.PeerIndex
  | PeerPlugins.PeerPlugins
  | PeerStatus.PeerStatus
  | PeerWork.PeerWork
  | Settings.ServerSettingsService
  | ServerSecretStore.ServerSecretStore
  | ServerConfig.ServerConfig
  | HttpClient.HttpClient
  | ProjectService.ProjectService
  | ProjectionStore.ProjectionStoreV2;

/**
 * What T3's MCP server gives a plugin's toolkit besides core: its threads. The calling runtime
 * (`McpInvocationContext`) reaches each call, not the toolkit.
 */
export type PeerMcpHost = ThreadManagement.ThreadManagementService;

/** What Settings, the status and the registry know of a plugin without building it. */
export interface PeerPluginInfo {
  /** Kebab-case; its folder, contract files, web and mobile entries and Hub feature use it too. */
  readonly id: PeerPluginId;
  /** Its name in Settings → Peer → Coordination & plugins. */
  readonly title: string;
  readonly summary: string;
  readonly defaultEnabled: boolean;
  /** Environment policy, evaluated before the owner's saved choice; visible but cannot enable. */
  readonly forcedOff?: () => string | undefined;
  /** False keeps it out of the catalog entirely (memory while frozen). */
  readonly available?: boolean;
  /**
   * The `peer` commands it adds. A build that excludes the plugin refuses them in one line, as it
   * does an inactive plugin's, instead of printing help as for a command nobody has.
   */
  readonly commandNames?: ReadonlyArray<string>;
  /** The Hub feature it needs; the signed-in Hub must serve it at this revision or a later one. */
  readonly hubFeature?: { readonly id: string; readonly revision: number };
  /**
   * Why it is inactive while the signed-in Hub does not serve `hubFeature`, as a clause a refusal
   * starts with ("this Peer Hub was built without Memory"). Without one, core says the plugin
   * needs a newer Peer Hub, which is true of a feature every new Hub serves.
   */
  readonly unserved?: string;
}

/** One optional Peer feature. Listed once in `core/registry.ts`, bound by `bindPlugin`. */
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
/**
 * A short digest of what a plugin compares by content (a conflict's files, say), for the ids it keeps
 * in `PeerSessionView.told`: the session's memory file holds it without the words.
 */
export const toldDigest = (text: string) =>
  NodeCrypto.createHash("sha256").update(text).digest("base64url").slice(0, 16);

export const bindPlugin = <R>({ layer, make, ...info }: PeerPlugin<R>): PeerPluginEntry => ({
  ...info,
  contributions: Layer.build(layer).pipe(
    Effect.flatMap((own) =>
      Effect.updateContext(make, (core: Context.Context<PeerCore>) => Context.merge(core, own)),
    ),
  ),
});

export interface PeerContributions {
  /** Own marked files beside native hooks; runs only during explicit adapter setup or teardown. */
  readonly adapterFiles?: (input: {
    readonly codexHomes: ReadonlyArray<string>;
    readonly peerScript: string;
    readonly install: boolean;
  }) => Effect.Effect<void, PeerHubError>;
  /** Optional target namespace for core claim/release; validation finishes before either side writes. */
  readonly claimScheme?: {
    readonly prefix: string;
    readonly flags: ReadonlyArray<`--${string}`>;
    readonly help: ReadonlyArray<string>;
    readonly validate: (command: "claim" | "release", input: PeerCommandInput) => void;
    readonly recognizesRelease: (session: PeerSessionView, target: string) => boolean;
    readonly run: (
      command: "claim" | "release",
      input: PeerCommandInput,
    ) => Effect.Effect<string, CliError | PeerCommandError>;
  };
  /** Memory-only effective policy for one path while the Hub gives no verdict. */
  readonly fallbackPolicy?: (
    session: PeerSessionView,
    path: string,
    base: PeerProjectPolicy,
  ) => PeerProjectPolicy | undefined;
  /** At most 2,000 characters in the explicit status command. */
  readonly statusBlock?: (session: PeerSessionView) => Effect.Effect<string | null>;
  /**
   * One short fact per task (at most 80 characters, keyed by task id) that `peer task list` and
   * `peer_task` list add to the task's line, as "accepted by Ana". What the plugin already knows:
   * no Hub or disk I/O; core waits 100 ms for it and lists the tasks without it after that.
   */
  readonly taskFacts?: (
    place: { readonly workspace: string; readonly project: string },
    tasks: ReadonlyArray<{ readonly id: string; readonly status?: string | undefined }>,
  ) => Effect.Effect<ReadonlyMap<string, string>>;
  /** Local bookkeeping only, bounded by core; never Hub/disk I/O and cannot change the verdict. */
  readonly intentResult?: (
    session: PeerSessionView,
    answer: PeerIntentResponse,
  ) => Effect.Effect<void>;
  readonly commands?: ReadonlyArray<PeerCommand>;
  /** A note after a successful core command; it cannot change the committed outcome. */
  readonly commandReply?: (
    session: PeerSessionView,
    command: string,
  ) => Effect.Effect<string | null>;
  /**
   * What must be settled before `peer review` hands the task over: a refusal ends the command
   * refused and the task stays where it was. It has what is left of the command's budget; one that
   * misses it or fails refuses nothing.
   */
  readonly beforeReview?: (input: {
    readonly session: PeerSessionView;
    readonly remainingMs: number;
  }) => Effect.Effect<{ readonly reason: string; readonly next: string } | null>;
  /** What an agent's move to review carries (the delivery the Hub's review policy reads). */
  readonly reviewFacts?: (input: {
    readonly session: PeerSessionView;
    readonly remainingMs: number;
  }) => Effect.Effect<PeerReviewFacts>;
  readonly afterReview?: (input: {
    readonly session: PeerSessionView;
    readonly remainingMs: number;
  }) => Effect.Effect<ReadonlyArray<string>>;
  readonly hooks?: PeerHooks;
  readonly hubChanges?: PeerHubListener;
  readonly status?: PeerStatusContribution;
  /** A named, pure projection for clients that need a smaller status snapshot. */
  readonly statusViews?: Readonly<Record<string, (status: PeerHubStatus) => PeerHubStatus>>;
  readonly rpc?: PeerRpcContribution;
  /**
   * A toolkit T3's MCP server registers once, when it starts: its tools refuse calls while the
   * plugin is inactive (`PeerPlugins.requireActive`). One that lists tools only while its plugin is
   * on reads the choice then, so turning it on lists them after a restart.
   */
  readonly mcp?: Layer.Layer<never, never, PeerCore | PeerMcpHost>;
  /** Tools exposed by the lightweight Peer stdio server; calls reuse the command router. */
  readonly agentTools?: ReadonlyArray<PeerAgentTool>;
  /** Prompts are read at each request, so a plugin can change its catalog without a restart. */
  readonly agentPrompts?: {
    readonly list: (session: PeerSessionView) => Effect.Effect<ReadonlyArray<PeerAgentPrompt>>;
    readonly get: (
      session: PeerSessionView,
      name: string,
      args: Readonly<Record<string, string>>,
    ) => Effect.Effect<
      { readonly description?: string; readonly text: string },
      CliError | PeerCommandError
    >;
  };
  /** Per-thread stdio servers, read synchronously by provider adapters while this plugin is active. */
  readonly threadMcpServers?: (
    thread: string,
    harness: PeerHarness,
  ) => Readonly<Record<string, import("@t3tools/contracts").PeerMcpServer>>;
  readonly lifecycle?: (event: PeerLifecycleEvent) => Effect.Effect<void>;
  /** Trusted newly created checkout; queue only, never indexing or other I/O on the launch path. */
  readonly taskWorktreeCreated?: (
    event: Extract<PeerLifecycleEvent, { readonly kind: "task-worktree-created" }>,
  ) => Effect.Effect<void>;
  /** Forget local membership data on leave, sign-out or sync, even while inactive. No other effects. */
  readonly workspaceCleanup?: (
    event: Exclude<PeerLifecycleEvent, { readonly kind: "signed-in" | "task-worktree-created" }>,
  ) => Effect.Effect<void>;
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
  /**
   * Adds sessions to a coordination report: memory's runtimes, herdr's observations. The plugin that
   * fills `runtime` adds last, so it can fit its observations within the Hub's bound.
   */
  readonly reportSessions?: (
    workspace: string,
    reported: ReadonlyArray<ReportedSession>,
  ) => Effect.Effect<ReadonlyArray<ReportedSession>>;
  /** What a plugin adds to one of this computer's threads in the work report (observe). */
  readonly threadReport?: (threadKey: string) => { readonly observable?: boolean };
  readonly taskLauncher?: PeerTaskLauncher;
  readonly requestAcceptor?: PeerRequestAcceptor;
  readonly reviewStarter?: import("./plugins/PeerReviewStarter.ts").PeerReviewStarter;
  /** Whether this person shares unfinished work on origin: nothing else may push it there. */
  readonly wipSharing?: { readonly on: Effect.Effect<boolean> };
}

export type PeerLifecycleEvent =
  | { readonly kind: "signed-in" }
  /** Trusted launcher provenance after assignment; handlers only queue background work. */
  | {
      readonly kind: "task-worktree-created";
      readonly workspace: string;
      readonly project: string;
      readonly repository: string;
      readonly task: string;
      readonly thread: string;
      readonly root: string;
      readonly identity: string;
    }
  /** Before the Hub session is dropped. */
  | { readonly kind: "signing-out"; readonly keysAlreadyQueued?: boolean }
  | { readonly kind: "synced"; readonly workspaces: ReadonlyArray<PersistedWorkspace> }
  | { readonly kind: "left-workspace"; readonly workspace: string };

export type PeerReviewFacts = { readonly delivery?: PeerHandoffDelivery };

/** An agent session as plugins see it. */
export interface PeerSessionView {
  /** A public checkout read: no advice or receipt is attributed to an agent. */
  readonly public?: boolean;
  /** `claude:<native id>` or `codex:<native id>`. */
  readonly id: string;
  readonly agent: string;
  readonly adapter: "mod" | "hooks" | "mcp";
  readonly runtimeGeneration: string;
  readonly workspace: string;
  readonly project: string;
  readonly repositoryId: string | undefined;
  readonly root: string;
  readonly cwd: string;
  readonly task: string | undefined;
  /** Its run, which outlives the session (`core/work/runs.ts`). */
  readonly run?: string;
  readonly branch?: string;
  /** `peer:<thread id>` when Peer runs it. */
  readonly thread: string | undefined;
  /** Its herdr pane. */
  readonly pane: string | undefined;
  readonly status: PeerWorkStatus;
  /** It keeps the shared context of its work. */
  readonly keeps: boolean;
  readonly files: ReadonlyArray<string>;
  readonly claims: ReadonlyArray<string>;
  /** Its "For the team" lines as last read from its working context. */
  readonly team?: ReadonlyArray<string>;
  /** Plugin-owned per-session state, dropped with the session and on a new runtime generation. */
  readonly local: <S>(plugin: PeerPluginId, init: () => S) => S;
  /**
   * What a plugin told the session and must not tell it again, as ids: core keeps it in the
   * session's memory across Peer's restarts, and drops it with `local` on a new runtime generation.
   */
  readonly told?: (plugin: PeerPluginId) => Set<string>;
  /**
   * Findings a plugin showed or counted to the session (a challenge's sources): what it says on its
   * own afterwards is then no independent discovery, as with the findings core tells it of.
   */
  readonly hear?: (findings: Iterable<string>) => void;
  /** Exact cached context inputs: snapshots only, never new reads or receipt claims. */
  readonly contextReads?: ReadonlyArray<{
    readonly scope: string;
    readonly version: number;
    readonly text: string;
  }>;
  readonly sharedContext?: {
    readonly scope: string;
    readonly version: number;
    readonly text: string;
  } | null;
  /** The version explicitly read; a telling never becomes a read receipt. */
  readonly contextReadVersion?: (scope: string) => number | undefined;
  /** Mark the current index entry told when another contribution carried it. */
  readonly tellIndex?: (scope: string) => void;
}

export interface PeerHooks {
  /** Local catalog information, at most 300 characters after the commands paragraph. No I/O. */
  readonly startLine?: Effect.Effect<string | null>;
  /** Structured refusal versions, without the input text; callbacks must only queue local work. */
  readonly handoffRefused?: (
    session: PeerSessionView,
    scopes: PeerStaleReads["stale"],
  ) => Effect.Effect<void>;
  /** Information that must survive provider start-context limits, before core's context. */
  readonly priority?: "first";
  /** A block of the session's start text, at most 2,000 characters. */
  readonly sessionStart?: (ctx: PeerHookContext) => Effect.Effect<PeerHookText | null>;
  readonly notices?: ReadonlyArray<{
    /** True only for text the agent must answer (like overlap notes). */
    readonly wakes: boolean;
    /**
     * True only for a message addressed to the agent that it must have read before its work lands:
     * a decision on a request it made, an agreement kept for its task, or the push notice (jujutsu:
     * the session pushes a change that builds on a teammate's unmerged bookmark, so it should use
     * that bookmark as the pull request's `--base`) (G8, "nothing lands unread"). A landing step (a `git commit`, `git push`, `gh pr create` or `gh pr merge` in its
     * shell, or `peer review` or `peer done`) then stops once to give the agent this text, and the
     * same step again runs. Advice never sets it: impact, forecast, plans, dependencies,
     * announcements and knowledge reach the agent as at any other step. A notice marks its text told
     * when it reads it, as any notice does, so the stop and the next ordinary step never both say it.
     */
    readonly landing?: boolean;
    /** At most 1,200 characters per plugin and step; at a tool call's step, `ctx` has the call. */
    readonly read: (ctx: PeerHookContext | PeerToolContext) => Effect.Effect<PeerHookText | null>;
  }>;
  /** Local bookkeeping only: never Hub or disk I/O. Opaque refs belong to a complete block. */
  readonly delivery?: (event: {
    readonly session: PeerSessionView;
    readonly refs: ReadonlyArray<string>;
    readonly state: "offered" | "modelInput" | "dropped";
    readonly chars?: number;
  }) => Effect.Effect<void>;
  readonly preTool?: {
    readonly on: "edits" | "shell" | "all";
    /**
     * No side effects: core may discard the verdict. A shell command that lands work (`isLanding`)
     * is judged even when it names `peer`, as a commit message may; any other command that names
     * `peer` is Peer's own and is not.
     */
    readonly decide: (ctx: PeerToolContext) => Effect.Effect<PeerVerdict | null>;
    /** What applies when `decide` misses its budget (G7). */
    readonly fallback: (ctx: PeerToolContext) => PeerVerdict | null;
  };
  /** At most 1,200 characters. */
  readonly postTool?: (ctx: PeerToolContext) => Effect.Effect<string | null>;
  readonly preCompact?: (ctx: PeerHookContext) => Effect.Effect<string | null>;
  readonly stop?: (ctx: PeerHookContext) => Effect.Effect<void>;
  /** Flushes reports that require this session's Hub ownership before core releases it. */
  readonly sessionEnding?: (ctx: PeerSessionEndingContext) => Effect.Effect<void>;
  readonly sessionEnd?: (ctx: PeerHookContext) => Effect.Effect<void>;
  /** Paths Peer lets the agent touch without asking its person (Codex PermissionRequest). */
  readonly ownPaths?: (session: PeerSessionView) => ReadonlyArray<string>;
}

/** Referenced blocks are delivered whole; a block exceeding its budget is dropped, never cut. */
export type PeerHookText = string | { readonly text: string; readonly refs: ReadonlyArray<string> };

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
  /** A wake channel asks only an idle session's answerable notices. */
  readonly waking?: boolean;
  /** Budget left; longer work queues its text for the next step. */
  readonly remainingMs: number;
}

/**
 * An open overlap of a session that is ending, as the broker's merged view has it while the
 * session is still in it: a plugin that settles overlaps after their agents end decides from it.
 */
export interface PeerEndingOverlap {
  readonly id: string;
  readonly workspace: string;
  readonly project: string;
  readonly files: ReadonlyArray<string>;
  readonly sessions: ReadonlyArray<string>;
  readonly notes: PeerOverlapRecord["notes"];
  readonly policy?: PeerProjectPolicy;
  /** The agent session that closes it (`closerOf`), the ending one still counted as at work. */
  readonly closer: string | undefined;
}

export interface PeerSessionEndingContext extends PeerHookContext {
  /** The ending session's open overlaps. */
  readonly overlaps: ReadonlyArray<PeerEndingOverlap>;
}

export interface PeerToolContext extends PeerHookContext {
  /** Edit, Write, MultiEdit, NotebookEdit, Bash, apply_patch, ... */
  readonly tool: string;
  /** Repository-relative files the call edits (pre) or edited (post). */
  readonly paths: ReadonlyArray<string>;
  /**
   * Absolute paths the call is about to edit outside the repository and outside Peer's own files
   * (a harness's memory, say). Before the call only; a plugin may deny such an edit, and a deny is
   * all core takes of what plugins say of them.
   */
  readonly outside?: ReadonlyArray<string>;
  /** The shell command, for Bash. */
  readonly command?: string;
  /** What an MCP tool (`mcp__<server>__<tool>`) was called with. */
  readonly input?: Readonly<Record<string, unknown>>;
  /** After the call, for Bash and MCP tools: the start of what it answered, as text (2,000 characters at most). */
  readonly output?: string;
  /**
   * The call ended in an error (Claude Code's PostToolUseFailure), so `paths` are what git sees it
   * changed. Codex reports a command that exits non-zero as finished.
   */
  readonly failed?: boolean;
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
  /** Checkout-scoped read, with no caller credential and no agent receipt. */
  readonly public?: boolean;
  /** Local static read that needs neither a session nor a checkout. */
  readonly globalRead?: (
    args: ReadonlyArray<string>,
    context: { readonly tools: boolean },
  ) => Effect.Effect<string, PeerCommandError | CliError>;
  /** One stdio message: the socket transport decodes the line and bypasses shell caller binding. */
  readonly stdio?: (input: {
    readonly line: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
  }) => Effect.Effect<string, CliError | PeerCommandError>;
  readonly run: (input: PeerCommandInput) => Effect.Effect<string, PeerCommandError | CliError>;
}

export interface PeerAgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly command: string;
  /** Decode tool parameters into CLI arguments; invalid input throws `CliError` with usage. */
  readonly arguments: (args: Readonly<Record<string, unknown>>) => ReadonlyArray<string>;
}

export interface PeerAgentPrompt {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }>;
}

export interface PeerToolBinding {
  readonly server: string;
  readonly session?: string;
  readonly token?: string;
  /** The run its process names (`PEER_RUN`) and the token it proves it with (`PEER_RUN_TOKEN`). */
  readonly run?: string;
  readonly runToken?: string;
  readonly thread?: string;
  readonly pane?: string;
  /** The folder the agent runs in: a refusal says when no workspace project holds it. */
  readonly cwd?: string;
  /** The `PEER_HARNESS` the MCP server was started with, naming the agent when it is a known one. */
  readonly harness?: string;
  /** The name the MCP client gave on `initialize` (`clientInfo.name`). */
  readonly client?: string;
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

/** A change ping from one of the signed-in workspaces. */
export interface PeerHubPing extends HubPing {
  readonly workspace: string;
}

export interface PeerStatusContribution {
  /** The plugin's slice, read from memory (no I/O); core places it (see `core/status`). */
  readonly read: Effect.Effect<unknown>;
  /**
   * For a plugin that existed before plugins, whose `read` sits in a frozen legacy place: a second
   * slice, placed in the optional field of its own that `peer/registry.ts` names after its id.
   */
  readonly field?: Effect.Effect<unknown>;
}

export interface PeerRpcContribution {
  /** From `packages/contracts/src/peer/<id>.rpc.ts`. */
  readonly group: RpcGroup.Any;
  /** The RpcGroup handlers for `group`. */
  readonly handlers: (wrap: PeerRpcWrap) => unknown;
}

/**
 * `ws.ts`'s per-connection wrappers: scope authorization, and tracing under the method's name with
 * its attributes. Core adds the active guard to a plugin's methods, which refuses them with a
 * `PeerHubError` while the plugin is inactive.
 */
export interface PeerRpcWrap {
  readonly effect: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError | PeerHubError, R>;
  readonly stream: <A, E, R>(
    method: string,
    stream: Stream.Stream<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Stream.Stream<A, E | EnvironmentAuthorizationError | PeerHubError, R>;
}

/** How waking an idle agent through its runtime went; only the receiving hook proves delivery. */
export interface PeerWakeOutcome {
  readonly status: "queued" | "uncertain" | "unavailable";
  readonly reason?: string;
}

/**
 * What the caller of a prompt read of an agent, which must still hold for the text to be typed:
 * the agent's native session (`PeerLocalAgent.session`) and the turn it had finished
 * (`PeerLocalAgent.turn`). Whatever is left out is not compared.
 */
export interface PeerPromptExpect {
  readonly session?: string;
  readonly turn?: number;
}

const PROMPT_STALE_DETAILS = {
  gone: "That agent is no longer there.",
  session: "That terminal now runs another conversation.",
  turn: "That agent has moved on since it was read.",
  busy: "That agent is working or waiting for an answer now.",
} as const;

/**
 * A prompt that was refused, with nothing typed, because the agent is no longer the one its caller
 * read (`PeerPromptExpect`). Callers tell it from a prompt that failed: the text may still be
 * right for the agent as it is now, but not for what the caller saw. `reason` says what differs:
 * the agent or its terminal is `gone`, the terminal runs another `session`, the agent finished
 * another `turn`, or it is `busy` (working, or waiting for an answer).
 */
export class PeerPromptStale extends Schema.TaggedError<PeerPromptStale>()("PeerPromptStale", {
  reason: Schema.Literals(["gone", "session", "turn", "busy"]),
}) {
  /** For a caller that shows a failed prompt, as `PeerHubError.detail` does. */
  get detail(): string {
    return PROMPT_STALE_DETAILS[this.reason];
  }
  override get message(): string {
    return this.detail;
  }
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
  /**
   * A person's explicit prompt, after core verified a live local coordinated agent. With `expect`
   * the runtime reads the agent again first and types the text only if it is still the session at
   * the turn the caller read, idle or done; otherwise it fails with `PeerPromptStale`.
   */
  readonly prompt?: (
    agentId: string,
    text: string,
    expect?: PeerPromptExpect,
  ) => Effect.Effect<void, PeerHubError | PeerPromptStale>;
  readonly view: (threadKey: string) => Effect.Effect<PeerAgentView>;
  readonly threads: (workspace: string) => Effect.Effect<ReadonlyArray<ReportedThread>>;
  /** Shows the people on this computer a notification where their agents run. */
  readonly notify?: (title: string, body: string) => Effect.Effect<void>;
}

/** Launches an agent for a task in its own checkout (herdr). Core validates, assigns and publishes. */
export interface PeerTaskLauncher {
  /** Why it cannot launch now ("herdr is not running …"), or null. */
  readonly unavailable: Effect.Effect<string | null>;
  /**
   * Whether the agent of one of these threads runs and waits on a person before it can start its
   * session, so that no hook has said a word of it yet.
   */
  readonly waiting?: (threads: ReadonlyArray<string>) => boolean;
  readonly launch: (input: {
    readonly checkout: string;
    readonly baseBranch: string;
    readonly worktrees: string;
    readonly task: PeerTask;
    readonly harness: PeerHarness;
    readonly prompt: string;
    /** The run's variables (`PEER_RUN`, `PEER_RUN_TOKEN`, `PEER_TASK`), from core. */
    readonly env: Readonly<Record<string, string>>;
    /**
     * The provider session a continued run resumes (design D6): the harness starts on it
     * (`claude --resume <id>`, `codex resume <id>`) where the runtime can pass arguments, and the
     * prompt then only says the run continues.
     */
    readonly resume?: { readonly agent: string; readonly session: string } | undefined;
    /** The model the harness starts on, where its author chose one. */
    readonly model?: string | undefined;
    /** Its reasoning effort, in the harness's own words. */
    readonly effort?: string | undefined;
    /** Provenance is returned only when this launch created a new worktree, never for reuse. */
  }) => Effect.Effect<
    PeerHubStartAgentResult & {
      readonly threadKey: string;
      readonly worktree?: { readonly root: string; readonly identity: string };
    },
    PeerHubError
  >;
}

/** Takes a pending request addressed to this person for this task, once (requests). */
export interface PeerRequestAcceptor {
  readonly accept: (input: {
    readonly workspace: string;
    readonly project: string;
    readonly task: string;
    readonly requestId: string;
    readonly instruction?: string;
    readonly fallback: string;
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
  /** What stands in a session's checkout, newest first; read again when old. */
  readonly entries: (session: PeerSessionView) => Effect.Effect<ReadonlyArray<PeerIndexEntry>>;
  /**
   * The entries as the index names `shown` of them: by title at a session's start, whole with the
   * ids that read them when the agent asked for the index (`full`); null when there are none.
   */
  readonly section: (
    entries: ReadonlyArray<PeerIndexEntry>,
    shown: number,
    full?: boolean,
  ) => string | null;
}

/** Clones, explains and finds pull requests for the repositories it owns (github). */
export interface PeerGitHost {
  readonly owns: (url: string) => boolean;
  /**
   * An address it owns as people type it (GitHub's `owner/repo`), as a clone URL and the
   * repository's name; null when it is not one of its own.
   */
  readonly address: (text: string) => { readonly url: string; readonly name: string } | null;
  /** How to clone `url`: the address and arguments to sign in with; null leaves git its own way. */
  readonly clone: (url: string) => Effect.Effect<{
    readonly url: string;
    readonly args: ReadonlyArray<string>;
    readonly configure: (checkout: string) => Effect.Effect<void>;
  } | null>;
  readonly explain: (
    output: string,
    repo: { readonly url: string; readonly branch: string },
  ) => { readonly message: string; readonly signIn: boolean };
  /**
   * What the host says now of a work's pull requests, from a cache it refreshes in the
   * background; undefined leaves the Hub's evidence as it is. `known` are the ones the Hub has.
   */
  readonly pullRequests: (input: {
    readonly workId: string;
    readonly repositoryUrl: string;
    readonly branch: string;
    readonly known: ReadonlyArray<PeerWorkPullRequest>;
  }) => ReadonlyArray<PeerWorkPullRequest> | undefined;
}
