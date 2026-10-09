import { describe, expect, it } from "@effect/vitest";
import { makeState } from "./state.ts";
const answer = {
  held: [
    {
      project: "app",
      kind: "resource" as const,
      name: "deploy",
      holder: { session: "claude:a", email: "me", environment: "laptop" },
      expiresAt: "2026-10-09T12:30:00Z",
    },
  ],
  patterns: { app: [{ pattern: "migrations/**", policy: "exclusive" as const }] },
  at: "2026-10-09T12:00:00Z",
};
describe("resource cache", () => {
  it("debounces pings, preserves equal identity and asks again at lease expiry before hiding", () => {
    let now = 0;
    const state = makeState(() => now);
    state.queue("acme");
    state.queue("acme");
    expect(state.due()).toEqual([]);
    now = 250;
    expect(state.due()).toEqual(["acme"]);
    state.accept("acme", answer);
    const first = state.read("acme");
    state.accept("acme", answer);
    expect(state.read("acme")).toBe(first);
    now += 30 * 60_000;
    expect(state.due()).toEqual(["acme"]);
    expect(state.read("acme")?.held).toHaveLength(1);
    const renewed = {
      ...answer,
      at: "2026-10-09T12:30:00Z",
      held: [{ ...answer.held[0]!, expiresAt: "2026-10-09T13:00:00Z" }],
    };
    state.accept("acme", renewed);
    expect(state.read("acme")?.held[0]?.expiresAt).toBe(renewed.held[0]?.expiresAt);
    expect(state.due()).toEqual([]);
  });
  it("backs off old Hubs and forgets lost membership before a late answer returns", () => {
    let now = 0;
    const state = makeState(() => now);
    state.unsupported("acme");
    state.queue("acme");
    now = 1000;
    expect(state.due()).toEqual([]);
    expect(state.supported("acme")).toBe(false);
    now = 600_001;
    state.queue("acme");
    now += 250;
    expect(state.due()).toEqual(["acme"]);
    state.accept("acme", answer);
    state.forget([]);
    state.accept("acme", answer);
    expect(state.read("acme")).toBeUndefined();
    state.own("acme", answer.held[0]!, answer.at);
    state.queue("acme");
    state.unsupported("acme");
    state.forget(["acme"]);
    expect(state.read("acme")).toBeUndefined();
    expect(state.due()).toEqual([]);
  });
});
