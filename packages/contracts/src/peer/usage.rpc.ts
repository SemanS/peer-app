import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerUsageOverviewAnswer,
  PeerUsageOverviewInput,
  PeerUsageSetSharingInput,
  PeerUsageSharingAnswer,
  PeerUsageSharingInput,
} from "./usage.ts";

export const PEER_USAGE_METHODS = {
  peerUsageOverview: "peer.usage.overview",
  peerUsageSharing: "peer.usage.sharing",
  peerUsageSetSharing: "peer.usage.setSharing",
} as const;

const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const UsageRpcGroup = RpcGroup.make(
  Rpc.make(PEER_USAGE_METHODS.peerUsageOverview, {
    payload: PeerUsageOverviewInput,
    success: PeerUsageOverviewAnswer,
    error,
  }),
  Rpc.make(PEER_USAGE_METHODS.peerUsageSharing, {
    payload: PeerUsageSharingInput,
    success: PeerUsageSharingAnswer,
    error,
  }),
  Rpc.make(PEER_USAGE_METHODS.peerUsageSetSharing, {
    payload: PeerUsageSetSharingInput,
    success: PeerUsageSharingAnswer,
    error,
  }),
);

export const UsageRpcScopes = {
  [PEER_USAGE_METHODS.peerUsageOverview]: AuthOrchestrationReadScope,
  [PEER_USAGE_METHODS.peerUsageSharing]: AuthOrchestrationReadScope,
  // Like metrics' switch: this consent sends the person's data off the computer.
  [PEER_USAGE_METHODS.peerUsageSetSharing]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof UsageRpcGroup>["_tag"], AuthEnvironmentScope>;
