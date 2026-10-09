import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthAccessWriteScope, EnvironmentAuthorizationError } from "../auth.ts";
import { PeerHubError, PeerHubStatus } from "../peerHub.ts";
import { PeerNeedsYouSetAlertsInput } from "./needs-you.ts";

export const PEER_NEEDS_YOU_METHODS = { peerNeedsYouSetAlerts: "peerNeedsYou.setAlerts" } as const;
export const NeedsYouRpcGroup = RpcGroup.make(
  Rpc.make(PEER_NEEDS_YOU_METHODS.peerNeedsYouSetAlerts, {
    payload: PeerNeedsYouSetAlertsInput,
    success: PeerHubStatus,
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);
export const NeedsYouRpcScopes = {
  [PEER_NEEDS_YOU_METHODS.peerNeedsYouSetAlerts]: AuthAccessWriteScope,
} as const;
