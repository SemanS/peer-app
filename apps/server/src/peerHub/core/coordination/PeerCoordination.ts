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
  PEER_LOCAL_WORKSPACE,
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
import * as Option from "effect/Option";

import * as ServerConfig from "../../../config.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as ProjectService from "../../../project/ProjectService.ts";
import { harnessForDriver } from "../../hubPolicy.ts";
import { queueCoordinationWake } from "../../coordinationWake.ts";
import { LocalAuthority } from "../localCoordination/LocalAuthority.ts";
import { localPlace } from "../localCoordination/localPlace.ts";
import { withLocalCoordination } from "../localCoordination/localHost.ts";
import { CoordinationBroker } from "../broker/Broker.ts";
import type { PeerBrokerHost, PeerBrokerPlugins } from "../broker/host.ts";
import { socketPathFits } from "../broker/server.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import * as PeerIndex from "../index/PeerIndex.ts";
import { run } from "../local.ts";
import { currentRef } from "../vcs.ts";
import { readCommittedSince, readGitStatus } from "./edits.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import { projectKey } from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as PeerWork from "../work/PeerWork.ts";
import * as PeerWorkspaces from "../workspaces/PeerWorkspaces.ts";
import { taskName, taskNamed, tasksOf } from "../work/report.ts";
import * as PeerLog from "../log/PeerLog.ts";
import * as PeerAgents from "./PeerAgents.ts";

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

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

/**
 * What the plugins contribute to the broker now: the active ones, every plugin's commands (those of
 * inactive plugins with why they are refused, and the names of those a build excludes), the runtime
 * that runs agents beside Peer's threads, what adds entries to agents' index, and what each adds to
 * a coordination report.
 */
export const brokerPlugins = Effect.gen(function* () {
  const plugins = yield* PeerPlugins.PeerPlugins;
  const active = yield* plugins.active;
  // The runtime's observations (herdr's) fit within the Hub's bound after every other plugin's
  // sessions (memory's runtimes), so the plugin that fills the runtime slot adds to a report last.
  const reporting = active.toSorted(
    (a, b) =>
      Number(a.contributions.runtime !== undefined) - Number(b.contributions.runtime !== undefined),
  );
  return {
    active,
    commands: (yield* plugins.built).flatMap(({ state, contributions, unserved }) =>
      (contributions.commands ?? []).map((command) => ({
        plugin: state.id,
        command,
        ...(state.active
          ? {}
          : {
              refused:
                state.reason === PEER_PLUGIN_REASONS.hub
                  ? "hub"
                  : state.reason === PEER_PLUGIN_REASONS.hubUnknown
                    ? "hub-unknown"
                    : "off",
            }),
        ...(unserved === undefined ? {} : { unserved }),
      })),
    ),
    excluded: yield* plugins.excluded,
    runtime: PeerPlugins.capability(
      active.map((plugin) => plugin.contributions),
      "runtime",
    ),
    indexSource: PeerPlugins.capability(
      active.map((plugin) => plugin.contributions),
      "indexSource",
    ),
    reportSessions: reporting.flatMap(({ id, contributions }) =>
      contributions.reportSessions === undefined
        ? []
        : [{ plugin: id, add: contributions.reportSessions }],
    ),
  } satisfies PeerBrokerPlugins;
});

