import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerWebhookDeliveries,
  PeerWebhookDeliveriesInput,
  PeerWebhookInput,
  PeerWebhookList,
  PeerWebhookListInput,
  PeerWebhookRequeueInput,
  PeerWebhookRequeueResult,
  PeerWebhookTestResult,
} from "./webhooks.ts";

export const PEER_WEBHOOKS_METHODS = {
  peerWebhooksList: "peer.webhooks.list",
  peerWebhooksDeliveries: "peer.webhooks.deliveries",
  peerWebhooksRequeue: "peer.webhooks.requeue",
  peerWebhooksTest: "peer.webhooks.test",
} as const;

const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const WebhooksRpcGroup = RpcGroup.make(
  Rpc.make(PEER_WEBHOOKS_METHODS.peerWebhooksList, {
    payload: PeerWebhookListInput,
    success: PeerWebhookList,
    error,
  }),
  Rpc.make(PEER_WEBHOOKS_METHODS.peerWebhooksDeliveries, {
    payload: PeerWebhookDeliveriesInput,
    success: PeerWebhookDeliveries,
    error,
  }),
  Rpc.make(PEER_WEBHOOKS_METHODS.peerWebhooksRequeue, {
    payload: PeerWebhookRequeueInput,
    success: PeerWebhookRequeueResult,
    error,
  }),
  Rpc.make(PEER_WEBHOOKS_METHODS.peerWebhooksTest, {
    payload: PeerWebhookInput,
    success: PeerWebhookTestResult,
    error,
  }),
);

export const WebhooksRpcScopes = {
  [PEER_WEBHOOKS_METHODS.peerWebhooksList]: AuthAccessReadScope,
  [PEER_WEBHOOKS_METHODS.peerWebhooksDeliveries]: AuthAccessReadScope,
  [PEER_WEBHOOKS_METHODS.peerWebhooksRequeue]: AuthAccessWriteScope,
  [PEER_WEBHOOKS_METHODS.peerWebhooksTest]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof WebhooksRpcGroup>["_tag"], AuthEnvironmentScope>;
