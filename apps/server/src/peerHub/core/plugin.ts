// @effect-diagnostics nodeBuiltinImport:off - a digest for what plugins compare by content.
export { writePreservingLink } from "./adapters/files.ts";
import type { CliError } from "./broker/cliContract.ts";
export { CliError, usage, refused, uncertain, hubFailure, render } from "./broker/cliContract.ts";
export { isSignedOut, isMissingRoute } from "./hub/hubApi.ts";
// Whether a shell command is a landing step, and which: a plugin that judges shell commands may need to know.
export { isLanding, landingKind } from "./broker/landing.ts";
// Each `jj` run of a shell command with its global options (`-R`, `--at-op`, `--ignore-immutable`, ...) and subcommand
// words. Landing reads jj commands through the same parser, so a plugin that judges one cannot read it differently.
export { jjInvocations, shellWrite } from "../shellCommands.ts";
export type { JjGlobalOption, JjInvocation } from "../shellCommands.ts";
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
  PeerHarness,
  PeerHubError,
  PeerHubStartAgentResult,
  PeerPluginId,
  PeerTask,
  PeerWorkStatus,
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
import type * as ProjectService from "../../project/ProjectService.ts";
import type * as Settings from "../../serverSettings.ts";
import type { AgentAwarenessRelay } from "../../relay/AgentAwarenessRelay.ts";
import type * as PeerAgents from "./coordination/PeerAgents.ts";
import type { AgentKind } from "./coordination/edits.ts";
import type { ReportedSession } from "./hub/coordApi.ts";
import type { HubPing, ReportedThread } from "./hub/hubApi.ts";
import type * as PeerHubClient from "./hub/PeerHubClient.ts";
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
  | PeerPlugins.PeerPlugins
  | PeerStatus.PeerStatus
  | PeerWork.PeerWork
  | Settings.ServerSettingsService
  | ServerSecretStore.ServerSecretStore
  | ServerConfig.ServerConfig
  | HttpClient.HttpClient
  | ProjectService.ProjectService
  | ProjectionStore.ProjectionStoreV2;

/** What Settings, the status and the registry know of a plugin without building it. */
export interface PeerPluginInfo {
  /** Kebab-case; its folder, contract files, web and mobile entries and Hub feature use it too. */
  readonly id: PeerPluginId;
  /** Its name in Settings → Peer → Plugins. */
  readonly title: string;
  readonly summary: string;
  readonly defaultEnabled: boolean;
  /** Environment policy, evaluated before the owner's saved choice; visible but cannot enable. */
  readonly forcedOff?: () => string | undefined;
  /** The `peer` commands it adds, which no other plugin may take. */
  readonly commandNames?: ReadonlyArray<string>;
  /** The Hub feature it needs; the signed-in Hub must serve it at this revision or a later one. */
  readonly hubFeature?: { readonly id: string; readonly revision: number };
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
  readonly commands?: ReadonlyArray<PeerCommand>;
  readonly hooks?: PeerHooks;
  readonly hubChanges?: PeerHubListener;
  readonly status?: PeerStatusContribution;
  /** A named, pure projection for clients that need a smaller status snapshot. */
  readonly statusViews?: Readonly<Record<string, (status: PeerHubStatus) => PeerHubStatus>>;
  readonly rpc?: PeerRpcContribution;
  /** Tools exposed by the lightweight Peer stdio server; calls reuse the command router. */
  readonly agentTools?: ReadonlyArray<PeerAgentTool>;
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
  /**
   * Adds sessions to a coordination report: herdr's observations. The plugin that fills `runtime`
   * adds last, so it can fit its observations within the Hub's bound.
   */
  readonly reportSessions?: (
    workspace: string,
    reported: ReadonlyArray<ReportedSession>,
  ) => Effect.Effect<ReadonlyArray<ReportedSession>>;
  /** What a plugin adds to one of this computer's threads in the work report (observe). */
  readonly threadReport?: (threadKey: string) => { readonly observable?: boolean };
  readonly taskLauncher?: PeerTaskLauncher;
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
  | { readonly kind: "signing-out" }
  | { readonly kind: "synced"; readonly workspaces: ReadonlyArray<PersistedWorkspace> }
  | { readonly kind: "left-workspace"; readonly workspace: string };

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
  readonly files: ReadonlyArray<string>;
  readonly claims: ReadonlyArray<string>;
  /** Plugin-owned per-session state, dropped with the session and on a new runtime generation. */
  readonly local: <S>(plugin: PeerPluginId, init: () => S) => S;
  /**
   * What a plugin told the session and must not tell it again, as ids: core keeps it in the
   * session's memory across Peer's restarts, and drops it with `local` on a new runtime generation.
   */
  readonly told?: (plugin: PeerPluginId) => Set<string>;
}

