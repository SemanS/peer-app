// @effect-diagnostics nodeBuiltinImport:off - the broker's socket path and git probes of agents' directories.
/**
 * PeerCoordination: agents on the same project staying out of each other's way (experimental).
 *
 * While coordination is on, a broker listens on a local socket: agents' hooks and the `peer`
 * command talk to it, and it reports their sessions to each workspace's Hub, which decides their
 * edits. The broker runs on one host built here from core's services and the active plugins:
 * places and people from PeerState, work from PeerWork, Hub calls through PeerHubClient, and what
 * plugins add (a runtime's panes, states and wake; sessions for the report). People note, resolve
 * and settle overlaps through this service too.
 *
 * @module peerHub/core/coordination/PeerCoordination
 */
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  MessageId,
  PEER_PLUGIN_REASONS,
  PEER_LOCAL_WORKSPACE,
  PeerHubError,
  type PeerCoordEvent,
  type PeerHubCoordEventsInput,
  type PeerHubOverlapNoteInput,
  type PeerHubResolveOverlapInput,
  type PeerHubSettleOverlapInput,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../../../config.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as ProjectService from "../../../project/ProjectService.ts";
import { queueCoordinationWake, coordinationWakePending } from "../../coordinationWake.ts";
import { LocalAuthority } from "../localCoordination/LocalAuthority.ts";
import { localPlace } from "../localCoordination/localPlace.ts";
import { localProjectsOf } from "../localCoordination/localProjects.ts";
import { withLocalCoordination } from "../localCoordination/localHost.ts";
import { CoordinationBroker } from "../broker/Broker.ts";
import { PeerBrokerKind } from "../broker/owner.ts";
import type { PeerBrokerHost, PeerBrokerPlugins } from "../broker/host.ts";
import { socketPathFits } from "../broker/server.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { run } from "../local.ts";
import { threadAgentOf, threadOfNative } from "./threadLookup.ts";
import { currentRef } from "../vcs.ts";
import { readCommittedSince, readGitStatus } from "./edits.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import { projectKey } from "../state/PeerState.ts";
import { rootHolding, runRootsData } from "../work/runRoots.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as ContinueRun from "../work/continueRun.ts";
import * as PeerWork from "../work/PeerWork.ts";
import * as PeerRuns from "../work/runs.ts";
import * as PeerWorkspaces from "../workspaces/PeerWorkspaces.ts";
import { taskName, taskOfKeys, tasksOf } from "../work/report.ts";
import * as PeerLog from "../log/PeerLog.ts";
import * as PeerAgents from "./PeerAgents.ts";

/** Where coordination keeps its files. */
export interface CoordinationPaths {
  /** Peer's scripts for agents' hooks, and each session's memory below it. */
  readonly dir: string;
  /** The broker's Unix socket, which only this user may open. */
  readonly socket: string;
  /** Every coordination event, one JSON line each. */
  readonly log: string;
  /** Where a Peer from before kept agents' working contexts, which agents could read and edit. */
  readonly contexts: string;
  /** What Peer remembers of telling each session, one file each. */
  readonly memory: string;
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
  // sessions, so the plugin that fills the runtime slot adds to a report last.
  const reporting = active.toSorted(
    (a, b) =>
      Number(a.contributions.runtime !== undefined) - Number(b.contributions.runtime !== undefined),
  );
  return {
    active,
    commands: (yield* plugins.built).flatMap(({ state, contributions }) =>
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
      })),
    ),
    runtime: PeerPlugins.capability(
      active.map((plugin) => plugin.contributions),
      "runtime",
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
    readonly localProjects: Effect.Effect<
      NonNullable<NonNullable<PeerHubStatus["coordination"]["local"]>["projects"]>
    >;
    readonly localView: Effect.Effect<import("../hub/coordApi.ts").HubCoordView, PeerHubError>;
    /** Starts the broker; one already running stays. */
    readonly start: Effect.Effect<void, PeerHubError>;
    /** Stops the broker; its agents' contexts pass to the next agents on their work. */
    readonly stop: Effect.Effect<void>;
    /** The running broker, null while coordination is off; the status reads its snapshot. */
    readonly broker: () => CoordinationBroker | null;
    /** Completes once the broker stopped because another took over (`broker/owner.ts`). */
    readonly handedOver: Effect.Effect<void>;
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
    readonly coordEvents: (
      input: PeerHubCoordEventsInput,
    ) => Effect.Effect<ReadonlyArray<PeerCoordEvent>, PeerHubError>;
  }
