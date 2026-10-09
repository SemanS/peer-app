import { afterEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { brokerFixture } from "./testkit.ts";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("syncing with the hub", () => {
  it("retires a superseded provider session even when its thread identity arrived late", async () => {
    let bound = false;
    const reports: ReadonlyArray<{ id: string }>[] = [];
    const fixture = await brokerFixture(() => ({
      threadOf: async () => (bound ? "peer:thread" : undefined),
      threadAgent: async () => ({ agent: "codex", nativeId: "current", cwd: "" }),
      report: async (_workspace, sessions) => {
        reports.push(sessions);
        return { sessions: [], overlaps: [], at: "2026-10-09T00:00:00Z" };
      },
    }));
    try {
      await fixture.register("previous");
      const session = fixture.broker.sessions.get("claude:previous")!;
      session.threadTries = 6;
      session.threadLastLookedAt = 0;
      bound = true;
      await fixture.broker.sync();
      expect(fixture.broker.sessions.has("claude:previous")).toBe(false);
      expect(reports.flat().map((row) => row.id)).not.toContain("claude:previous");
    } finally {
      await fixture.dispose();
    }
  });
  it("reports a workspace and waits for the hub however long it takes, where a sync stops at its budget", async () => {
    const answered = Promise.withResolvers<void>();
    const fixture = await brokerFixture(() => ({
      report: async () => {
        await answered.promise;
        return { sessions: [], overlaps: [], at: "2026-10-06T10:00:00Z" };
      },
    }));
    try {
      await fixture.register("one");
      vi.useFakeTimers();
      const within = fixture.broker.syncWithin("acme", 5000);
      await vi.advanceTimersByTimeAsync(5000);
      await within;
      let reported = false;
      const report = fixture.broker.reportNow("acme").then(() => {
        reported = true;
      });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(reported).toBe(false);
      answered.resolve();
      await report;
      expect(reported).toBe(true);
    } finally {
      vi.useRealTimers();
      answered.resolve();
      await fixture.dispose();
    }
  });
});