export interface PeerHooks {
  /** Local catalog information, at most 300 characters after the commands paragraph. No I/O. */
  readonly startLine?: Effect.Effect<string | null>;
  /** Information that must survive provider start-context limits, before core's own text. */
  readonly priority?: "first";
  /** A block of the session's start text, at most 2,000 characters. */
  readonly sessionStart?: (ctx: PeerHookContext) => Effect.Effect<PeerHookText | null>;
  readonly notices?: ReadonlyArray<{
    /** True only for text the agent must answer (words in its room). */
    readonly wakes: boolean;
    /**
     * True only for a message addressed to the agent that it must have read before its work lands:
     * words in its room, or the push notice (jujutsu: the session pushes a change that builds on a
     * teammate's unmerged bookmark, so it should use that bookmark as the pull request's `--base`)
     * (G8, "nothing lands unread"). A landing step (a `git commit`, `git push`, `gh pr create` or
     * `gh pr merge` in its shell) then stops once to give the agent this text, and the same step
     * again runs. Advice never sets it. A notice marks its text told when it reads it, as any notice
     * does, so the stop and the next ordinary step never both say it.
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
  readonly stop?: (ctx: PeerHookContext) => Effect.Effect<void>;
  readonly sessionEnd?: (ctx: PeerHookContext) => Effect.Effect<void>;
  /** No end hook came and its lease ran out: a crash, a closed pane, or an agent long quiet. */
  readonly sessionExpired?: (ctx: PeerHookContext) => Effect.Effect<void>;
}

/** Referenced blocks are delivered whole; a block exceeding its budget is dropped, never cut. */
export type PeerHookText = string | { readonly text: string; readonly refs: ReadonlyArray<string> };

export interface PeerHookContext {
  readonly session: PeerSessionView;
  readonly event: "session-start" | "prompt" | "pre-tool" | "post-tool" | "stop" | "session-end";
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

export interface PeerToolContext extends PeerHookContext {
  /** Edit, Write, MultiEdit, NotebookEdit, Bash, apply_patch, ... */
  readonly tool: string;
  /** Repository-relative files the call edits (pre) or edited (post). */
  readonly paths: ReadonlyArray<string>;
  /** The shell command, for Bash. */
  readonly command?: string;
  /**
   * The call ended in an error (Claude Code's PostToolUseFailure), so `paths` are what git sees it
   * changed. Codex reports a command that exits non-zero as finished.
   */
  readonly failed?: boolean;
}

/** Plugins can only make an action stricter. */
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
    /** Other projects it works in too, each in a new checkout of its own, as `worktree` is here. */
    readonly also?: ReadonlyArray<{
      readonly project: string;
      readonly checkout: string;
      readonly baseBranch: string;
      readonly worktrees: string;
    }>;
    /** Folders it works in already, for a run that continues: no new checkout. */
    readonly dirs?: ReadonlyArray<string>;
    /** The checkout it goes on in, one a run left work in: no new checkout is made. */
    readonly reuse?: string | undefined;
    /** Provenance is returned only when this launch created a new worktree, never for reuse. */
  }) => Effect.Effect<
    PeerHubStartAgentResult & {
      readonly threadKey: string;
      /** The checkout it runs in, new or reused. */
      readonly root?: string;
      readonly worktree?: { readonly root: string; readonly identity: string };
      /** One for each of `also`, in its order. */
      readonly alsoTrees?: ReadonlyArray<{ readonly root: string; readonly identity: string }>;
    },
    PeerHubError
  >;
}
