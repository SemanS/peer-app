import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "../auth.ts";
import { PeerHubError } from "./base.ts";
import { PeerDependencyChangeInput, PeerDependencyChangeResult } from "./dependencies.ts";
export const PEER_DEPENDENCY_METHODS = {
  peerDependenciesChange: "peer.dependencies.change",
} as const;
export const DependenciesRpcGroup = RpcGroup.make(
  Rpc.make(PEER_DEPENDENCY_METHODS.peerDependenciesChange, {
    payload: PeerDependencyChangeInput,
    success: PeerDependencyChangeResult,
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);
export const DependenciesRpcScopes = {
  [PEER_DEPENDENCY_METHODS.peerDependenciesChange]: AuthOrchestrationOperateScope,
} as const;
