/**
 * The acceptance plugin's WebSocket RPCs: read a task's acceptance with its history, and a lead's
 * accept and withdraw, and a project's review policy (read by every member, set by a lead or an
 * admin). Agents read acceptance in `peer status`; no agent command gives or takes one.
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
import {
  PeerAcceptanceInput,
  PeerAcceptancePlace,
  PeerProjectReviewPolicy,
  PeerReviewPolicyPlace,
  PeerSetReviewPolicyInput,
  PeerSetReviewPolicyResult,
  PeerTaskAcceptance,
} from "./acceptance.ts";
import { PeerHubError } from "./base.ts";
import { PeerHandoffSignalsRead } from "./handoff.ts";

export const PEER_ACCEPTANCE_METHODS = {
  peerAcceptanceView: "peer.acceptance.view",
  peerAcceptanceAccept: "peer.acceptance.accept",
  peerAcceptanceWithdraw: "peer.acceptance.withdraw",
  peerAcceptanceReviewPolicy: "peer.acceptance.reviewPolicy",
  peerAcceptanceSetReviewPolicy: "peer.acceptance.setReviewPolicy",
  peerAcceptanceSignals: "peer.acceptance.signals",
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
  Rpc.make(methods.peerAcceptanceReviewPolicy, {
    payload: PeerReviewPolicyPlace,
    success: PeerProjectReviewPolicy,
    error,
  }),
  Rpc.make(methods.peerAcceptanceSetReviewPolicy, {
    payload: PeerSetReviewPolicyInput,
    success: PeerSetReviewPolicyResult,
    error,
  }),
  Rpc.make(methods.peerAcceptanceSignals, {
    payload: PeerAcceptancePlace,
    success: PeerHandoffSignalsRead,
    error,
  }),
);

/**
 * Reading is orchestration-read; an acceptance is shared work, so giving or withdrawing it is
 * operating, and so is setting the rule that accepts in a lead's name.
 */
export const AcceptanceRpcScopes = {
  [methods.peerAcceptanceView]: AuthOrchestrationReadScope,
  [methods.peerAcceptanceAccept]: AuthOrchestrationOperateScope,
  [methods.peerAcceptanceWithdraw]: AuthOrchestrationOperateScope,
  [methods.peerAcceptanceReviewPolicy]: AuthOrchestrationReadScope,
  [methods.peerAcceptanceSetReviewPolicy]: AuthOrchestrationOperateScope,
  [methods.peerAcceptanceSignals]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof AcceptanceRpcGroup>["_tag"], AuthEnvironmentScope>;
