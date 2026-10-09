// @effect-diagnostics nodeBuiltinImport:off - the broker's socket path and git probes of agents' directories.
/**
 * PeerCoordination: agents on the same project staying out of each other's way (experimental).
 *
 * While coordination is on, a broker listens on a local socket: agents' hooks and the `peer`
 * command talk to it, and it reports their sessions to each workspace's Hub, which decides their
 * edits. The broker runs on one host built here from core's services and the active plugins:
 * places and people from PeerState, work from PeerWork, Hub calls through PeerHubClient, and what
 * plugins add (a runtime's panes, states and wake; sessions for the report). People note, resolve
 * and settle overlaps, and read shared contexts, through this service too.
 *
 * @module peerHub/core/coordination/PeerCoordination
 */
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  PEER_PLUGIN_REASONS,
  PeerHubError,
  type PeerContextVersion,
  type PeerContextVersionText,
  type PeerCoordEvent,
  type PeerHubContextInput,
  type PeerHubContextVersionInput,
  type PeerHubCoordEventsInput,
  type PeerHubOverlapNoteInput,
  type PeerHubResolveOverlapInput,
  type PeerHubSettleOverlapInput,
  type PeerHubStaleReadsInput,
  type PeerHubStatus,
  type PeerStaleReads,
  type PeerWorkContextText,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../../config.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProviderContinuationRequests from "../../../orchestration-v2/ProviderContinuationRequests.ts";
import { taskNamed } from "../../coordination.ts";
import { CoordinationBroker, socketPathFits } from "../../coordinationBroker.ts";
import { queueCoordinationWake } from "../../coordinationWake.ts";
import * as Knowledge from "../../knowledge.ts";
import type {
  BrokerMemory,
  CheckoutPlace,
  PeerBrokerHost,
  PeerBrokerPlugins,
} from "../broker/host.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { run } from "../local.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import { projectKey, realpathOrSelf } from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as PeerWork from "../work/PeerWork.ts";
import { taskName, tasksOf } from "../work/report.ts";

/** Where coordination keeps its files. */
export interface CoordinationPaths {
  /** Peer's scripts for agents' hooks, and the agents' working contexts below it. */
  readonly dir: string;
  /** The broker's Unix socket, which only this user may open. */
  readonly socket: string;
  /** Every coordination event, one JSON line each. */
  readonly log: string;
  /** Agents' working contexts, one file per session. */
  readonly contexts: string;
  /** The `peer` command agents run. */
  readonly peer: string;
  /** The hook scripts agents' harnesses run. */
  readonly scripts: { readonly hook: string; readonly wait: string };
}

/** Broker callbacks of features not moved into plugins yet; the PeerHub facade sets them. */
export interface PeerCoordinationFacadeParts {
  readonly memory?: BrokerMemory;
}

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

/**
 * What the plugins contribute to the broker now: the active ones, every plugin's commands (those of
 * inactive plugins with why they are refused), the runtime that runs agents beside Peer's threads,
 * and what each adds to a coordination report.
 */
export const brokerPlugins = Effect.gen(function* () {
  const plugins = yield* PeerPlugins.PeerPlugins;
  const active = yield* plugins.active;
  // The active plugins' contributions come first; the rest are the facade's stand-ins.
  const standIns = (yield* plugins.contributions).slice(active.length);
  const reporting = [
    ...active.map((plugin) => ({ plugin: plugin.id, contributions: plugin.contributions })),
    ...standIns.map((contributions) => ({ plugin: "peerHub", contributions })),
  ];
  return {
    active,
    commands: (yield* plugins.built).flatMap(({ state, contributions }) =>
      (contributions.commands ?? []).map((command) => ({
        plugin: state.id,
        command,
        ...(state.active
          ? {}
          : { refused: state.reason === PEER_PLUGIN_REASONS.hub ? "hub" : "off" }),
      })),
    ),
    runtime: PeerPlugins.capability(
      [...active.map((plugin) => plugin.contributions), ...standIns],
      "runtime",
    ),
    reportSessions: reporting.flatMap(({ plugin, contributions }) =>
      contributions.reportSessions === undefined
        ? []
        : [{ plugin, add: contributions.reportSessions }],
    ),
  } satisfies PeerBrokerPlugins;
});

