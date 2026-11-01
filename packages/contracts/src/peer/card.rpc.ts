/** The card plugin's WebSocket RPCs. Agents use `peer card`, which only reads. */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import { PeerCard } from "./card.ts";

export const PEER_CARD_METHODS = {
  peerCardRead: "peer.card.read",
  peerCardSave: "peer.card.save",
} as const;

const methods = PEER_CARD_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const CardRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerCardRead, { payload: Schema.Struct({}), success: PeerCard, error }),
  Rpc.make(methods.peerCardSave, { payload: PeerCard, success: PeerCard, error }),
);

export const CardRpcScopes = {
  [methods.peerCardRead]: AuthOrchestrationReadScope,
  [methods.peerCardSave]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof CardRpcGroup>["_tag"], AuthEnvironmentScope>;
