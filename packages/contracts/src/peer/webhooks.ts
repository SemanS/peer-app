import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

export const PeerWebhookFailure = Schema.Struct({
  at: Schema.String,
  class: Schema.String,
  status: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.String),
});
export type PeerWebhookFailure = typeof PeerWebhookFailure.Type;

export const PeerWebhookDestination = Schema.Struct({
  state: Schema.String,
  host: Schema.optional(Schema.String),
});
export type PeerWebhookDestination = typeof PeerWebhookDestination.Type;

export const PeerWebhookHealth = Schema.Struct({
  pending: Schema.Number,
  failed: Schema.Number,
  lastDeliveredAt: Schema.NullOr(Schema.String),
  lastFailure: Schema.NullOr(PeerWebhookFailure),
});
export type PeerWebhookHealth = typeof PeerWebhookHealth.Type;

export const PeerWebhook = Schema.Struct({
  id: Schema.String,
  format: Schema.String,
  events: Schema.Array(Schema.String),
  projects: Schema.NullOr(Schema.Array(Schema.String)),
  enabled: Schema.Boolean,
  destination: PeerWebhookDestination,
  signing: Schema.String,
  health: PeerWebhookHealth,
});
export type PeerWebhook = typeof PeerWebhook.Type;

export const PeerWebhookList = Schema.Struct({
  revision: Schema.NullOr(Schema.String),
  webhooks: Schema.Array(PeerWebhook),
});
export type PeerWebhookList = typeof PeerWebhookList.Type;

export const PeerWebhookDelivery = Schema.Struct({
  id: Schema.String,
  event: Schema.String,
  project: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  state: Schema.String,
  createdAt: Schema.String,
  attempts: Schema.Number,
  nextAttempt: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(PeerWebhookFailure),
});
export type PeerWebhookDelivery = typeof PeerWebhookDelivery.Type;
export const PeerWebhookDeliveries = Schema.Struct({
  deliveries: Schema.Array(PeerWebhookDelivery),
});
export type PeerWebhookDeliveries = typeof PeerWebhookDeliveries.Type;

export const PeerWebhookListInput = Schema.Struct({ workspace: TrimmedNonEmptyString });
export type PeerWebhookListInput = typeof PeerWebhookListInput.Type;
export const PeerWebhookInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type PeerWebhookInput = typeof PeerWebhookInput.Type;
export const PeerWebhookDeliveriesInput = Schema.Struct({
  ...PeerWebhookInput.fields,
  state: Schema.optional(Schema.Literals(["pending", "failed", "delivered"])),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
});
export type PeerWebhookDeliveriesInput = typeof PeerWebhookDeliveriesInput.Type;
export const PeerWebhookRequeueInput = Schema.Struct({
  ...PeerWebhookInput.fields,
  delivery: Schema.optional(TrimmedNonEmptyString),
});
export type PeerWebhookRequeueInput = typeof PeerWebhookRequeueInput.Type;
export const PeerWebhookRequeueResult = Schema.Struct({ requeued: Schema.Number });
export const PeerWebhookTestResult = Schema.Struct({ delivery: Schema.String });

export const PEER_WEBHOOKS_PLUGIN = {
  id: "webhooks",
  title: "Webhooks",
  summary: "Send signed workspace notifications and inspect failed deliveries.",
  hubFeature: { id: "webhooks", revision: 1 },
} as const;
