import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import { PeerPlansPlace, PeerPlansView } from "./plans.ts";

export const PEER_PLANS_METHODS = {
  peerPlansList: "peer.plans.list",
} as const;

/** The plans and relations of a place, read from the Hub now. Plans are advice: people only read them. */
export const PlansRpcGroup = RpcGroup.make(
  Rpc.make(PEER_PLANS_METHODS.peerPlansList, {
    payload: PeerPlansPlace,
    success: PeerPlansView,
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);

export const PlansRpcScopes = {
  [PEER_PLANS_METHODS.peerPlansList]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof PlansRpcGroup>["_tag"], AuthEnvironmentScope>;
