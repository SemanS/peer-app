/**
 * Observe's WebSocket RPCs. They keep the names they had before plugins.
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
import { PeerAgentView, PeerHubStatus } from "../peerHub.ts";
import { PeerHubError } from "./base.ts";
import { PeerHubObserveInput, PeerHubShareThreadInput } from "./observe.ts";

export const PEER_OBSERVE_METHODS = {
  peerHubShareThread: "peerHub.shareThread",
  peerHubObserveThread: "peerHub.observeThread",
} as const;

const WsPeerHubShareThreadRpc = Rpc.make(PEER_OBSERVE_METHODS.peerHubShareThread, {
  payload: PeerHubShareThreadInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A colleague's shared thread as it happens, relayed by the hub while you watch. */
const WsPeerHubObserveThreadRpc = Rpc.make(PEER_OBSERVE_METHODS.peerHubObserveThread, {
  payload: PeerHubObserveInput,
  success: PeerAgentView,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  stream: true,
});

export const ObserveRpcGroup = RpcGroup.make(WsPeerHubShareThreadRpc, WsPeerHubObserveThreadRpc);

/** Sharing a thread is operating on shared work; watching one only reads. */
export const ObserveRpcScopes = {
  [PEER_OBSERVE_METHODS.peerHubShareThread]: AuthOrchestrationOperateScope,
  [PEER_OBSERVE_METHODS.peerHubObserveThread]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof ObserveRpcGroup>["_tag"], AuthEnvironmentScope>;
