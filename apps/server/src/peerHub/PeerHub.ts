/**
 * PeerHub — this environment's link to a Peer Hub and its workspaces.
 *
 * A person signs in with their email address (the hub mails a one-time
 * code), then joins the workspaces their address qualifies for — by its
 * domain or an invite — or creates one. Each workspace tells this environment
 * which projects to check out, which agent tools and knowledge they use, and
 * what shared AI capacity each one has. Provisioning stays local:
 * repositories are cloned with the person's own git credentials, projects are
 * ordinary T3 projects, and shared capacity becomes an ordinary provider
 * instance holding a per-member, per-project gateway key.
 *
 * Personal capacity never passes through here. The hub never sees provider
 * logins, and `hubPolicy` keeps hub-provisioned (shared) instances on their
 * own project and personal ones on projects that accept them.
 *
 * @module peerHub/PeerHub
 */
import {
  PEER_CORE_METHODS,
  PeerCoreRpcGroup,
  PeerRpcGroup,
  PeerHubError,
  PeerHubStatus,
  type PeerHubContextInput,
  type PeerHubContextVersionInput,
  type PeerContextVersion,
  type PeerContextVersionText,
  type PeerHubAssignThreadInput,
  type PeerHubCreateTaskInput,
  type PeerHubCreateWorkspaceInput,
  type PeerFoundWorkspace,
  type PeerHubFindWorkspaceInput,
  type PeerHubFinishSignInInput,
  type PeerHubInviteInput,
  type PeerHubOverlapNoteInput,
  type PeerHubProjectInput,
  type PeerHubResolveOverlapInput,
  type PeerHubSettleOverlapInput,
  type PeerHubSetCoordinationInput,
  type PeerHubSetPluginInput,
  type PeerHubStartAgentInput,
  type PeerHubStartAgentResult,
  type PeerHubCoordEventsInput,
  type PeerHubStaleReadsInput,
  type PeerCoordEvent,
  type PeerStaleReads,
  type PeerHubShareProjectInput,
  type PeerHubStartSignInInput,
  type PeerHubTaskInput,
  type PeerHubUpdateTaskInput,
  type PeerHubWorkspaceInput,
  type PeerWorkContextText,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import * as PeerHubClient from "./core/hub/PeerHubClient.ts";
import * as PeerHubEvents from "./core/hub/PeerHubEvents.ts";
import * as PeerIndex from "./core/index/PeerIndex.ts";
import type { PeerRpcContribution, PeerRpcWrap } from "./core/plugin.ts";
import * as PeerPlugins from "./core/plugins/PeerPlugins.ts";
import * as PeerStatus from "./core/status/PeerStatus.ts";
import * as PeerState from "./core/state/PeerState.ts";
import * as PeerAdapters from "./core/coordination/PeerAdapters.ts";
import * as PeerAgents from "./core/coordination/PeerAgents.ts";
import * as PeerCoordination from "./core/coordination/PeerCoordination.ts";
import * as PeerWork from "./core/work/PeerWork.ts";
import * as PeerWorkspaces from "./core/workspaces/PeerWorkspaces.ts";
import * as Start from "./core/work/start.ts";

const WORK_INTERVAL = "30 seconds";
const MANIFEST_INTERVAL = "10 minutes";

export class PeerHub extends Context.Service<
  PeerHub,
  {
    readonly status: Effect.Effect<PeerHubStatus>;
    /** The current status followed by every change. */
    readonly streamStatus: Stream.Stream<PeerHubStatus>;
    /** Mails a sign-in code to the address. */
    readonly startSignIn: (
      input: PeerHubStartSignInInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly finishSignIn: (
      input: PeerHubFinishSignInInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Also cancels a sign-in waiting for its code. */
    readonly signOut: Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly sync: Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly createWorkspace: (
      input: PeerHubCreateWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly joinWorkspace: (
      input: PeerHubWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly leaveWorkspace: (
      input: PeerHubWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly invite: (input: PeerHubInviteInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A workspace by its short name (null when there is none), to join it by name. */
    readonly findWorkspace: (
      input: PeerHubFindWorkspaceInput,
    ) => Effect.Effect<PeerFoundWorkspace | null, PeerHubError>;
    /** Clones the project's repositories (in the background) and registers them as projects. */
    readonly openProject: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Agent coordination on or off, its policy, and Peer's hooks in Claude Code and Codex. */
    readonly setCoordination: (
      input: PeerHubSetCoordinationInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Turns one of Peer's optional plugins on or off on this environment. */
    readonly setPlugin: (
      input: PeerHubSetPluginInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
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
    /** Any member of a project adds, changes and closes its tasks. */
    readonly createTask: (
      input: PeerHubCreateTaskInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly updateTask: (
      input: PeerHubUpdateTaskInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly deleteTask: (input: PeerHubTaskInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Puts one of this computer's threads under a task, or under none. */
    readonly assignThread: (
      input: PeerHubAssignThreadInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Starts a task agent in its own checkout and assigns its durable work identity. */
    readonly startAgent: (
      input: PeerHubStartAgentInput,
    ) => Effect.Effect<PeerHubStartAgentResult, PeerHubError>;
    readonly getCoordEvents: (
      input: PeerHubCoordEventsInput,
    ) => Effect.Effect<ReadonlyArray<PeerCoordEvent>, PeerHubError>;
    readonly getStaleReads: (
      input: PeerHubStaleReadsInput,
    ) => Effect.Effect<PeerStaleReads, PeerHubError>;
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
    /** Shares a local project's repository with a workspace, as a project everyone works on. */
    readonly shareProject: (
      input: PeerHubShareProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly unshareProject: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
  }
>()("t3/peerHub/PeerHub") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const events = yield* PeerHubEvents.PeerHubEvents;
  const work = yield* PeerWork.PeerWork;
  const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
  const coordination = yield* PeerCoordination.PeerCoordination;
  const adapters = yield* PeerAdapters.PeerAdapters;
  const layerScope = yield* Effect.scope;

  const { lock } = state;
  const peerStatus = yield* PeerStatus.PeerStatus;

  const requireSession = client.session;

  // The status's coordination comes from here until its service moves out.
  yield* peerStatus.setFacadeParts((s) =>
    Effect.map(adapters.status(s), (coordination) => ({ coordination })),
  );
  const publish = peerStatus.publish;

  const background = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.andThen(publish),
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(layerScope),
      Effect.asVoid,
    );

  /** Reports this computer's threads to each workspace and reads everyone's work back. */
  const refreshWork = work.refresh().pipe(lock.withPermits(1));

  const setPlugin: PeerHub["Service"]["setPlugin"] = (input) =>
    plugins.setPlugin(input).pipe(Effect.andThen(publish));

  const coreContext = yield* Effect.context<
    | PeerState.PeerState
    | PeerHubClient.PeerHubClient
    | PeerPlugins.PeerPlugins
    | PeerWork.PeerWork
    | PeerStatus.PeerStatus
  >();
  const startAgent: PeerHub["Service"]["startAgent"] = (input) =>
    Start.startAgent(input).pipe(Effect.provideContext(coreContext));

  // Keep the manifests fresh and colleagues' presence current.
  yield* Effect.forever(
    Effect.sleep(MANIFEST_INTERVAL).pipe(
      Effect.andThen(requireSession.pipe(Effect.option)),
      Effect.flatMap((signedIn) =>
        Option.isSome(signedIn) ? workspaces.sync.pipe(Effect.ignore) : Effect.void,
      ),
    ),
  ).pipe(Effect.forkScoped);
  yield* Effect.forever(
    Effect.sleep(WORK_INTERVAL).pipe(
      Effect.andThen(refreshWork),
      Effect.andThen(publish),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);
  yield* events
    .follow({
      readWork: work.readWork,
      coordinationChanged: coordination.hubChanged,
      projectsChanged: background(workspaces.sync),
    })
    .pipe(Effect.forkScoped);
  yield* PeerPlugins.startPlugins;
  if ((yield* state.read).persisted.coordination?.enabled === true) {
    yield* background(coordination.start);
  }
  // Publish the persisted state right away so policy and tools apply before the first sync.
  yield* publish.pipe(
    Effect.andThen(requireSession.pipe(Effect.option)),
    Effect.flatMap((signedIn) =>
      Option.isSome(signedIn) ? workspaces.sync.pipe(Effect.ignore) : Effect.void,
    ),
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );

  return PeerHub.of({
    status: publish,
    streamStatus: peerStatus.changes,
    startSignIn: workspaces.startSignIn,
    finishSignIn: workspaces.finishSignIn,
    signOut: workspaces.signOut,
    sync: workspaces.sync,
    createWorkspace: workspaces.createWorkspace,
    joinWorkspace: workspaces.joinWorkspace,
    leaveWorkspace: workspaces.leaveWorkspace,
    invite: workspaces.invite,
    findWorkspace: workspaces.findWorkspace,
    openProject: workspaces.openProject,
    setCoordination: adapters.setCoordination,
    setPlugin,
    noteOverlap: coordination.noteOverlap,
    resolveOverlap: coordination.resolveOverlap,
    settleOverlap: coordination.settleOverlap,
    createTask: work.createTask,
    updateTask: work.updateTask,
    deleteTask: work.deleteTask,
    assignThread: work.assignThread,
    startAgent,
    getCoordEvents: coordination.coordEvents,
    getStaleReads: coordination.staleReads,
    readContext: coordination.readContext,
    contextVersions: coordination.contextVersions,
    readContextVersion: coordination.readContextVersion,
    restoreContext: coordination.restoreContext,
    shareProject: workspaces.shareProject,
    unshareProject: workspaces.unshareProject,
  });
});

/** Peer's core services, as they are carved out of this facade. */
const coreLayer = PeerAdapters.layer.pipe(
  Layer.provideMerge(PeerCoordination.layer),
  Layer.provideMerge(PeerAgents.layer),
  Layer.provideMerge(PeerIndex.layer),
  Layer.provideMerge(PeerWorkspaces.layer),
  Layer.provideMerge(PeerHubEvents.layer),
  Layer.provideMerge(PeerWork.layer),
  Layer.provideMerge(PeerStatus.layer),
  Layer.provideMerge(PeerPlugins.layer),
  Layer.provideMerge(PeerHubClient.layer),
  Layer.provideMerge(PeerState.layer),
);

export const layer = Layer.effect(PeerHub, make).pipe(Layer.provideMerge(coreLayer));

const PEER_TRACE = { "rpc.aggregate": "peerHub" } as const;

/** A plugin's methods refused while it is inactive, before anything runs. */
const guarded = (
  wrap: PeerRpcWrap,
  plugins: PeerPlugins.PeerPlugins["Service"],
  id: string,
): PeerRpcWrap => ({
  effect: (method, effect, traceAttributes) =>
    wrap.effect(method, plugins.requireActive(id).pipe(Effect.andThen(effect)), traceAttributes),
  stream: (method, stream, traceAttributes) =>
    wrap.stream(
      method,
      Stream.unwrap(plugins.requireActive(id).pipe(Effect.as(stream))),
      traceAttributes,
    ),
});

/**
 * A plugin's RPC group bound to its handlers. Their types live in the plugin's contract file; the
 * registry holds every plugin in one list, so they meet here erased.
 */
const pluginRpcLayer = (rpc: PeerRpcContribution, wrap: PeerRpcWrap): Layer.Layer<never> =>
  (rpc.group as RpcGroup.RpcGroup<Rpc.Any>).toLayer(
    rpc.handlers(wrap) as never,
  ) as Layer.Layer<never>;

/** Handlers for every method of the contracts' `PeerRpcGroup`. */
type PeerRpcHandlers = Rpc.ToHandler<RpcGroup.Rpcs<typeof PeerRpcGroup>>;

/**
 * Peer's WebSocket RPC handlers: core's, and each plugin's, refused while that plugin is inactive.
 * `ws.ts` merges them with T3's, handing over its per-connection authorization and tracing. It
 * serves every method of the contracts' `PeerRpcGroup`: a plugin's handlers come from its
 * contributions, whose group is listed there too.
 */
export const rpcLayer = (
  wrap: PeerRpcWrap,
): Layer.Layer<PeerRpcHandlers, never, PeerHub | PeerPlugins.PeerPlugins> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const peerHub = yield* PeerHub;
      const plugins = yield* PeerPlugins.PeerPlugins;
      const core = PeerCoreRpcGroup.toLayer(
        PeerCoreRpcGroup.of({
          [PEER_CORE_METHODS.peerHubSubscribe]: (_input) =>
            wrap.stream(PEER_CORE_METHODS.peerHubSubscribe, peerHub.streamStatus, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubStartSignIn]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubStartSignIn,
              peerHub.startSignIn(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubFinishSignIn]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubFinishSignIn,
              peerHub.finishSignIn(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSignOut]: (_input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSignOut, peerHub.signOut, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubSync]: (_input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSync, peerHub.sync, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubCreateWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubCreateWorkspace,
              peerHub.createWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubJoinWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubJoinWorkspace,
              peerHub.joinWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubLeaveWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubLeaveWorkspace,
              peerHub.leaveWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubCreateTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubCreateTask, peerHub.createTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubUpdateTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubUpdateTask, peerHub.updateTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubDeleteTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubDeleteTask, peerHub.deleteTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubAssignThread]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubAssignThread,
              peerHub.assignThread(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubStartAgent]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubStartAgent, peerHub.startAgent(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubCoordEvents]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubCoordEvents,
              peerHub.getCoordEvents(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubStaleReads]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubStaleReads,
              peerHub.getStaleReads(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubReadContext]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubReadContext,
              peerHub.readContext(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubContextVersions]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubContextVersions,
              peerHub.contextVersions(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubReadContextVersion]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubReadContextVersion,
              peerHub.readContextVersion(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubRestoreContext]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubRestoreContext,
              peerHub.restoreContext(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubShareProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubShareProject,
              peerHub.shareProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubUnshareProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubUnshareProject,
              peerHub.unshareProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubFindWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubFindWorkspace,
              peerHub.findWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubInvite]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubInvite, peerHub.invite(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubOpenProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubOpenProject,
              peerHub.openProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetCoordination]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSetCoordination,
              peerHub.setCoordination(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetPlugin]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSetPlugin, peerHub.setPlugin(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubNoteOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubNoteOverlap,
              peerHub.noteOverlap(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubResolveOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubResolveOverlap,
              peerHub.resolveOverlap(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSettleOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSettleOverlap,
              peerHub.settleOverlap(input),
              PEER_TRACE,
            ),
        }),
      );
      const theirs = (yield* plugins.built).flatMap(({ state, contributions }) =>
        contributions.rpc === undefined
          ? []
          : [pluginRpcLayer(contributions.rpc, guarded(wrap, plugins, state.id))],
      );
      // The plugins' handlers come from their contributions while Peer starts, so the type system
      // cannot see that they cover the plugins' groups in `PeerRpcGroup`.
      return Layer.mergeAll(core, ...theirs) as Layer.Layer<PeerRpcHandlers>;
    }),
  );

/**
 * Peer's MCP toolkits, registered when the server starts: each plugin's, whose tools refuse their
 * calls while the plugin is inactive.
 */
export const mcpLayer = Layer.unwrap(
  Effect.gen(function* () {
    const toolkits = yield* (yield* PeerPlugins.PeerPlugins).toolkits;
    return Layer.mergeAll(Layer.empty, ...toolkits);
  }),
);
