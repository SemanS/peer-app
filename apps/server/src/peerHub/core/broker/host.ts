/**
 * What the coordination broker runs on: one host, built from core's services and the active
 * plugins (`core/coordination/PeerCoordination.ts`), or from fakes in tests (`testkit.ts`). The
 * broker keeps its Promise-based internals (a Node socket server, timers), so the host speaks
 * Promises, and runs plugins' Effects with the runtime it captured when the broker started.
 *
 * @module peerHub/core/broker/host
 */
import type {
  PeerContextRead,
  PeerCoordEvent,
  PeerCoordinationPolicy,
  PeerStaleReads,
  PeerWorkStatus,
  PeerWorkThread,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type {
  ContextRefusal,
  HubContextText,
  HubContextVersion,
  HubContextVersionText,
  HubCoordView,
  HubIntentAnswer,
  HubIntentRequest,
  HubOverlap,
  HubUnsupported,
  ReportedSession,
} from "../hub/coordApi.ts";
import type {
  PeerCommand,
  PeerContributions,
  PeerIndexSource,
  PeerRuntimeProvider,
} from "../plugin.ts";
import type { ActivePlugin, ExcludedCommand } from "../plugins/PeerPlugins.ts";

export interface CheckoutPlace {
  readonly workspace: string;
  readonly project: string;
  /** The repository's working tree the agent is in. */
  readonly root: string;
  readonly repositoryId?: string;
}

/** What the plugins contribute now, read once per hook, command or sync round. */
export interface PeerBrokerPlugins {
  /** The active plugins, in registry order. */
  readonly active: ReadonlyArray<ActivePlugin>;
  /**
   * Every plugin's commands, active or not, in registry order; `refused` says why one of an
   * inactive plugin is not run: turned off here, or not served by the Hub.
   */
  readonly commands: ReadonlyArray<{
    readonly plugin: string;
    readonly command: PeerCommand;
    readonly refused?: "off" | "hub";
    /** Why the Hub does not serve its plugin, when the plugin says (`PeerPluginInfo.unserved`). */
    readonly unserved?: string;
  }>;
  /** The commands of the plugins this build excludes, which only ever answer a refusal. */
  readonly excluded: ReadonlyArray<ExcludedCommand>;
  /** The runtime that runs agents beside Peer's own threads (herdr), if one does. */
  readonly runtime: PeerRuntimeProvider | undefined;
  /** What adds entries to an agent's index (knowledge's `.ai`), if anything does. */
  readonly indexSource: PeerIndexSource | undefined;
  /** What plugins add to each coordination report (herdr's observations, memory's runtimes), in order. */
  readonly reportSessions: ReadonlyArray<{
    readonly plugin: string;
    readonly add: NonNullable<PeerContributions["reportSessions"]>;
  }>;
}

/** No plugin at all: what the broker works with when none is registered. */
export const NO_PLUGINS: PeerBrokerPlugins = {
  active: [],
  commands: [],
  excluded: [],
  runtime: undefined,
  indexSource: undefined,
  reportSessions: [],
};

export interface PeerBrokerHost {
  // ---- where coordination keeps its files ----
  readonly socketPath: string;
  readonly scriptsDir: string;
  readonly logPath: string;
  readonly log: import("../metricsLog.ts").MetricsLog;
  /** Where agents keep their working contexts, one file per session. */
  readonly contextsDir: string;
  readonly environment: string;

  // ---- this computer ----
  /** The workspace project a directory belongs to, or null outside them. */
  readonly placeOf: (cwd: string) => Promise<CheckoutPlace | null>;
  readonly branchOf: (root: string) => Promise<string | undefined>;
  /** What `git status --porcelain -z` says in a repository: its changed files. */
  readonly gitStatus: (root: string) => Promise<string>;
  /**
   * The Peer thread (`peer:<thread id>`) whose agent runs as this provider session, by the session
   * id its harness gives hooks; none for an agent Peer does not run (a runtime's, a terminal's).
   */
  readonly threadOf: (nativeId: string) => Promise<string | undefined>;
  /**
   * How the provider runtime of a Peer thread's session ran at the last work report; null when it
   * did not. Absent: nothing is known of Peer threads' runtimes.
   */
  readonly threadRuntime?: (thread: string, session: string) => PeerWorkStatus | null;
  readonly threadAgent?: (
    thread: string,
  ) => Promise<{ readonly agent: string; readonly nativeId?: string; readonly cwd: string } | null>;
  /**
   * Gives an idle Codex session a message, which starts its turn (Codex has no hook that wakes
   * it). False when Codex could not take it.
   */
  readonly queueCodex: (session: string, text: string, thread?: string) => Promise<boolean>;

  // ---- people, policy and work ----
  readonly nameOf: (workspace: string, email: string) => string;
  readonly email: () => string | null;
  readonly policy: () => PeerCoordinationPolicy;
  /** Workspaces whose overlaps people here should see. */
  readonly workspaces: () => ReadonlyArray<string>;
  /**
   * The task a session works on: the one its thread was put on (the first of `keys` with one),
   * else the one its branch or label names by key.
   */
  readonly taskOf: (
    workspace: string,
    project: string,
    keys: ReadonlyArray<string>,
    texts: ReadonlyArray<string | undefined>,
  ) => string | undefined;
  /** A project's tasks as Peer knows them. */
  readonly tasks: (
    workspace: string,
    project: string,
  ) => ReadonlyArray<{
    readonly id: string;
    readonly key?: string | undefined;
    readonly title: string;
    readonly status?: string | undefined;
  }>;
  /** A task as people name it, e.g. `KRK-335 · DNS errors`. */
  readonly taskName: (workspace: string, project: string, task: string) => string;
  /** Whether a task was closed. */
  readonly taskDone: (workspace: string, project: string, task: string) => boolean;
  /** Durable unfinished work, including sessions no longer available to answer an ask. */
  readonly work?: (workspace: string, project: string) => ReadonlyArray<PeerWorkThread>;

  // ---- the Hub ----
  readonly report: (
    workspace: string,
    sessions: ReadonlyArray<ReportedSession>,
  ) => Promise<HubCoordView>;
  readonly view: (workspace: string) => Promise<HubCoordView>;
  /** `op` names the command: the hub adds no second note for the same one. */
  readonly note: (
    workspace: string,
    project: string,
    overlap: string,
    text: string,
    session: string | undefined,
    op?: string,
  ) => Promise<HubOverlap>;
  readonly resolve: (
    workspace: string,
    project: string,
    overlap: string,
    resolution: string,
    session: string | undefined,
    op?: string,
  ) => Promise<HubOverlap>;
  /**
   * Asks the hub to decide an agent's intent to change files, and answers within `timeoutMs` or
   * fails: its verdict on each path (it registered the session as their holder in the same step),
   * or that this hub has no such thing. Absent: as a hub without it.
   */
  readonly intent?: (
    workspace: string,
    project: string,
    request: HubIntentRequest,
    timeoutMs: number,
  ) => Promise<HubIntentAnswer | HubUnsupported>;
  /** A session acknowledges an overlap; the overlap as the hub has it, or that this hub has no such thing. */
  readonly ack?: (
    workspace: string,
    project: string,
    overlap: string,
    session: string,
    op: string,
    filesAt?: string,
  ) => Promise<HubOverlap | HubUnsupported>;
  /** A shared context with its text, or null when it has none. */
  readonly readContext: (
    workspace: string,
    project: string,
    scope: string,
  ) => Promise<HubContextText | null>;
  readonly contextRead?: (
    workspace: string,
    project: string,
    scope: string,
    session: string,
    version: number,
    op: string,
  ) => Promise<PeerContextRead>;
  readonly staleReads?: (
    workspace: string,
    project: string,
    session: string,
  ) => Promise<PeerStaleReads>;
  readonly coordEvents?: (
    workspace: string,
    project: string,
    filter: { readonly task?: string; readonly path?: string; readonly limit?: number },
  ) => Promise<ReadonlyArray<PeerCoordEvent>>;
  /** Asks for a session to keep a shared context, or gives it up (`release`). */
  readonly keepContext: (
    workspace: string,
    project: string,
    scope: string,
    session: string,
    release: boolean,
    epoch?: number,
    op?: string,
  ) => Promise<HubContextText | ContextRefusal>;
  /** A new version of a shared context from the session that keeps it. */
  readonly writeContext: (
    workspace: string,
    project: string,
    scope: string,
    session: string,
    baseVersion: number,
    text: string,
    epoch?: number,
    op?: string,
  ) => Promise<HubContextText | ContextRefusal>;
  /** The versions of a shared context the hub keeps, newest first. */
  readonly contextVersions: (
    workspace: string,
    project: string,
    scope: string,
  ) => Promise<ReadonlyArray<HubContextVersion>>;
  readonly readContextVersion: (
    workspace: string,
    project: string,
    scope: string,
    version: number,
  ) => Promise<HubContextVersionText | null>;
  readonly finishTask?: (
    workspace: string,
    project: string,
    task: string,
    session: string,
    status: "review" | "done",
    op: string,
  ) => Promise<unknown>;

  // ---- what people see ----
  /** What people see changed. */
  readonly changed: () => void;

  // ---- plugins ----
  /** What the active plugins contribute now. */
  readonly plugins: () => Promise<PeerBrokerPlugins>;
  /**
   * Runs a plugin's contribution with the runtime the host captured when the broker started; an
   * aborted `signal` interrupts it.
   */
  readonly run: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<A>;
}
