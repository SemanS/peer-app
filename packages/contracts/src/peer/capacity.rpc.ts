/**
 * Shared capacity's WebSocket RPCs. They keep the names they had before plugins.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubProjectInput, PeerHubStatus } from "../peerHub.ts";
import { PeerHubError } from "./base.ts";
import { PeerHubProjectUsage, PeerHubSharedCapacityInput } from "./capacity.ts";

export const PEER_CAPACITY_METHODS = {
  peerHubSetSharedCapacity: "peerHub.setSharedCapacity",
  peerHubProjectUsage: "peerHub.projectUsage",
} as const;

/** Turns a project's shared capacity on or off on this environment. */
const WsPeerHubSetSharedCapacityRpc = Rpc.make(PEER_CAPACITY_METHODS.peerHubSetSharedCapacity, {
  payload: PeerHubSharedCapacityInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A project's spending this period, shared and as members reported it. */
const WsPeerHubProjectUsageRpc = Rpc.make(PEER_CAPACITY_METHODS.peerHubProjectUsage, {
  payload: PeerHubProjectInput,
  success: PeerHubProjectUsage,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const CapacityRpcGroup = RpcGroup.make(
  WsPeerHubSetSharedCapacityRpc,
  WsPeerHubProjectUsageRpc,
);

/** Shared capacity mints workspace credentials, so turning it on belongs to the owner. */
export const CapacityRpcScopes = {
  [PEER_CAPACITY_METHODS.peerHubSetSharedCapacity]: AuthAccessWriteScope,
  [PEER_CAPACITY_METHODS.peerHubProjectUsage]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof CapacityRpcGroup>["_tag"], AuthEnvironmentScope>;