>()("t3/peerHub/core/coordination/PeerCoordination") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const status = yield* PeerStatus.PeerStatus;
  const work = yield* PeerWork.PeerWork;
  const runs = (yield* PeerRuns.PeerRuns).book;
  const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
  const agents = yield* PeerAgents.PeerAgents;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
  const continuing = yield* Effect.context<
    | PeerRuns.PeerRuns
    | PeerState.PeerState
    | PeerPlugins.PeerPlugins
    | PeerWork.PeerWork
    | PeerAgents.PeerAgents
  >();
  const services = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(services);
  const runFork = Effect.runForkWith(services);
  const { environmentId, current } = state;
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
    memory: NodePath.join(dir, "memory"),
    peer: NodePath.join(dir, "bin", "peer"),
    scripts: { hook: NodePath.join(dir, "hook"), wait: NodePath.join(dir, "wait") },
  };

  const withHub = <A>(
    call: (hubUrl: string, session: string) => Effect.Effect<A, PeerHubError>,
  ): Promise<A> =>
    runPromise(client.session.pipe(Effect.flatMap(({ hubUrl, session }) => call(hubUrl, session))));

  const localProjects = localProjectsOf(projects);

  const local = new LocalAuthority(NodePath.join(dir, "local-state.json"), environmentId);
  const host = () =>
    withLocalCoordination(hubHost(), local, async (cwd) =>
      localPlace(
        cwd,
        (await runPromise(projects.listShells())).map((project) => project.workspaceRoot),
      ),
    );
  const nativeWakeMessages = new Map<string, MessageId>();
  const hubHost = (): PeerBrokerHost => ({
    socketPath: paths.socket,
    scriptsDir: paths.dir,
    logPath: paths.log,
    log,
    memoryDir: paths.memory,
    formerMemoryPath: (path) =>
      NodePath.join(paths.contexts, NodePath.relative(paths.memory, path)),
    environment: environmentId,
    runs,
    placeOf: (cwd) => runPromise(state.placeOf(cwd)),
    runRootAt: (run, path) =>
      runPromise(
        Effect.map(runRootsData(state).read, (stored) =>
          rootHolding(Option.getOrUndefined(stored)?.runs[run] ?? [], path),
        ),
      ),
    bindingNotice: (cwd) => runPromise(state.pendingBindingNotice(cwd)),
    branchOf: currentRef,
    gitStatus: readGitStatus,
    gitHead: async (root) => {
      const head = await run("git", ["-C", root, "rev-parse", "--verify", "-q", "HEAD"]).catch(
        () => "",
      );
      return head === "" ? undefined : head;
    },
    gitCommittedSince: readCommittedSince,
    threadOf: (nativeId) => runPromise(threadOfNative(projections, nativeId)),
    threadRuntime: work.runtimeOf,
    threadAgent: (key) => runPromise(threadAgentOf(projections, projects, key)),
    resumableThreads: () => runPromise(work.resumableThreads),
    nativeWakePending: async (session, thread) => {
      const messageId = nativeWakeMessages.get(session);
      if (messageId === undefined) return true;
      const pending = await runPromise(
        coordinationWakePending(session, thread, messageId).pipe(
          Effect.provideService(ProjectionStore.ProjectionStoreV2, projections),
        ),
      );
      if (!pending && nativeWakeMessages.get(session) === messageId)
        nativeWakeMessages.delete(session);
      return pending;
    },
    continueRun: (input) =>
      runPromise(ContinueRun.continueRun(input).pipe(Effect.provide(continuing))),
    queueNative: async (session, text, thread) => {
      const messageId = MessageId.make(NodeCrypto.randomUUID());
      const separator = session.indexOf(":");
      const outcome = await runPromise(
        queueCoordinationWake(session.slice(separator + 1), text, thread, {
          agent: session.slice(0, separator),
          resume: true,
          messageId,
        }).pipe(
          Effect.provideService(ProjectionStore.ProjectionStoreV2, projections),
          Effect.provideService(
            ProviderContinuationRequests.ProviderContinuationRequests,
            continuationRequests,
          ),
          Effect.orElseSucceed(() => "unavailable" as const),
        ),
      );
      if (outcome === "queued") nativeWakeMessages.set(session, messageId);
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
    taskOf: (workspace, project, keys, texts) =>
      taskOfKeys(current(), workspace, project, keys, texts),
    tasks: (workspace, project) => tasksOf(current().work, workspace, project),
    taskName: (workspace, project, task) => taskName(current().work, workspace, project, task),
    createChat: (workspace, projectId, title) =>
      runPromise(
        work
          .createTask({ workspace, projectId, title: title.slice(0, 200), chat: true })
          .pipe(Effect.map(({ createdTask }) => createdTask.id)),
      ),
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
    coordEvents: (workspace, project, filter) =>
      withHub((hubUrl, session) => hubApi.coordEvents(hubUrl, session, workspace, project, filter)),
    changed: () => void runFork(publish.pipe(Effect.ignore)),
    plugins: () =>
      runPromise(brokerPlugins.pipe(Effect.provideService(PeerPlugins.PeerPlugins, plugins))),
    run: (effect, options) => runPromise(effect, options),
  });

  let broker: CoordinationBroker | null = null;
  const kind = yield* PeerBrokerKind;
  const handedOver = yield* Deferred.make<void>();

  const start: PeerCoordination["Service"]["start"] = Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        if (broker !== null) return;
        const created = new CoordinationBroker(host(), {
          kind,
          onHandover: () =>
            void runFork(stop.pipe(Effect.andThen(Deferred.succeed(handedOver, undefined)))),
        });
        await created.start();
        broker = created;
      },
      catch: (failure) => hubError(`Agent coordination could not start: ${messageOf(failure)}`),
    });
    yield* agents.attach(broker);
  });

  const stop: PeerCoordination["Service"]["stop"] = Effect.gen(function* () {
    yield* agents.attach(null);
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

  return PeerCoordination.of({
    paths,
    localView: onBroker(() => local.view()),
    localProjects,
    start,
    stop,
    broker: () => broker,
    handedOver: Deferred.await(handedOver),
    hubChanged: Effect.sync(() => broker?.hubChanged()),
    noteOverlap,
    resolveOverlap,
    settleOverlap,
    coordEvents,
  });
});

export const layer = Layer.effect(PeerCoordination, make);
