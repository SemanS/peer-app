// @effect-diagnostics globalDate:off - fixed Hub timestamps and an injected clock.
import { describe, expect, it } from "@effect/vitest";
import { makeCache } from "./cache.ts";
import type { PeerAnnouncementSync } from "@t3tools/contracts";
const at = Date.parse("2026-10-09T08:00:00Z");
const answer = (now = at): PeerAnnouncementSync => ({
  at: new Date(now).toISOString(),
  announcements: [
    {
      id: "one",
      project: "app",
      author: { kind: "person", email: "ana@example.test" },
      text: "ok",
      wake: true,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
    },
  ],
  delivered: [],
  rejected: [],
});
describe("announcement workspace cache", () => {
  it("does not restore removed project data when an older read finishes", async () => {
    const cache = makeCache(() => at);
    let resume!: () => void;
    const barrier = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const pending = cache.refresh("acme", async () => {
      await barrier;
      return answer();
    });
    cache.restrict(new Map([["acme", new Set(["other"])]]));
    resume();
    await pending;
    expect(cache.rows("acme")).toEqual([]);
    expect(cache.summary().projects).toEqual([]);
  });
  it("single-flights two dirty pings into exactly one extra read", async () => {
    const cache = makeCache(() => at);
    let finish!: () => void;
    let calls = 0;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const load = async () => {
      calls++;
      if (calls === 1) await barrier;
      return answer();
    };
    const first = cache.refresh("acme", load);
    const second = cache.refresh("acme", load);
    const third = cache.refresh("acme", load);
    expect(calls).toBe(1);
    finish();
    await Promise.all([first, second, third]);
    expect(calls).toBe(2);
  });
  it("retains data on network errors, clears unsupported for ten minutes and respects Hub expiry", async () => {
    let clock = at - 3600000;
    const cache = makeCache(() => clock);
    await cache.refresh("acme", async () => answer());
    expect(cache.rows("acme")).toHaveLength(1);
    await expect(
      cache.refresh("acme", async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(cache.rows("acme")).toHaveLength(1);
    clock += 60001;
    expect(cache.rows("acme")).toEqual([]);
    await cache.refresh("acme", async () => null);
    expect(cache.unsupported("acme")).toBe(true);
    let calls = 0;
    await cache.refresh("acme", async () => {
      calls++;
      return answer();
    });
    expect(calls).toBe(0);
    clock += 600001;
    await cache.refresh("acme", async () => answer(clock));
    expect(cache.unsupported("acme")).toBe(false);
  });
  it("is due five minutes after an answer, a minute after a failure, and not while unsupported", async () => {
    let clock = at;
    const cache = makeCache(() => clock);
    expect(cache.due("acme")).toBe(true);
    await cache.refresh("acme", async () => answer());
    clock += 300000;
    expect(cache.due("acme")).toBe(false);
    clock += 1;
    expect(cache.due("acme")).toBe(true);
    cache.failed("acme");
    expect(cache.due("acme")).toBe(false);
    clock += 60000;
    expect(cache.due("acme")).toBe(true);
    await cache.refresh("acme", async () => null);
    clock += 300001;
    expect(cache.unsupported("acme")).toBe(true);
    expect(cache.due("acme")).toBe(false);
    clock += 300000;
    expect(cache.due("acme")).toBe(true);
  });
  it("updates own posts immediately and forgets withdrawn or inaccessible projects", async () => {
    const cache = makeCache(() => at);
    await cache.refresh("acme", async () => answer());
    cache.post("acme", { ...answer().announcements[0]!, id: "two" }, ["one"]);
    expect(cache.rows("acme").map((row) => row.id)).toEqual(["one", "two"]);
    expect(cache.rows("acme")[0]?.status).toBe("withdrawn");
    cache.withdraw("acme", ["two"]);
    expect(cache.summary().projects).toEqual([]);
    cache.restrict(new Map([["acme", new Set(["other"])]]));
    expect(cache.rows("acme")).toEqual([]);
    cache.restrict(new Map());
    expect(cache.summary().unsupported).toEqual([]);
  });
});
