import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "../auth.ts";
import { PeerHubError } from "./base.ts";
import { PeerResourceReleaseInput, PeerResourceReleaseResult } from "./resources.ts";
export const PEER_RESOURCES_METHODS = { peerResourcesRelease: "peer.resources.release" } as const;
export const ResourcesRpcGroup = RpcGroup.make(
  Rpc.make(PEER_RESOURCES_METHODS.peerResourcesRelease, {
    payload: PeerResourceReleaseInput,
    success: PeerResourceReleaseResult,
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);
export const ResourcesRpcScopes = {
  [PEER_RESOURCES_METHODS.peerResourcesRelease]: AuthOrchestrationOperateScope,
} as const;
