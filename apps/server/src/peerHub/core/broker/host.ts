/**
 * What the coordination broker runs on: one host, built from core's services and the active
 * plugins (`core/coordination/PeerCoordination.ts`), or from fakes in tests (`testkit.ts`). The
 * broker keeps its Promise-based internals (a Node socket server, timers), so the host speaks
 * Promises, and runs plugins' Effects with the runtime it captured when the broker started.
 *
 * @module peerHub/core/broker/host
 */
import type { PeerCoordEvent, PeerWorkStatus, PeerWorkThread } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type { ResumableNativeThread } from "../../workLifecycle.ts";

import type { PeerHubContinueRunInput, PeerHubContinueRunResult } from "@t3tools/contracts";
import type {
  HubCoordView,
  HubIntentAnswer,
  HubIntentRequest,
  ReportedSession,
} from "../hub/coordApi.ts";
import type { PeerCommand, PeerContributions, PeerRuntimeProvider } from "../plugin.ts";
import type { ActivePlugin } from "../plugins/PeerPlugins.ts";
import type { RunBook } from "../work/runs.ts";

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
   * inactive plugin is not run: turned off here, not served by the Hub, or no Hub has answered yet.
   */
  readonly commands: ReadonlyArray<{
    readonly plugin: string;
    readonly command: PeerCommand;
    readonly refused?: "off" | "hub" | "hub-unknown";
    /** Why it cannot run here, for a project the Hub's plugins do not reach (`pluginScope.ts`). */
    readonly unserved?: string;
  }>;
  /** The runtime that runs agents beside Peer's own threads (herdr), if one does. */
  readonly runtime: PeerRuntimeProvider | undefined;
  /** What plugins add to each coordination report (herdr's observations), in order. */
  readonly reportSessions: ReadonlyArray<{
    readonly plugin: string;
    readonly add: NonNullable<PeerContributions["reportSessions"]>;
  }>;
}

/** No plugin at all: what the broker works with when none is registered. */
export const NO_PLUGINS: PeerBrokerPlugins = {
  active: [],
  commands: [],
  runtime: undefined,
  reportSessions: [],
};

/** How a headless resumption ended: the process exited 0, it failed (`reason`), or it was killed at the timeout. */
export interface NativeResumeOutcome {
  readonly status: "ended" | "failed" | "timeout";
  readonly exit: number | null;
  readonly reason?: string;
  /** The end of what the CLI printed on stderr. */
  readonly stderr?: string;
}

export interface PeerBrokerHost {
  readonly socketPath: string;
  readonly scriptsDir: string;
  readonly logPath: string;
  readonly log: import("../metricsLog.ts").MetricsLog;
  /** Where each session's memory file is kept (`sessionMemory.ts`). */
  readonly memoryDir: string;
  /** Where a Peer from before kept the memory file at `path`. */
  readonly formerMemoryPath: (path: string) => string;
  readonly environment: string;

  /** This computer's runs (`core/work/runs.ts`). Absent: sessions run without runs, as before them. */
  readonly runs?: RunBook;

  /** The run's checkout in another project that holds `path`, if any (`core/work/runRoots.ts`). */
  readonly runRootAt?: (
    run: string,
    path: string,
  ) => Promise<
    { readonly project: string; readonly task: string; readonly root: string } | undefined
  >;
  /** The workspace project a directory belongs to, or null outside them. */
  readonly placeOf: (cwd: string) => Promise<CheckoutPlace | null>;
  /**
   * The line a binding of a clone by its remote left for the folder `cwd` is in ("Bound ~/work/pay
   * to acme/pay.", or which projects share its repository), cleared by reading it; null when
   * nothing waits there. The next session started in that folder says it once.
   */
  readonly bindingNotice?: (cwd: string) => Promise<string | null>;
  readonly branchOf: (root: string) => Promise<string | undefined>;
  /** What `git status --porcelain -z` says in a repository: its changed files. */
  readonly gitStatus: (root: string) => Promise<string>;
  /** The commit HEAD names in a repository; undefined where there is none. */
  readonly gitHead?: (root: string) => Promise<string | undefined>;
  /**
   * The files of the commits made on top of `from` since `sinceMs`, merges left out: what a shell
   * command committed in the same breath as it changed them, which `gitStatus` no longer shows.
   */
  readonly gitCommittedSince?: (
    root: string,
    from: string,
    sinceMs: number,
  ) => Promise<ReadonlyArray<string>>;
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
  /** Native conversations whose processes were released only because they were idle. */
  readonly resumableThreads?: () => Promise<ReadonlyArray<ResumableNativeThread>>;
  readonly queueNative?: (session: string, text: string, thread: string) => Promise<boolean>;
  /** Continues a detached run, as `peerHub.continueRun` does. */
  readonly continueRun?: (input: PeerHubContinueRunInput) => Promise<PeerHubContinueRunResult>;
  /** An admitted native update still queued or running; false only after authoritative cancellation or retirement. */
  readonly nativeWakePending?: (session: string, thread: string) => Promise<boolean>;
  /**
   * Gives an idle Codex session a message, which starts its turn (Codex has no hook that wakes
   * it). False when Codex could not take it.
   */
  readonly queueCodex: (session: string, text: string, thread?: string) => Promise<boolean>;

