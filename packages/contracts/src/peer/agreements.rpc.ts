import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import {
  PeerAgreementCloseInput,
  PeerAgreementReopenInput,
  PeerAgreementResult,
  PeerAgreementsPlace,
  PeerAgreementsView,
} from "./agreements.ts";
import { PeerHubError } from "./base.ts";

export const PEER_AGREEMENTS_METHODS = {
  peerAgreementsView: "peer.agreements.view",
  peerAgreementsClose: "peer.agreements.close",
  peerAgreementsReopen: "peer.agreements.reopen",
} as const;

const methods = PEER_AGREEMENTS_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

/**
 * The agreements of a place, read from the Hub now, and the two things a person does with one:
 * close it as handled or not needed, and bring back one a person closed. Agents settle agreements
 * through `peer resolve`, not through here.
 */
export const AgreementsRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerAgreementsView, {
    payload: PeerAgreementsPlace,
    success: PeerAgreementsView,
    error,
  }),
  Rpc.make(methods.peerAgreementsClose, {
    payload: PeerAgreementCloseInput,
    success: PeerAgreementResult,
    error,
  }),
  Rpc.make(methods.peerAgreementsReopen, {
    payload: PeerAgreementReopenInput,
    success: PeerAgreementResult,
    error,
  }),
);

/**
 * Reading is orchestration-read. Closing and reopening change shared work, so they are operating,
 * like changing a task.
 */
export const AgreementsRpcScopes = {
  [methods.peerAgreementsView]: AuthOrchestrationReadScope,
  [methods.peerAgreementsClose]: AuthOrchestrationOperateScope,
  [methods.peerAgreementsReopen]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof AgreementsRpcGroup>["_tag"], AuthEnvironmentScope>;
