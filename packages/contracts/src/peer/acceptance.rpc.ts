/**
 * The acceptance plugin's WebSocket RPCs: read a task's acceptance with its history, and a lead's
 * accept and withdraw. Agents read acceptance in `peer status`; no agent command gives or takes one.
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
import { PeerAcceptanceInput, PeerAcceptancePlace, PeerTaskAcceptance } from "./acceptance.ts";
import { PeerHubError } from "./base.ts";

export const PEER_ACCEPTANCE_METHODS = {
  peerAcceptanceView: "peer.acceptance.view",
  peerAcceptanceAccept: "peer.acceptance.accept",
  peerAcceptanceWithdraw: "peer.acceptance.withdraw",
} as const;

const methods = PEER_ACCEPTANCE_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const AcceptanceRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerAcceptanceView, {
    payload: PeerAcceptancePlace,
    success: PeerTaskAcceptance,
    error,
  }),
  Rpc.make(methods.peerAcceptanceAccept, {
    payload: PeerAcceptanceInput,
    success: PeerTaskAcceptance,
    error,
  }),
  Rpc.make(methods.peerAcceptanceWithdraw, {
    payload: PeerAcceptanceInput,
    success: PeerTaskAcceptance,
    error,
  }),
);

/** Reading is orchestration-read; an acceptance is shared work, so giving or withdrawing it is operating. */
export const AcceptanceRpcScopes = {
  [methods.peerAcceptanceView]: AuthOrchestrationReadScope,
  [methods.peerAcceptanceAccept]: AuthOrchestrationOperateScope,
  [methods.peerAcceptanceWithdraw]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof AcceptanceRpcGroup>["_tag"], AuthEnvironmentScope>;