  readonly nameOf: (workspace: string, email: string) => string;
  readonly email: () => string | null;
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
    readonly area?: string | undefined;
    readonly status?: string | undefined;
    /** The task it sits under; absent: a root (or a Hub without the tree). */
    readonly parent?: string | undefined;
    readonly kind?: "group" | "task" | undefined;
    readonly executable?: boolean | undefined;
    readonly unsettled?: boolean | undefined;
    readonly position?: number | undefined;
    readonly chat?: boolean | undefined;
    /** Over its executable descendants, as the Hub counts them. */
    readonly progress?: { readonly done: number; readonly total: number } | undefined;
  }>;
  /** Adds a task to a project, with the person's rights. Absent: this Peer cannot. */
  readonly createTask?: (
    workspace: string,
    project: string,
    task: {
      readonly title: string;
      readonly key?: string;
      readonly area?: string;
      readonly parent?: string;
      readonly kind?: "group" | "task";
      readonly executable?: boolean;
    },
  ) => Promise<void>;
  /** Opens a chat of a project, a task nobody works from; its id. Absent: this Peer cannot. */
  readonly createChat?: (
    workspace: string,
    project: string,
    title: string,
  ) => Promise<string | undefined>;
  /** Changes a task's title, area (empty clears it), status or place in the tree (`parent: ""` makes it a root). */
  readonly updateTask?: (
    workspace: string,
    project: string,
    task: string,
    change: {
      readonly title?: string;
      readonly area?: string;
      readonly status?: "open" | "review" | "done";
      readonly parent?: string;
      readonly executable?: boolean;
      readonly position?: number;
    },
  ) => Promise<void>;
  readonly deleteTask?: (workspace: string, project: string, task: string) => Promise<void>;
  /**
   * Shares the project this folder is on this computer with a workspace, as "Share a project with
   * your team" does. Absent: this Peer cannot.
   */
  readonly shareFolder?: (
    cwd: string,
    workspace: string,
    name: string | undefined,
  ) => Promise<{ readonly project: string; readonly name: string }>;
  /** A task as people name it, e.g. `KRK-335 · DNS errors`. */
  readonly taskName: (workspace: string, project: string, task: string) => string;
  /** Whether a task was closed. */
  readonly taskDone: (workspace: string, project: string, task: string) => boolean;
  /** Durable unfinished work, including sessions no longer available to answer an ask. */
  readonly work?: (workspace: string, project: string) => ReadonlyArray<PeerWorkThread>;

  readonly report: (
    workspace: string,
    sessions: ReadonlyArray<ReportedSession>,
  ) => Promise<HubCoordView>;
  readonly view: (workspace: string) => Promise<HubCoordView>;
  /**
   * Tells the hub of an agent's intent to change files, and answers within `timeoutMs` or fails: what
   * it says of each path (it registered the session as their holder in the same step). Absent: a
   * host with no hub to tell.
   */
  readonly intent?: (
    workspace: string,
    project: string,
    request: HubIntentRequest,
    timeoutMs: number,
  ) => Promise<HubIntentAnswer>;
  readonly coordEvents?: (
    workspace: string,
    project: string,
    filter: { readonly task?: string; readonly path?: string; readonly limit?: number },
  ) => Promise<ReadonlyArray<PeerCoordEvent>>;
  /** What people see changed. */
  readonly changed: () => void;

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
