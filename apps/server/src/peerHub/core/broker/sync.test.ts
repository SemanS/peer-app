import { afterEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { brokerFixture } from "./testkit.ts";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("syncing with the hub", () => {
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
