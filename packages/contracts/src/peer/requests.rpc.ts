/**
 * Team requests' WebSocket RPCs. They keep the names they had before plugins.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubStatus } from "../peerHub.ts";
import { PeerHubError } from "./base.ts";
import { PeerHubDismissRequestInput, PeerHubSendRequestInput } from "./requests.ts";

export const PEER_REQUESTS_METHODS = {
  peerHubSendRequest: "peerHub.sendRequest",
  peerHubDismissRequest: "peerHub.dismissRequest",
} as const;

/** Puts a request in a teammate's Needs you. */
const WsPeerHubSendRequestRpc = Rpc.make(PEER_REQUESTS_METHODS.peerHubSendRequest, {
  payload: PeerHubSendRequestInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** The recipient dismisses a request without starting an agent. */
const WsPeerHubDismissRequestRpc = Rpc.make(PEER_REQUESTS_METHODS.peerHubDismissRequest, {
  payload: PeerHubDismissRequestInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const RequestsRpcGroup = RpcGroup.make(WsPeerHubSendRequestRpc, WsPeerHubDismissRequestRpc);

/** Requests are shared work, so sending and answering one is operating, like a task. */
export const RequestsRpcScopes = {
  [PEER_REQUESTS_METHODS.peerHubSendRequest]: AuthOrchestrationOperateScope,
  [PEER_REQUESTS_METHODS.peerHubDismissRequest]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof RequestsRpcGroup>["_tag"], AuthEnvironmentScope>;
