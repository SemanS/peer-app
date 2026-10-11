import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { PeerOverlapRecord, PeerStaleReads } from "@t3tools/contracts";
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
  it("snapshots what the hub recorded as deciding an overlap, and the policies projects set", async () => {
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
      const view = (overlaps: ReadonlyArray<PeerOverlapRecord>) => ({
        sessions: [],
        overlaps,
        at: overlap.updatedAt,
        // `lockstep` is a policy of a newer hub: it counts as none here, as for the agents.
        policies: { app: "coordinate", docs: "notify", site: "lockstep" },
      });
      // A path rule of the project decides for every computer: it is the overlap's policy too.
      const rule = { policy: "ask", source: "project", pattern: "docs/**" } as const;
      fixture.broker.views.set("acme", view([{ ...overlap, decision: rule }]));
      const ruled = fixture.broker.snapshot();
      expect(ruled.overlaps[0]).toMatchObject({ decision: rule, policy: "ask" });
      expect(ruled.policies).toEqual({ acme: { app: "coordinate", docs: "notify" } });
      // A computer's default is the one that asked's, which may be another: not this one's.
      const asked = { policy: "ask", source: "client" } as const;
      fixture.broker.views.set("acme", view([{ ...overlap, decision: asked }]));
      expect(fixture.broker.snapshot().overlaps[0]).toMatchObject({
        decision: asked,
        policy: "coordinate",
      });
      // A policy this Peer does not know decides nothing.
      fixture.broker.views.set(
        "acme",
        view([{ ...overlap, decision: { policy: "lockstep", source: "project" } }]),
      );
      expect(fixture.broker.snapshot().overlaps[0]?.policy).toBe("coordinate");
      // A hub from before decisions and project policies says neither.
      fixture.broker.views.set("acme", {
        sessions: [],
        overlaps: [overlap],
        at: overlap.updatedAt,
      });
      const before = fixture.broker.snapshot();
      expect(before.overlaps[0]?.decision).toBeUndefined();
      expect(before.overlaps[0]?.policy).toBe("coordinate");
      // The workspace is listed once its view is known, with no project policy to name.
      expect(before.policies).toEqual({ acme: {} });
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
