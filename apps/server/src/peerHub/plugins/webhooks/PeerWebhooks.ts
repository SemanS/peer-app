import {
  PeerHubError,
  PeerWebhookDeliveries,
  PeerWebhookList,
  PeerWebhookRequeueResult,
  PeerWebhookTestResult,
  type PeerWebhookDeliveriesInput,
  type PeerWebhookInput,
  type PeerWebhookListInput,
  type PeerWebhookRequeueInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

/** Admin visibility and repairs; calls stay on the environment's authenticated Hub session. */
export class PeerWebhooks extends Context.Service<
  PeerWebhooks,
  {
    readonly list: (input: PeerWebhookListInput) => Effect.Effect<PeerWebhookList, PeerHubError>;
    readonly deliveries: (
      input: PeerWebhookDeliveriesInput,
    ) => Effect.Effect<PeerWebhookDeliveries, PeerHubError>;
    readonly requeue: (
      input: PeerWebhookRequeueInput,
    ) => Effect.Effect<typeof PeerWebhookRequeueResult.Type, PeerHubError>;
    readonly test: (
      input: PeerWebhookInput,
    ) => Effect.Effect<typeof PeerWebhookTestResult.Type, PeerHubError>;
  }
>()("t3/peerHub/plugins/webhooks/PeerWebhooks") {}

const make = Effect.gen(function* () {
  const client = yield* PeerHubClient.PeerHubClient;
  const requireAnswer =
    (detail: string) =>
    <A>(answer: A | null) =>
      answer === null ? Effect.fail(new PeerHubError({ detail })) : Effect.succeed(answer);
  const found = requireAnswer("That webhook no longer exists.");
  const path = (id: string) => `/webhooks/${encodeURIComponent(id)}`;
  return PeerWebhooks.of({
    list: ({ workspace }) =>
      client
        .request(PeerWebhookList, {
          workspace,
          path: "/webhooks",
          method: "GET",
          notFound: { value: null },
        })
        .pipe(
          Effect.flatMap(requireAnswer("This workspace's webhooks are not available on the Hub.")),
        ),
    deliveries: ({ workspace, id, state, limit }) => {
      const query = new URLSearchParams();
      if (state !== undefined) query.set("state", state);
      if (limit !== undefined) query.set("limit", String(limit));
      return client
        .request(PeerWebhookDeliveries, {
          workspace,
          path: `${path(id)}/deliveries${query.size ? `?${query}` : ""}`,
          method: "GET",
          notFound: { value: null },
        })
        .pipe(Effect.flatMap(found));
    },
    requeue: ({ workspace, id, delivery }) =>
      client
        .request(PeerWebhookRequeueResult, {
          workspace,
          path: `${path(id)}/requeue`,
          method: "POST",
          body: delivery === undefined ? {} : { delivery },
          notFound: { value: null },
        })
        .pipe(Effect.flatMap(found)),
    test: ({ workspace, id }) =>
      client
        .request(PeerWebhookTestResult, {
          workspace,
          path: `${path(id)}/test`,
          method: "POST",
          body: {},
          notFound: { value: null },
        })
        .pipe(Effect.flatMap(found)),
  });
});

export const layer = Layer.effect(PeerWebhooks, make);
