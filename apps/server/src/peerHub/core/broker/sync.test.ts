import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import type { PeerHooks } from "../plugin.ts";
import { NO_PLUGINS } from "./host.ts";
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
  it("tells plugins a session's lease ran out, which no end hook said", async () => {
    const heard: Array<string> = [];
    const hooks: PeerHooks = {
      sessionEnd: ({ session }) => Effect.sync(() => void heard.push(`ended ${session.id}`)),
      sessionExpired: ({ session }) => Effect.sync(() => void heard.push(`expired ${session.id}`)),
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [{ id: "rooms", title: "Rooms", contributions: { hooks } }],
      }),
    }));
    try {
      await fixture.register("crashed");
      await fixture.register("working");
      fixture.broker.sessions.get("claude:crashed")!.lastActivity = Date.now() - 31 * 60_000;
      await fixture.broker.sync();
      expect(heard).toEqual(["expired claude:crashed"]);
      expect(fixture.broker.sessions.has("claude:crashed")).toBe(false);
      expect(fixture.broker.sessions.has("claude:working")).toBe(true);
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
