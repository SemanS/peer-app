import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { PeerWebhookDeliveries, PeerWebhookList } from "./webhooks.ts";

const decodeList = Schema.decodeUnknownSync(PeerWebhookList);
const decodeDeliveries = Schema.decodeSync(PeerWebhookDeliveries);

describe("webhook contracts", () => {
  it("reads new Hub values without exposing destination secrets", () => {
    const answer = decodeList({
      revision: null,
      webhooks: [
        {
          id: "ci",
          format: "future-format",
          events: ["future.event"],
          projects: null,
          enabled: true,
          destination: { state: "invalid" },
          signing: "missing",
          health: {
            pending: 0,
            failed: 1,
            lastDeliveredAt: null,
            lastFailure: { at: "2026-10-09T08:00:00Z", class: "future-class" },
          },
          extra: "ignored",
        },
      ],
    });
    expect(answer.webhooks[0]?.format).toBe("future-format");
    expect(answer.webhooks[0]?.health.lastFailure?.class).toBe("future-class");
    expect(answer.webhooks[0]?.destination.host).toBeUndefined();
  });

  it("reads a failed delivery without a next attempt", () => {
    const answer = decodeDeliveries({
      deliveries: [
        {
          id: "msg_1",
          event: "task.review",
          project: null,
          title: null,
          state: "failed",
          createdAt: "2026-10-09T08:00:00Z",
          attempts: 8,
          nextAttempt: null,
          failure: {
            at: "2026-10-09T09:00:00Z",
            class: "status",
            status: 404,
            detail: "Unavailable",
          },
        },
      ],
    });
    expect(answer.deliveries[0]?.nextAttempt).toBeNull();
    expect(answer.deliveries[0]?.failure?.status).toBe(404);
  });
});
