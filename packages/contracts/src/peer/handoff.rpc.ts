import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerHandoffPackage,
  PeerHandoffPlace,
  PeerHandoffOutcome,
  PeerHandoffSetTarget,
  PeerHandoffStatus,
} from "./handoff.ts";
export const PEER_HANDOFF_METHODS = {
  peerHandoffRead: "peer.handoff.read",
  peerHandoffHandOff: "peer.handoff.handOff",
  peerHandoffWithdraw: "peer.handoff.withdraw",
  peerHandoffSetTarget: "peer.handoff.setTarget",
} as const;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const HandoffRpcGroup = RpcGroup.make(
  Rpc.make(PEER_HANDOFF_METHODS.peerHandoffRead, {
    payload: PeerHandoffPlace,
    success: Schema.Array(PeerHandoffPackage),
    error,
  }),
  Rpc.make(PEER_HANDOFF_METHODS.peerHandoffHandOff, {
    payload: PeerHandoffPlace,
    success: PeerHandoffOutcome,
    error,
  }),
  Rpc.make(PEER_HANDOFF_METHODS.peerHandoffWithdraw, {
    payload: PeerHandoffPlace,
    success: PeerHandoffOutcome,
    error,
  }),
  Rpc.make(PEER_HANDOFF_METHODS.peerHandoffSetTarget, {
    payload: PeerHandoffSetTarget,
    success: PeerHandoffStatus,
    error,
  }),
);
export const HandoffRpcScopes = {
  [PEER_HANDOFF_METHODS.peerHandoffRead]: AuthOrchestrationReadScope,
  [PEER_HANDOFF_METHODS.peerHandoffHandOff]: AuthOrchestrationOperateScope,
  [PEER_HANDOFF_METHODS.peerHandoffWithdraw]: AuthOrchestrationOperateScope,
  [PEER_HANDOFF_METHODS.peerHandoffSetTarget]: AuthAccessWriteScope,
} as const;
