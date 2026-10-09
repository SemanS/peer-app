import { PEER_WEBHOOKS_METHODS, PEER_WEBHOOKS_PLUGIN, WebhooksRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Webhooks from "./PeerWebhooks.ts";

/** Webhooks have no agent commands or notices; only admins inspect and repair deliveries. */
export const WebhooksPlugin = bindPlugin({
  id: "webhooks",
  title: PEER_WEBHOOKS_PLUGIN.title,
  summary: PEER_WEBHOOKS_PLUGIN.summary,
  hubFeature: PEER_WEBHOOKS_PLUGIN.hubFeature,
  defaultEnabled: true,
  layer: Webhooks.layer,
  make: Effect.gen(function* () {
    const webhooks = yield* Webhooks.PeerWebhooks;
    const methods = PEER_WEBHOOKS_METHODS;
    return {
      rpc: {
        group: WebhooksRpcGroup,
        handlers: (wrap) =>
          WebhooksRpcGroup.of({
            [methods.peerWebhooksList]: (input) =>
              wrap.effect(methods.peerWebhooksList, webhooks.list(input)),
            [methods.peerWebhooksDeliveries]: (input) =>
              wrap.effect(methods.peerWebhooksDeliveries, webhooks.deliveries(input)),
            [methods.peerWebhooksRequeue]: (input) =>
              wrap.effect(methods.peerWebhooksRequeue, webhooks.requeue(input)),
            [methods.peerWebhooksTest]: (input) =>
              wrap.effect(methods.peerWebhooksTest, webhooks.test(input)),
          }),
      },
    } satisfies PeerContributions;
  }),
});
