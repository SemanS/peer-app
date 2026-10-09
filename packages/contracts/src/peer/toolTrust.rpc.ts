import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerToolTrustApproveInput,
  PeerToolTrustError,
  PeerToolTrustSetSecretInput,
  PeerToolTrustStatus,
  PeerToolTrustTurnOffInput,
} from "./toolTrust.ts";
export const PEER_TOOL_TRUST_METHODS = {
  peerToolTrustApprove: "peer.toolTrust.approve",
  peerToolTrustSetSecret: "peer.toolTrust.setSecret",
  peerToolTrustTurnOff: "peer.toolTrust.turnOff",
} as const;
const error = Schema.Union([PeerToolTrustError, PeerHubError, EnvironmentAuthorizationError]);
export const PeerToolTrustRpcs = RpcGroup.make(
  Rpc.make(PEER_TOOL_TRUST_METHODS.peerToolTrustApprove, {
    payload: PeerToolTrustApproveInput,
    success: PeerToolTrustStatus,
    error,
  }),
  Rpc.make(PEER_TOOL_TRUST_METHODS.peerToolTrustSetSecret, {
    payload: PeerToolTrustSetSecretInput,
    success: PeerToolTrustStatus,
    error,
  }),
  Rpc.make(PEER_TOOL_TRUST_METHODS.peerToolTrustTurnOff, {
    payload: PeerToolTrustTurnOffInput,
    success: PeerToolTrustStatus,
    error,
  }),
);
export const ToolTrustRpcScopes = {
  [PEER_TOOL_TRUST_METHODS.peerToolTrustApprove]: AuthAccessWriteScope,
  [PEER_TOOL_TRUST_METHODS.peerToolTrustSetSecret]: AuthAccessWriteScope,
  [PEER_TOOL_TRUST_METHODS.peerToolTrustTurnOff]: AuthOrchestrationOperateScope,
} as const;
