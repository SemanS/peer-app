import { describe, expect, it } from "@effect/vitest";
import type { PeerWebhook } from "@t3tools/contracts";

import {
  administeredWorkspaces,
  canRequeue,
  eventLabel,
  failureSentence,
  orderDeliveries,
  orderWebhooks,
  webhookActionMessage,
  webhookStatus,
} from "./webhooks.ts";

const hook = (changes: Partial<PeerWebhook> = {}): PeerWebhook => ({
  id: "ci",
  format: "generic",
  events: ["task.review"],
  projects: null,
  enabled: true,
  destination: { state: "ok", host: "events.example" },
  signing: "secret",
  health: { pending: 0, failed: 0, lastDeliveredAt: null, lastFailure: null },
  ...changes,
});
const failure = { at: "2026-10-09T09:00:00Z", class: "network" };

describe("webhook health", () => {
  it("reports queued counts without claiming delivery and orders newest failures first", () => {
    expect(webhookActionMessage({ requeued: 0 })).toBe(
      "0 deliveries requeued. Refresh to check delivery.",
    );
    expect(webhookActionMessage({ requeued: 1 })).toBe(
      "1 delivery requeued. Refresh to check delivery.",
    );
    expect(webhookActionMessage({ delivery: "msg_1" })).toBe(
      "Test queued. Refresh to check delivery.",
    );
    const delivery = {
      id: "old",
      event: "ping",
      project: null,
      title: null,
      state: "failed",
      attempts: 1,
      nextAttempt: null,
      failure: null,
      createdAt: "2026-10-08T00:00:00Z",
    };
    expect(
      orderDeliveries([
        delivery,
        { ...delivery, id: "new", createdAt: "2026-10-09T00:00:00Z" },
      ]).map(({ id }) => id),
    ).toEqual(["new", "old"]);
  });

  it("gives paused and setup problems precedence over delivery failures", () => {
    expect(webhookStatus(hook({ enabled: false, destination: { state: "missing" } }))).toBe(
      "paused",
    );
    expect(
      webhookStatus(
        hook({
          signing: "missing",
          health: { pending: 1, failed: 2, lastDeliveredAt: null, lastFailure: failure },
        }),
      ),
    ).toBe("needs-setup");
    expect(
      webhookStatus(
        hook({ health: { pending: 1, failed: 2, lastDeliveredAt: null, lastFailure: failure } }),
      ),
    ).toBe("failing");
  });

  it("retries only with pending work and a failure newer than the last success", () => {
    const health = { pending: 1, failed: 0, lastDeliveredAt: null, lastFailure: failure };
    expect(webhookStatus(hook({ health }))).toBe("retrying");
    expect(
      webhookStatus(hook({ health: { ...health, lastDeliveredAt: "2026-10-09T10:00:00Z" } })),
    ).toBe("healthy");
    expect(webhookStatus(hook({ health: { ...health, pending: 0 } }))).toBe("healthy");
  });

  it("sorts failures first and leaves its input unchanged", () => {
    const rows = [
      hook(),
      hook({
        id: "broken",
        health: { pending: 0, failed: 1, lastDeliveredAt: null, lastFailure: failure },
      }),
    ];
    expect(orderWebhooks(rows).map(({ id }) => id)).toEqual(["broken", "ci"]);
    expect(rows[0]?.id).toBe("ci");
  });

  it("shows unknown events and errors as text and excludes members' workspaces", () => {
    expect(eventLabel("future.event")).toBe("future.event");
    expect(
      failureSentence({ ...failure, class: "future", detail: "line one\nprivate continuation" }),
    ).toBe("future · line one");
    expect(
      administeredWorkspaces({
        workspaces: [
          { role: "member", slug: "one" },
          { role: "admin", slug: "two" },
        ],
      }).map(({ slug }) => slug),
    ).toEqual(["two"]);
    expect(canRequeue(hook({ enabled: false }))).toBe(false);
    expect(canRequeue(hook(), { state: "failed" })).toBe(true);
    expect(canRequeue(hook(), { state: "delivered" })).toBe(false);
  });
});
