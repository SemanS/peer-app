import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { PeerStaleReads } from "@t3tools/contracts";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

describe("people's decision signals from coordination", () => {
  it("snapshots the project policy or the environment fallback", async () => {
    const fixture = await brokerFixture(() => ({ policy: () => "coordinate" }));
    try {
      const overlap = {
        id: "o",
        project: "app",
        sessions: [],
        files: [],
        state: "open" as const,
        notes: [],
        openedAt: "2026-10-09T09:00:00Z",
        updatedAt: "2026-10-09T09:00:00Z",
      };
      fixture.broker.views.set("acme", {
        sessions: [],
        overlaps: [overlap],
        at: overlap.updatedAt,
        policies: { app: "ask" },
      });
      expect(fixture.broker.snapshot().overlaps[0]?.policy).toBe("ask");
      fixture.broker.views.set("acme", {
        sessions: [],
        overlaps: [overlap],
        at: overlap.updatedAt,
        policies: { app: "future-policy" },
      });
      expect(fixture.broker.snapshot().overlaps[0]?.policy).toBe("coordinate");
    } finally {
      await fixture.dispose();
    }
  });
  it("reports structured stale versions once per refusal, and nothing for a fresh handoff", async () => {
    let fresh = false;
    const reports: PeerStaleReads["stale"][] = [];
    const stale = [
      {
        project: "app",
        scope: "task:removed",
        readVersion: 3,
        currentVersion: null,
        at: "2026-10-09T09:00:00Z",
        updatedAt: null,
      },
    ];
    const fixture = await brokerFixture(() => ({
      staleReads: async () => ({ fresh, stale: fresh ? [] : stale }),
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [
          {
            id: "knowledge",
            title: "Test",
            contributions: {
              hooks: {
                handoffRefused: (_session, scopes) =>
                  Effect.sync(() => {
                    reports.push(scopes);
                  }),
              },
            },
          },
        ],
      }),
    }));
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      expect(await fixture.broker.handoffRefusal(session)).not.toBeNull();
      expect(reports).toEqual([stale]);
      fresh = true;
      expect(await fixture.broker.handoffRefusal(session)).toBeNull();
      expect(reports).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });
});
