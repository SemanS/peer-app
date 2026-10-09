import { describe, expect, it } from "@effect/vitest";
import { Refusals } from "./refusals.ts";

const scopes = [{ scope: "task:removed", readVersion: 3, currentVersion: null }];
describe("standing stale-input refusals", () => {
  it("waits two minutes and checks again before showing a removed input", async () => {
    const store = new Refusals();
    store.record("session", scopes, 0);
    expect(store.list(119_999)).toEqual([]);
    await store.refresh(120_000, new Set(["session"]), async () => scopes);
    expect(store.list(120_000)[0]).toEqual({
      session: "session",
      since: "1970-01-01T00:00:00.000Z",
      scopes,
    });
    expect(store.nextWake(120_000)).toBe(240_000);
  });
  it("never shows a recovered refusal and drops it after a later successful recheck", async () => {
    const store = new Refusals();
    store.record("session", scopes, 0);
    await store.refresh(120_000, new Set(["session"]), async () => []);
    expect(store.list(120_000)).toEqual([]);
    expect(store.nextWake(120_000)).toBeNull();
    store.record("session", scopes, 120_000);
    await store.refresh(240_000, new Set(["session"]), async () => scopes);
    expect(store.list(240_000)).toHaveLength(1);
    await store.refresh(360_000, new Set(["session"]), async () => []);
    expect(store.list(360_000)).toEqual([]);
  });
  it("clears ended sessions, expires after a day and evicts the oldest within its bound", async () => {
    const store = new Refusals(2);
    store.record("old", scopes, 0);
    store.record("middle", scopes, 1);
    store.record("new", scopes, 2);
    expect(store.size).toBe(2);
    await store.refresh(120_002, new Set(["middle", "new"]), async () => scopes);
    expect(store.list(120_002).map((v) => v.session)).toEqual(["middle", "new"]);
    store.end("middle");
    expect(store.list(120_002)).toHaveLength(1);
    await store.refresh(86_400_002, new Set(["new"]), async () => scopes);
    expect(store.size).toBe(0);
  });
  it("retains known stale versions on a transient read error, with a bounded retry deadline", async () => {
    const store = new Refusals();
    store.record("session", scopes, 0);
    await store.refresh(120_000, new Set(["session"]), async () => {
      throw new Error("offline");
    });
    expect(store.list(120_000)[0]?.scopes).toEqual(scopes);
    expect(store.nextWake(120_000)).toBe(240_000);
    await store.refresh(120_001, new Set(), async () => scopes);
    expect(store.size).toBe(0);
  });
});
