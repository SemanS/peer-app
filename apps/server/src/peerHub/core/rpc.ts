import * as PeerContextView from "./index/PeerContextView.ts";
/**
 * Peer's WebSocket RPC handlers, which `ws.ts` merges with T3's through `PeerHub.rpcLayer`, handing
 * over its per-connection authorization and tracing. Core's methods each call one of core's
 * services. A plugin's come from its contributions and are refused while it is inactive; a method
 * of a plugin this build excludes is refused too, so a client of another build hears why rather
 * than meeting an unknown method.
 *
 * @module peerHub/core/rpc
 */
import {
  PEER_CORE_METHODS,
  PEER_RUNS_METHODS,
  PeerCoreRpcGroup,
  PeerHubError,
  PeerRpcGroup,
  RunsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcSchema from "effect/rpc/RpcSchema";

import * as PeerAdapters from "./coordination/PeerAdapters.ts";
import * as PeerCoordination from "./coordination/PeerCoordination.ts";
import * as PeerHubClient from "./hub/PeerHubClient.ts";
import type { PeerRpcContribution, PeerRpcWrap } from "./plugin.ts";
import * as PeerPlugins from "./plugins/PeerPlugins.ts";
import * as PeerState from "./state/PeerState.ts";
import * as PeerStatus from "./status/PeerStatus.ts";
import * as ContinueRun from "./work/continueRun.ts";
import * as PeerWork from "./work/PeerWork.ts";
import * as PeerRuns from "./work/runs.ts";
import * as Start from "./work/start.ts";
import * as PeerWorkspaces from "./workspaces/PeerWorkspaces.ts";

const PEER_TRACE = { "rpc.aggregate": "peerHub" } as const;

/** The core services Peer's RPC handlers call. */
export type PeerRpcServices =
  | PeerContextView.PeerContextView
  | PeerWorkspaces.PeerWorkspaces
  | PeerWork.PeerWork
  | PeerCoordination.PeerCoordination
  | PeerAdapters.PeerAdapters
  | PeerPlugins.PeerPlugins
  | PeerStatus.PeerStatus
  | PeerState.PeerState
  | PeerHubClient.PeerHubClient
  | PeerRuns.PeerRuns;

/** Handlers for every method of the contracts' `PeerRpcGroup`. */
type PeerRpcHandlers = Rpc.ToHandler<RpcGroup.Rpcs<typeof PeerRpcGroup>>;

/** Core's methods, each a call of one of core's services. */
const coreRpcLayer = (wrap: PeerRpcWrap) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
      const work = yield* PeerWork.PeerWork;
      const coordination = yield* PeerCoordination.PeerCoordination;
      const contextView = yield* PeerContextView.PeerContextView;
      const adapters = yield* PeerAdapters.PeerAdapters;
      const plugins = yield* PeerPlugins.PeerPlugins;
      const status = yield* PeerStatus.PeerStatus;
      // Starting an agent reads core's services itself.
      const core = yield* Effect.context<
        | PeerState.PeerState
        | PeerHubClient.PeerHubClient
        | PeerPlugins.PeerPlugins
        | PeerWork.PeerWork
        | PeerStatus.PeerStatus
      >();
      return PeerCoreRpcGroup.toLayer(
        PeerCoreRpcGroup.of({
          [PEER_CORE_METHODS.peerHubSubscribe]: (input) =>
            wrap.stream(
              PEER_CORE_METHODS.peerHubSubscribe,
              status.subscribe(input.scope),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubStartSignIn]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubStartSignIn,
              workspaces.startSignIn(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubFinishSignIn]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubFinishSignIn,
              workspaces.finishSignIn(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSignOut]: (_input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSignOut, workspaces.signOut, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubMembers]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubMembers, workspaces.members(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubRemovalPlan]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubRemovalPlan,
              workspaces.removalPlan(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubRemoveMember]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubRemoveMember,
              workspaces.removeMember(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetMemberRole]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSetMemberRole,
              workspaces.setMemberRole(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetMemberProjects]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSetMemberProjects,
              workspaces.setMemberProjects(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubWithdrawInvite]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubWithdrawInvite,
              workspaces.withdrawInvite(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubMemberKeys]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubMemberKeys,
              workspaces.memberKeys(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubRevokeMemberKeys]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubRevokeMemberKeys,
              workspaces.revokeMemberKeys(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSignOutEverywhere]: (_input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSignOutEverywhere,
              workspaces.signOutEverywhere,
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSync]: (_input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSync, workspaces.sync, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubCreateWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubCreateWorkspace,
              workspaces.createWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubJoinWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubJoinWorkspace,
              workspaces.joinWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubLeaveWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubLeaveWorkspace,
              workspaces.leaveWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubCreateTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubCreateTask, work.createTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubUpdateTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubUpdateTask, work.updateTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubDeleteTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubDeleteTask, work.deleteTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubAssignThread]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubAssignThread,
              work.assignThread(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubStartAgent]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubStartAgent,
              Start.startAgent(input).pipe(Effect.provideContext(core)),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubCoordEvents]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubCoordEvents,
              coordination.coordEvents(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubStaleReads]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubStaleReads,
              coordination.staleReads(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubContextView]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubContextView, contextView.read(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubContextArchive]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubContextArchive,
              contextView.discover(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubReadContext]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubReadContext,
              coordination.readContext(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubContextVersions]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubContextVersions,
              coordination.contextVersions(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubReadContextVersion]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubReadContextVersion,
              coordination.readContextVersion(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubRestoreContext]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubRestoreContext,
              coordination.restoreContext(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubShareProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubShareProject,
              workspaces.shareProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubUnshareProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubUnshareProject,
              workspaces.unshareProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubBindCheckout]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubBindCheckout,
              workspaces.bindCheckout(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubFindWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubFindWorkspace,
              workspaces.findWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubInvite]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubInvite, workspaces.invite(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubInvitations]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubInvitations,
              workspaces.invitations(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubInvitePreview]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubInvitePreview,
              workspaces.invitePreview(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubResendInvite]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubResendInvite,
              workspaces.resendInvite(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubAcceptFounding]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubAcceptFounding,
              workspaces.acceptFounding(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubDeclineFounding]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubDeclineFounding,
              workspaces.declineFounding(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubOpenProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubOpenProject,
              workspaces.openProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetCoordination]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSetCoordination,
              adapters.setCoordination(input),
              PEER_TRACE,
            ),
          // Every client hears the choice in the next status.
          [PEER_CORE_METHODS.peerHubSetPlugin]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSetPlugin,
              plugins.setPlugin(input).pipe(Effect.andThen(status.publish)),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubNoteOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubNoteOverlap,
              coordination.noteOverlap(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubResolveOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubResolveOverlap,
              coordination.resolveOverlap(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSettleOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSettleOverlap,
              coordination.settleOverlap(input),
              PEER_TRACE,
            ),
        }),
      );
    }),
  );