export class PeerCoordination extends Context.Service<
  PeerCoordination,
  {
    readonly paths: CoordinationPaths;
    /** Starts the broker; one already running stays. */
    readonly start: Effect.Effect<void, PeerHubError>;
    /** Stops the broker; its agents' contexts pass to the next agents on their work. */
    readonly stop: Effect.Effect<void>;
    /** The running broker, null while coordination is off; for features that are no plugins yet. */
    readonly broker: () => CoordinationBroker | null;
    /** The Hub says a workspace's coordination changed: the broker reads it within a moment. */
    readonly hubChanged: Effect.Effect<void>;
    /** The workspace project a directory is in, and the repository working tree around it. */
    readonly placeOf: (cwd: string) => Effect.Effect<CheckoutPlace | null>;
    /** Sets what the facade still supplies; it does so while it starts, before the broker does. */
    readonly setFacadeParts: (parts: PeerCoordinationFacadeParts) => Effect.Effect<void>;
    /** A person's note on an overlap; both agents hear it. */
    readonly noteOverlap: (
      input: PeerHubOverlapNoteInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly resolveOverlap: (
      input: PeerHubResolveOverlapInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A person asks the agents on an overlap to settle it between them and close it. */
    readonly settleOverlap: (
      input: PeerHubSettleOverlapInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A task's shared context with its text; null when it has none yet. */
    readonly readContext: (
      input: PeerHubContextInput,
    ) => Effect.Effect<PeerWorkContextText | null, PeerHubError>;
    /** The versions of a shared context the hub keeps, newest first. */
    readonly contextVersions: (
      input: PeerHubContextInput,
    ) => Effect.Effect<ReadonlyArray<PeerContextVersion>, PeerHubError>;
    readonly readContextVersion: (
      input: PeerHubContextVersionInput,
    ) => Effect.Effect<PeerContextVersionText | null, PeerHubError>;
    /** Brings an older version of a shared context back; its keeper goes on from it. */
    readonly restoreContext: (
      input: PeerHubContextVersionInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly coordEvents: (
      input: PeerHubCoordEventsInput,
    ) => Effect.Effect<ReadonlyArray<PeerCoordEvent>, PeerHubError>;
    readonly staleReads: (
      input: PeerHubStaleReadsInput,
    ) => Effect.Effect<PeerStaleReads, PeerHubError>;
  }
>()("t3/peerHub/core/coordination/PeerCoordination") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const status = yield* PeerStatus.PeerStatus;
  const work = yield* PeerWork.PeerWork;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
  const services = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(services);
  const runFork = Effect.runForkWith(services);
  const { environmentId } = state;
  const current = state.current;
  const hubApi = client.api;
  const publish = status.publish;
  const facadeParts = yield* Ref.make<PeerCoordinationFacadeParts>({});

  const dir = NodePath.join(config.stateDir, "coord");
  const preferredSocket = NodePath.join(config.stateDir, "coord.sock");
  const paths: CoordinationPaths = {
    dir,
    socket: socketPathFits(preferredSocket)
      ? preferredSocket
      : NodePath.join(
          NodeOS.tmpdir(),
          `peer-coord-${NodeCrypto.createHash("sha256").update(config.stateDir).digest("hex").slice(0, 12)}.sock`,
        ),
    log: NodePath.join(config.logsDir, "coordination.jsonl"),
    contexts: NodePath.join(dir, "contexts"),
    peer: NodePath.join(dir, "bin", "peer"),
    scripts: { hook: NodePath.join(dir, "hook"), wait: NodePath.join(dir, "wait") },
  };

  const placeOf: PeerCoordination["Service"]["placeOf"] = (cwd) =>
    Effect.promise(async () => {
      const toplevel = await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]).catch(
        () => null,
      );
      if (toplevel === null || toplevel === "") return null;
      const { persisted } = current();
      // A worktree of a workspace checkout counts as that checkout.
      const common = await run("git", [
        "-C",
        cwd,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]).catch(() => null);
      const place =
        state.projectOfPath(persisted, toplevel) ??
        (common === null ? undefined : state.projectOfPath(persisted, NodePath.dirname(common)));
      return place === undefined
        ? null
        : {
            workspace: place.workspace,
            project: place.projectId,
            root: realpathOrSelf(toplevel),
            repositoryId: place.repositoryId,
          };
    });

  /** What the workspace calls a person. */
  const nameOf = (slug: string, email: string) => {
    const workspace = current().persisted.workspaces.find((w) => w.slug === slug);
    for (const project of workspace?.manifest?.projects ?? []) {
      const name = project.members.find((member) => member.email === email)?.name;
      if (name !== undefined && name !== "") return name;
    }
    // Someone the manifest does not name yet: ana.novak@… reads as Ana.
    const local = email.split("@")[0]?.split(/[._-]/)[0] ?? email;
    return local === "" ? email : `${local[0]?.toUpperCase() ?? ""}${local.slice(1)}`;
  };

  /**
   * The Peer thread whose agent runs as a provider session, by the session id its harness gives
   * hooks: Peer starts Claude Code with its thread's native id, and Codex's thread id is it too.
   * Threads at work come first, since a session's hooks start as its thread's turn does.
   */
  const threadOf = (nativeId: string) =>
    Effect.gen(function* () {
      const shell = yield* projections.getShellSnapshot({ location: "active" });
      // Only threads at work, or whose run started lately: a session's hooks start with its run.
      const lately = DateTime.toEpochMillis(yield* DateTime.now) - 15 * 60 * 1000;
      const candidates = shell.threads
        .filter(
          (thread) =>
            (thread.activityRunStatus ?? null) !== null ||
            (thread.latestRunStartedAt !== undefined &&
              thread.latestRunStartedAt !== null &&
              DateTime.toEpochMillis(thread.latestRunStartedAt) > lately),
        )
        .slice(0, 20);
      for (const thread of candidates) {
        const records = yield* projections.getThreadRecords(thread.id, ["providerThreads"]);
        if (
          records.providerThreads.some(
            (p) =>
              p.id === thread.activeProviderThreadId && p.nativeThreadRef?.nativeId === nativeId,
          )
        ) {
          return `peer:${thread.id}`;
        }
      }
      return undefined;
    }).pipe(Effect.orElseSucceed(() => undefined));

  const withHub = <A>(
    call: (hubUrl: string, session: string) => Effect.Effect<A, PeerHubError>,
  ): Promise<A> =>
    runPromise(client.session.pipe(Effect.flatMap(({ hubUrl, session }) => call(hubUrl, session))));

  const host = (parts: PeerCoordinationFacadeParts): PeerBrokerHost => ({
    socketPath: paths.socket,
    scriptsDir: paths.dir,
    logPath: paths.log,
    contextsDir: paths.contexts,
    environment: environmentId,
    ...(parts.memory === undefined ? {} : { memory: parts.memory }),
    placeOf: (cwd) => runPromise(placeOf(cwd)),
    branchOf: async (root) => {
      const name = await run("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]).catch(
        () => "",
      );
      return name === "" || name === "HEAD" ? undefined : name;
    },
    gitStatus: (root) =>
      run("git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
        raw: true,
      }),
    threadOf: (nativeId) => runPromise(threadOf(nativeId)),
    threadRuntime: work.runtimeOf,
    queueCodex: async (session, text, thread) => {
      // The coordination lab's made-up sessions are no threads of this person's Codex.
      if (process.env.PEER_CODEX_QUEUE === "off") return false;
      const admitted = await runPromise(
        queueCoordinationWake(session, text, thread).pipe(
          Effect.provideService(ProjectionStore.ProjectionStoreV2, projections),
          Effect.provideService(
            ProviderContinuationRequests.ProviderContinuationRequests,
            continuationRequests,
          ),
          Effect.orElseSucceed(() => "unavailable" as const),
        ),
      );
      if (admitted !== "unbound") return admitted === "queued";
      return run("codex", ["queue", "--thread", session, "--message", text], {
        timeoutMs: 20_000,
      }).then(
        () => true,
        () => false,
      );
    },
    projectGuidance: async (root) => (await Knowledge.projectGuidance(root))?.text ?? null,
    nameOf,
    email: () => current().persisted.email,
    policy: () => current().persisted.coordination?.policy ?? "coordinate",
    workspaces: () => {
      const { persisted } = current();
      return persisted.email === null ? [] : persisted.workspaces.map((w) => w.slug);
    },
    taskOf: (workspace, project, keys, texts) => {
      const s = current();
      for (const key of keys) {
        const assigned = s.persisted.assignments?.[key];
        if (
          assigned !== undefined &&
          assigned.workspace === workspace &&
          assigned.project === project
        ) {
          return assigned.task;
        }
      }
      return taskNamed(tasksOf(s.work, workspace, project), texts);
    },
    tasks: (workspace, project) => tasksOf(current().work, workspace, project),
    taskName: (workspace, project, task) => taskName(current().work, workspace, project, task),
    taskDone: (workspace, project, task) =>
      tasksOf(current().work, workspace, project).find((candidate) => candidate.id === task)
        ?.status === "done",
    work: (workspace, project) => current().work.get(projectKey(workspace, project))?.threads ?? [],
    report: (workspace, sessions) =>
      withHub((hubUrl, session) =>
        hubApi.reportCoordination(hubUrl, session, workspace, {
          environment: environmentId,
          sessions,
        }),
      ),
    view: (workspace) =>
      withHub((hubUrl, session) => hubApi.coordination(hubUrl, session, workspace)),
    note: (workspace, project, overlap, text, author, op) =>
      withHub((hubUrl, session) =>
        hubApi.noteOverlap(hubUrl, session, workspace, project, overlap, {
          ...(author === undefined ? {} : { session: author }),
          text,
          ...(op === undefined ? {} : { op }),
        }),
      ),
    resolve: (workspace, project, overlap, resolution, author, op) =>
      withHub((hubUrl, session) =>
        hubApi.resolveOverlap(hubUrl, session, workspace, project, overlap, {
          ...(author === undefined ? {} : { session: author }),
          resolution,
          ...(op === undefined ? {} : { op }),
        }),
      ),
    intent: (workspace, project, request, timeoutMs) =>
      withHub((hubUrl, session) =>
        hubApi.intent(hubUrl, session, workspace, project, request, { timeoutMs }),
      ),
    ack: (workspace, project, overlap, agentSession, op, filesAt) =>
      withHub((hubUrl, session) =>
        hubApi.ack(hubUrl, session, workspace, project, overlap, {
          session: agentSession,
          op,
          ...(filesAt === undefined ? {} : { filesAt }),
        }),
      ),
    readContext: (workspace, project, scope) =>
      withHub((hubUrl, session) => hubApi.readContext(hubUrl, session, workspace, project, scope)),
    contextRead: (workspace, project, scope, agentSession, version, op) =>
      withHub((hubUrl, session) =>
        hubApi.contextRead(hubUrl, session, workspace, project, scope, {
          environment: environmentId,
          session: agentSession,
          version,
          op,
        }),
      ),
    staleReads: (workspace, project, agentSession) =>
      withHub((hubUrl, session) =>
        hubApi.staleReads(hubUrl, session, workspace, project, {
          environment: environmentId,
          session: agentSession,
        }),
      ),
    coordEvents: (workspace, project, filter) =>
      withHub((hubUrl, session) => hubApi.coordEvents(hubUrl, session, workspace, project, filter)),
    keepContext: (workspace, project, scope, agentSession, release, epoch, op) =>
      withHub((hubUrl, session) =>
        hubApi.keepContext(hubUrl, session, workspace, project, scope, {
          environment: environmentId,
          session: agentSession,
          ...(release ? { release: true } : {}),
          ...(epoch === undefined ? {} : { epoch }),
          ...(op === undefined ? {} : { op }),
        }),
      ),
    writeContext: (workspace, project, scope, agentSession, baseVersion, text, epoch, op) =>
      withHub((hubUrl, session) =>
        hubApi.writeContext(hubUrl, session, workspace, project, scope, {
          environment: environmentId,
          session: agentSession,
          baseVersion,
          text,
          ...(epoch === undefined ? {} : { epoch }),
          ...(op === undefined ? {} : { op }),
        }),
      ),
    contextVersions: (workspace, project, scope) =>
      withHub((hubUrl, session) =>
        hubApi.contextVersions(hubUrl, session, workspace, project, scope),
      ),
    readContextVersion: (workspace, project, scope, version) =>
      withHub((hubUrl, session) =>
        hubApi.contextVersion(hubUrl, session, workspace, project, scope, version),
      ),
    finishTask: (workspace, project, task, agentSession, taskStatus, op) =>
      withHub((hubUrl, session) =>
        hubApi.updateTask(hubUrl, session, workspace, project, task, {
          status: taskStatus,
          session: agentSession,
          environment: environmentId,
          op,
        }),
      ).then(() => {
        void runFork(work.refresh().pipe(state.lock.withPermits(1), Effect.ignore));
      }),
    changed: () => void runFork(publish.pipe(Effect.ignore)),
    plugins: () =>
      runPromise(brokerPlugins.pipe(Effect.provideService(PeerPlugins.PeerPlugins, plugins))),
    run: (effect) => runPromise(effect),
  });

  let broker: CoordinationBroker | null = null;

  const start: PeerCoordination["Service"]["start"] = Effect.gen(function* () {
    const parts = yield* Ref.get(facadeParts);
    yield* Effect.tryPromise({
      try: async () => {
        if (broker !== null) return;
        const created = new CoordinationBroker(host(parts));
        await created.start();
        broker = created;
      },
      catch: (failure) => hubError(`Agent coordination could not start: ${messageOf(failure)}`),
    });
  });

  const stop: PeerCoordination["Service"]["stop"] = Effect.promise(async () => {
    const running = broker;
    broker = null;
    await running?.stop();
  });
  yield* Effect.addFinalizer(() => stop);

  /** A person's action on an overlap through the running broker: its agents hear of it at once. */
  const onBroker = (act: () => Promise<void>) =>
    Effect.tryPromise({ try: act, catch: (failure) => hubError(messageOf(failure)) });

  const noteOverlap: PeerCoordination["Service"]["noteOverlap"] = Effect.fn(
    "PeerCoordination.noteOverlap",
  )(function* (input) {
    const running = broker;
    if (running !== null) {
      yield* onBroker(() =>
        running.personNote(input.workspace, input.project, input.overlap, input.text),
      );
    } else {
      const { hubUrl, session } = yield* client.session;
      yield* hubApi.noteOverlap(hubUrl, session, input.workspace, input.project, input.overlap, {
        text: input.text,
      });
    }
    return yield* publish;
  });

  const resolveOverlap: PeerCoordination["Service"]["resolveOverlap"] = Effect.fn(
    "PeerCoordination.resolveOverlap",
  )(function* (input) {
    const running = broker;
    if (running !== null) {
      yield* onBroker(() =>
        running.personResolve(input.workspace, input.project, input.overlap, input.resolution),
      );
    } else {
      const { hubUrl, session } = yield* client.session;
      yield* hubApi.resolveOverlap(hubUrl, session, input.workspace, input.project, input.overlap, {
        resolution: input.resolution,
      });
    }
    return yield* publish;
  });

  const settleOverlap: PeerCoordination["Service"]["settleOverlap"] = Effect.fn(
    "PeerCoordination.settleOverlap",
  )(function* (input) {
    const running = broker;
    if (running === null) {
      return yield* hubError("Turn agent coordination on to have the agents settle it.");
    }
    yield* onBroker(() =>
      running.personSettle(input.workspace, input.project, input.overlap, input.message),
    );
    return yield* publish;
  });

  const readContext: PeerCoordination["Service"]["readContext"] = (input) =>
    client.session.pipe(
      Effect.flatMap(({ hubUrl, session }) =>
        hubApi.readContext(hubUrl, session, input.workspace, input.project, input.scope),
      ),
      Effect.map((context) =>
        context === null
          ? null
          : { ...context, workspace: input.workspace, bytes: context.bytes ?? context.text.length },
      ),
    );

  const coordEvents: PeerCoordination["Service"]["coordEvents"] = Effect.fn(
    "PeerCoordination.coordEvents",
  )(function* (input) {
    yield* state.project(input.workspace, input.project);
    const { hubUrl, session } = yield* client.session;
    return yield* hubApi.coordEvents(hubUrl, session, input.workspace, input.project, {
      ...(input.task === undefined ? {} : { task: input.task }),
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  });

  const staleReads: PeerCoordination["Service"]["staleReads"] = Effect.fn(
    "PeerCoordination.staleReads",
  )(function* (input) {
    yield* state.project(input.workspace, input.project);
    const { hubUrl, session } = yield* client.session;
    return yield* hubApi.staleReads(hubUrl, session, input.workspace, input.project, input);
  });

  const contextVersions: PeerCoordination["Service"]["contextVersions"] = (input) =>
    client.session.pipe(
      Effect.flatMap(({ hubUrl, session }) =>
        hubApi.contextVersions(hubUrl, session, input.workspace, input.project, input.scope),
      ),
    );

  const readContextVersion: PeerCoordination["Service"]["readContextVersion"] = (input) =>
    client.session.pipe(
      Effect.flatMap(({ hubUrl, session }) =>
        hubApi.contextVersion(
          hubUrl,
          session,
          input.workspace,
          input.project,
          input.scope,
          input.version,
        ),
      ),
    );

  const restoreContext: PeerCoordination["Service"]["restoreContext"] = Effect.fn(
    "PeerCoordination.restoreContext",
  )(function* (input) {
    const { hubUrl, session } = yield* client.session;
    yield* hubApi.restoreContext(
      hubUrl,
      session,
      input.workspace,
      input.project,
      input.scope,
      input.version,
    );
    // Its keeper here, if any, hears of it at its next step; the status follows the new version.
    broker?.hubChanged();
    return yield* publish;
  });

  return PeerCoordination.of({
    paths,
    start,
    stop,
    broker: () => broker,
    hubChanged: Effect.sync(() => broker?.hubChanged()),
    placeOf,
    setFacadeParts: (parts) => Ref.set(facadeParts, parts),
    noteOverlap,
    resolveOverlap,
    settleOverlap,
    readContext,
    contextVersions,
    readContextVersion,
    restoreContext,
    coordEvents,
    staleReads,
  });
});

export const layer = Layer.effect(PeerCoordination, make);
