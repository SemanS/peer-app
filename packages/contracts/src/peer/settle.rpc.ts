import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError, PeerHubStatus } from "../peerHub.ts";
import { PeerSettleSetResumeInput } from "./settle.ts";

export const PEER_SETTLE_METHODS = { peerSettleSetResume: "peer.settle.setResume" } as const;
export const SettleRpcGroup = RpcGroup.make(
  Rpc.make(PEER_SETTLE_METHODS.peerSettleSetResume, {
    payload: PeerSettleSetResumeInput,
    success: PeerHubStatus,
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);
/** Turning it on lets this environment run agents headless, as starting a review does. */
export const SettleRpcScopes = {
  [PEER_SETTLE_METHODS.peerSettleSetResume]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof SettleRpcGroup>["_tag"], AuthEnvironmentScope>;
