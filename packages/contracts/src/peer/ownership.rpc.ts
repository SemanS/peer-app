/**
 * The ownership plugin's WebSocket RPCs, which clients call to read what the Hub holds of a
 * workspace's ownership and to change it: name a task's owner, save a project's owner map, decide
 * an owner's call or take one back. Agents open calls through `peer owner ask`, not through here.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerOwnershipCallResult,
  PeerOwnershipDecideInput,
  PeerOwnershipListInput,
  PeerOwnershipSetMapInput,
  PeerOwnershipSetMapResult,
  PeerOwnershipSetTaskOwnerInput,
  PeerOwnershipSetTaskOwnerResult,
  PeerOwnershipView,
  PeerOwnershipWithdrawInput,
} from "./ownership.ts";

export const PEER_OWNERSHIP_METHODS = {
  peerOwnershipList: "peer.ownership.list",
  peerOwnershipSetTaskOwner: "peer.ownership.setTaskOwner",
  peerOwnershipSetMap: "peer.ownership.setMap",
  peerOwnershipDecide: "peer.ownership.decide",
  peerOwnershipWithdraw: "peer.ownership.withdraw",
} as const;

const methods = PEER_OWNERSHIP_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const OwnershipRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerOwnershipList, {
    payload: PeerOwnershipListInput,
    success: PeerOwnershipView,
    error,
  }),
  Rpc.make(methods.peerOwnershipSetTaskOwner, {
    payload: PeerOwnershipSetTaskOwnerInput,
    success: PeerOwnershipSetTaskOwnerResult,
    error,
  }),
  Rpc.make(methods.peerOwnershipSetMap, {
    payload: PeerOwnershipSetMapInput,
    success: PeerOwnershipSetMapResult,
    error,
  }),
  Rpc.make(methods.peerOwnershipDecide, {
    payload: PeerOwnershipDecideInput,
    success: PeerOwnershipCallResult,
    error,
  }),
  Rpc.make(methods.peerOwnershipWithdraw, {
    payload: PeerOwnershipWithdrawInput,
    success: PeerOwnershipCallResult,
    error,
  }),
);

/**
 * Reading is orchestration-read. Owners and calls are shared work, so changing them is operating,
 * like a task: a phone with operate access decides a call, one without it does not.
 */
export const OwnershipRpcScopes = {
  [methods.peerOwnershipList]: AuthOrchestrationReadScope,
  [methods.peerOwnershipSetTaskOwner]: AuthOrchestrationOperateScope,
  [methods.peerOwnershipSetMap]: AuthOrchestrationOperateScope,
  [methods.peerOwnershipDecide]: AuthOrchestrationOperateScope,
  [methods.peerOwnershipWithdraw]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof OwnershipRpcGroup>["_tag"], AuthEnvironmentScope>;
