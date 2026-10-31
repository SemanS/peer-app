/**
 * The rooms plugin's WebSocket RPCs: a person reads a task's room and the diff beside it, posts,
 * answers what waits on them and sets a run's reach. Agents use `peer room`, not these.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerRoomDiff,
  PeerRoomMessage,
  PeerRoomRead,
  PeerRoomsDeclineInput,
  PeerRoomsPassInput,
  PeerRoomsDiffInput,
  PeerRoomSteps,
  PeerRoomsStepsInput,
  PeerRoomSnapshot,
  PeerRoomsSnapshotInput,
  PeerRoomsThreadInput,
  PeerRoomThread,
  PeerRoomsPostInput,
  PeerRoomsReadInput,
  PeerRoomsFoldersInput,
  PeerRoomsFoldersResult,
  PeerRoomsSeenInput,
  PeerRoomsSeenResult,
  PeerRoomsSetReachInput,
  PeerRoomsSetReachResult,
  PeerRoomsWithdrawInput,
} from "./rooms.ts";

export const PEER_ROOMS_METHODS = {
  peerRoomsRead: "peer.rooms.read",
  peerRoomsPost: "peer.rooms.post",
  peerRoomsSeen: "peer.rooms.seen",
  peerRoomsFolders: "peer.rooms.folders",
  peerRoomsPass: "peer.rooms.pass",
  peerRoomsDecline: "peer.rooms.decline",
  peerRoomsWithdraw: "peer.rooms.withdraw",
  peerRoomsSetReach: "peer.rooms.setReach",
  peerRoomsDiff: "peer.rooms.diff",
  peerRoomsSteps: "peer.rooms.steps",
  peerRoomsSnapshot: "peer.rooms.snapshot",
  peerRoomsThread: "peer.rooms.thread",
} as const;

const methods = PEER_ROOMS_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const RoomsRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerRoomsRead, { payload: PeerRoomsReadInput, success: PeerRoomRead, error }),
  Rpc.make(methods.peerRoomsPost, { payload: PeerRoomsPostInput, success: PeerRoomMessage, error }),
  Rpc.make(methods.peerRoomsFolders, {
    payload: PeerRoomsFoldersInput,
    success: PeerRoomsFoldersResult,
    error,
  }),
  Rpc.make(methods.peerRoomsSeen, {
    payload: PeerRoomsSeenInput,
    success: PeerRoomsSeenResult,
    error,
  }),
  Rpc.make(methods.peerRoomsPass, { payload: PeerRoomsPassInput, success: PeerRoomMessage, error }),
  Rpc.make(methods.peerRoomsDecline, {
    payload: PeerRoomsDeclineInput,
    success: PeerRoomMessage,
    error,
  }),
  Rpc.make(methods.peerRoomsWithdraw, {
    payload: PeerRoomsWithdrawInput,
    success: PeerRoomMessage,
    error,
  }),
  Rpc.make(methods.peerRoomsSetReach, {
    payload: PeerRoomsSetReachInput,
    success: PeerRoomsSetReachResult,
    error,
  }),
  Rpc.make(methods.peerRoomsDiff, { payload: PeerRoomsDiffInput, success: PeerRoomDiff, error }),
  Rpc.make(methods.peerRoomsSteps, { payload: PeerRoomsStepsInput, success: PeerRoomSteps, error }),
  Rpc.make(methods.peerRoomsSnapshot, {
    payload: PeerRoomsSnapshotInput,
    success: PeerRoomSnapshot,
    error,
  }),
  Rpc.make(methods.peerRoomsThread, {
    payload: PeerRoomsThreadInput,
    success: PeerRoomThread,
    error,
  }),
);

/** Reading is orchestration-read; what may start an agent or tell the team is operating. */
export const RoomsRpcScopes = {
  [methods.peerRoomsRead]: AuthOrchestrationReadScope,
  [methods.peerRoomsPost]: AuthOrchestrationOperateScope,
  [methods.peerRoomsSeen]: AuthOrchestrationOperateScope,
  [methods.peerRoomsFolders]: AuthOrchestrationOperateScope,
  [methods.peerRoomsPass]: AuthOrchestrationOperateScope,
  [methods.peerRoomsDecline]: AuthOrchestrationOperateScope,
  [methods.peerRoomsWithdraw]: AuthOrchestrationOperateScope,
  [methods.peerRoomsSetReach]: AuthOrchestrationOperateScope,
  [methods.peerRoomsDiff]: AuthOrchestrationReadScope,
  [methods.peerRoomsSteps]: AuthOrchestrationReadScope,
  [methods.peerRoomsSnapshot]: AuthOrchestrationReadScope,
  [methods.peerRoomsThread]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof RoomsRpcGroup>["_tag"], AuthEnvironmentScope>;