/** Runs are core (design, Registry entries): each method calls one of core's services. */
const runsRpcLayer = (wrap: PeerRpcWrap) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const runs = yield* PeerRuns.PeerRuns;
      // Continuing a run reads core's services itself, as starting an agent does.
      const core = yield* Effect.context<
        | PeerRuns.PeerRuns
        | PeerState.PeerState
        | PeerPlugins.PeerPlugins
        | PeerWork.PeerWork
        | PeerCoordination.PeerCoordination
      >();
      return RunsRpcGroup.toLayer(
        RunsRpcGroup.of({
          [PEER_RUNS_METHODS.peerHubRuns]: (input) =>
            wrap.effect(
              PEER_RUNS_METHODS.peerHubRuns,
              runs.list(input).pipe(Effect.map((list) => ({ runs: list }))),
              PEER_TRACE,
            ),
          [PEER_RUNS_METHODS.peerHubEndRun]: (input) =>
            wrap.effect(PEER_RUNS_METHODS.peerHubEndRun, runs.endRun(input), PEER_TRACE),
          [PEER_RUNS_METHODS.peerHubContinueRun]: (input) =>
            wrap.effect(
              PEER_RUNS_METHODS.peerHubContinueRun,
              ContinueRun.continueRun(input).pipe(Effect.provideContext(core)),
              PEER_TRACE,
            ),
        }),
      );
    }),
  );

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

/**
 * Refusals for the methods of `PeerRpcGroup` that no plugin of this build serves (memory's, in a
 * build without it), so a client of another build hears why rather than meeting an unknown method.
 * They go through ws.ts's wrappers like every method: the caller's scope is checked first, and the
 * call is traced.
 */
const unservedRpcLayers = (
  served: ReadonlySet<string>,
  wrap: PeerRpcWrap,
): ReadonlyArray<Layer.Layer<never>> =>
  [...PeerRpcGroup.requests.values()].flatMap((rpc) => {
    if (served.has(rpc._tag)) return [];
    const refusal = new PeerHubError({
      detail: `There is no Peer plugin for ${rpc._tag} on this environment.`,
    });
    const refuse = RpcSchema.isStreamSchema(rpc.successSchema)
      ? () => wrap.stream(rpc._tag, Stream.fail(refusal), PEER_TRACE)
      : () => wrap.effect(rpc._tag, Effect.fail(refusal), PEER_TRACE);
    // Each method's handler type is its own; a refusal fits them all.
    return [PeerRpcGroup.toLayerHandler(rpc._tag, refuse as never) as Layer.Layer<never>];
  });

/**
 * Peer's WebSocket RPC handlers: core's, and each plugin's, refused while that plugin is inactive.
 * It serves every method of the contracts' `PeerRpcGroup`: a plugin's handlers come from its
 * contributions, whose group is listed there too, and a method of a plugin this build excludes is
 * refused.
 */
export const layer = (wrap: PeerRpcWrap): Layer.Layer<PeerRpcHandlers, never, PeerRpcServices> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const plugins = yield* PeerPlugins.PeerPlugins;
      const built = yield* plugins.built;
      const theirs = built.flatMap(({ state, contributions }) =>
        contributions.rpc === undefined
          ? []
          : [pluginRpcLayer(contributions.rpc, guarded(wrap, plugins, state.id))],
      );
      const served = new Set(
        [
          PeerCoreRpcGroup,
          RunsRpcGroup,
          ...built.flatMap(({ contributions }) => contributions.rpc?.group ?? []),
        ].flatMap((group) => [...(group as RpcGroup.RpcGroup<Rpc.Any>).requests.keys()]),
      );
      // The plugins' handlers come from their contributions while Peer starts, so the type system
      // cannot see that they cover the plugins' groups in `PeerRpcGroup`.
      return Layer.mergeAll(
        coreRpcLayer(wrap),
        runsRpcLayer(wrap),
        ...theirs,
        ...unservedRpcLayers(served, wrap),
      ) as Layer.Layer<PeerRpcHandlers, never, PeerRpcServices>;
    }),
  );