export class PeerCoordination extends Context.Service<
  PeerCoordination,
  {
    readonly paths: CoordinationPaths;
    readonly localView: Effect.Effect<import("../hub/coordApi.ts").HubCoordView, PeerHubError>;
    /** Starts the broker; one already running stays. */
    readonly start: Effect.Effect<void, PeerHubError>;
    /** Stops the broker; its agents' contexts pass to the next agents on their work. */
    readonly stop: Effect.Effect<void>;
    /** The running broker, null while coordination is off; the status reads its snapshot. */
    readonly broker: () => CoordinationBroker | null;
    /** The Hub says a workspace's coordination changed: the broker reads it within a moment. */
    readonly hubChanged: Effect.Effect<void>;
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
  const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
  const agents = yield* PeerAgents.PeerAgents;
  const index = yield* PeerIndex.PeerIndex;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
  const services = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(services);
  const runFork = Effect.runForkWith(services);
  const { environmentId } = state;
  const current = state.current;
  const hubApi = client.api;
  const publish = status.publish;

  const dir = NodePath.join(config.stateDir, "coord");
  const preferredSocket = NodePath.join(config.stateDir, "coord.sock");
  const log = yield* PeerLog.PeerLog;
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
        if (records.providerThreads.some((p) => p.nativeThreadRef?.nativeId === nativeId)) {
          return `peer:${thread.id}`;
        }
      }
      return undefined;
    }).pipe(Effect.orElseSucceed(() => undefined));

  const withHub = <A>(
    call: (hubUrl: string, session: string) => Effect.Effect<A, PeerHubError>,
  ): Promise<A> =>
    runPromise(client.session.pipe(Effect.flatMap(({ hubUrl, session }) => call(hubUrl, session))));

  const local = new LocalAuthority(NodePath.join(dir, "local-state.json"), environmentId);
  const host = () =>
    withLocalCoordination(hubHost(), local, async (cwd) =>
      localPlace(
        cwd,
        (await runPromise(projects.listShells())).map((project) => project.workspaceRoot),
      ),
    );
  const hubHost = (): PeerBrokerHost => ({
    socketPath: paths.socket,
    scriptsDir: paths.dir,
    logPath: paths.log,
    log,
    contextsDir: paths.contexts,
    environment: environmentId,
    placeOf: (cwd) => runPromise(state.placeOf(cwd)),
    branchOf: currentRef,
    gitStatus: readGitStatus,
    gitHead: async (root) => {
      const head = await run("git", ["-C", root, "rev-parse", "--verify", "-q", "HEAD"]).catch(
        () => "",
      );
      return head === "" ? undefined : head;
    },
    gitCommittedSince: readCommittedSince,
    threadOf: (nativeId) => runPromise(threadOf(nativeId)),
    threadRuntime: work.runtimeOf,
    threadAgent: (key) =>
      runPromise(
        Effect.gen(function* () {
          const id = key.replace(/^peer:/, "");
          const shell = yield* projections.getShellSnapshot({ location: "active" });
          const thread = shell.threads.find((thread) => thread.id === id);
          if (thread === undefined) return null;
          const records = yield* projections.getThreadRecords(thread.id, ["providerThreads"]);
          const provider = records.providerThreads.find(
            (provider) => provider.id === thread.activeProviderThreadId,
          );
          const agent = provider === undefined ? undefined : harnessForDriver(provider.driver);
          const project = yield* projects.getById(thread.projectId);
          if (agent === undefined || Option.isNone(project)) return null;
          return {
            agent,
            cwd: thread.worktreePath ?? project.value.workspaceRoot,
            ...(provider?.nativeThreadRef?.nativeId == null
              ? {}
              : { nativeId: provider.nativeThreadRef.nativeId }),
          };
        }).pipe(Effect.orElseSucceed(() => null)),
      ),
    resumableThreads: () => runPromise(work.resumableThreads),
    queueNative: async (session, text, thread) => {
      const separator = session.indexOf(":");
      const outcome = await runPromise(
        queueCoordinationWake(session.slice(separator + 1), text, thread, {
          agent: session.slice(0, separator),
          resume: true,
        }).pipe(
          Effect.provideService(ProjectionStore.ProjectionStoreV2, projections),
          Effect.provideService(
            ProviderContinuationRequests.ProviderContinuationRequests,
            continuationRequests,
          ),
          Effect.orElseSucceed(() => "unavailable" as const),
        ),
      );
      return outcome === "queued";
    },
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
    nameOf: state.nameOf,
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
    createTask: (workspace, projectId, task) =>
      runPromise(work.createTask({ workspace, projectId, ...task }).pipe(Effect.asVoid)),
    updateTask: (workspace, projectId, taskId, change) =>
      runPromise(work.updateTask({ workspace, projectId, taskId, ...change }).pipe(Effect.asVoid)),
    deleteTask: (workspace, projectId, taskId) =>
      runPromise(work.deleteTask({ workspace, projectId, taskId }).pipe(Effect.asVoid)),
    shareFolder: async (cwd, workspace, name) => {
      const root = await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]).catch(() => cwd);
      const local = await runPromise(
        projects.getByWorkspaceRoot(root).pipe(Effect.orElseSucceed(() => Option.none())),
      );
      if (Option.isNone(local))
        throw Object.assign(
          new Error(`Peer has no project for ${root}; your person opens the folder in Peer first.`),
          { refused: true },
        );
      const before = new Set(
        current()
          .persisted.workspaces.find((w) => w.slug === workspace)
          ?.manifest?.projects.map((p) => p.id) ?? [],
      );
      await runPromise(
        workspaces.shareProject({
          workspace,
          projectId: local.value.id,
          ...(name === undefined ? {} : { name }),
        }),
      );
      const added = current()
        .persisted.workspaces.find((w) => w.slug === workspace)
        ?.manifest?.projects.find((p) => !before.has(p.id));
      return { project: added?.id ?? "", name: added?.name ?? name ?? local.value.title };
    },
    taskDone: (workspace, project, task) =>
      tasksOf(current().work, workspace, project).find((candidate) => candidate.id === task)
        ?.status === "done",
    work: (workspace, project) => current().work.get(projectKey(workspace, project))?.threads ?? [],
    workKnown: (workspace, project) => current().work.has(projectKey(workspace, project)),
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
      ).then((answer) => {
        // The Hub did not move a task that waits for an owner's call: nothing changed to read.
        if (!("ownerCallNeeded" in answer))
          void runFork(work.refresh().pipe(state.lock.withPermits(1), Effect.ignore));
        return answer;
      }),
    changed: () => void runFork(publish.pipe(Effect.ignore)),
    plugins: () =>
      runPromise(brokerPlugins.pipe(Effect.provideService(PeerPlugins.PeerPlugins, plugins))),
    run: (effect, options) => runPromise(effect, options),
  });

  let broker: CoordinationBroker | null = null;

  const start: PeerCoordination["Service"]["start"] = Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        if (broker !== null) return;
        const created = new CoordinationBroker(host());
        await created.start();
        broker = created;
      },
      catch: (failure) => hubError(`Agent coordination could not start: ${messageOf(failure)}`),
    });
    yield* agents.attach(broker);
    yield* index.attach(broker);
  });

  const stop: PeerCoordination["Service"]["stop"] = Effect.gen(function* () {
    yield* agents.attach(null);
    yield* index.attach(null);
    yield* Effect.promise(async () => {
      const running = broker;
      broker = null;
      await running?.stop();
      if (running !== null) await local.report([]);
    });
  });
  yield* Effect.addFinalizer(() => stop);

  /** A person's action on an overlap through the running broker: its agents hear of it at once. */
  const onBroker = <A>(act: () => Promise<A>) =>
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
      yield* onBroker(() =>
        host().note(input.workspace, input.project, input.overlap, input.text, undefined),
      );
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
      yield* onBroker(() =>
        host().resolve(input.workspace, input.project, input.overlap, input.resolution, undefined),
      );
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
    onBroker(() => host().readContext(input.workspace, input.project, input.scope)).pipe(
      Effect.map((context) =>
        context === null
          ? null
          : { ...context, workspace: input.workspace, bytes: context.bytes ?? context.text.length },
      ),
    );

  const coordEvents: PeerCoordination["Service"]["coordEvents"] = Effect.fn(
    "PeerCoordination.coordEvents",
  )(function* (input) {
    if (input.workspace === PEER_LOCAL_WORKSPACE)
      return yield* onBroker(() => local.coordEvents(input.project, input));
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
    if (input.workspace === PEER_LOCAL_WORKSPACE)
      return yield* onBroker(() => local.staleReads(input.project, input.session));
    yield* state.project(input.workspace, input.project);
    const { hubUrl, session } = yield* client.session;
    return yield* hubApi.staleReads(hubUrl, session, input.workspace, input.project, input);
  });

  const contextVersions: PeerCoordination["Service"]["contextVersions"] = (input) =>
    onBroker(() => host().contextVersions(input.workspace, input.project, input.scope));

  const readContextVersion: PeerCoordination["Service"]["readContextVersion"] = (input) =>
    onBroker(() =>
      host().readContextVersion(input.workspace, input.project, input.scope, input.version),
    );

  const restoreContext: PeerCoordination["Service"]["restoreContext"] = Effect.fn(
    "PeerCoordination.restoreContext",
  )(function* (input) {
    if (input.workspace === PEER_LOCAL_WORKSPACE) {
      yield* onBroker(() => local.restoreContext(input.project, input.scope, input.version));
      broker?.hubChanged();
      return yield* publish;
    }
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
    localView: onBroker(() => local.view()),
    start,
    stop,
    broker: () => broker,
    hubChanged: Effect.sync(() => broker?.hubChanged()),
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
