import { expect, it } from "vite-plus/test";
import { addTask, dedupe, foldEvent, init, KNOWN_COUNTERS, sum } from "./vocabulary.ts";
const base = {
  workspace: "acme",
  project: "pay",
  session: "claude:a",
  runtimeGeneration: "one",
  adapter: "claude_mod",
};
it("folds only measured events and makes late deadline decisions an explicit approximation", () => {
  const r = init(),
    seen = dedupe(),
    event = (event: string, fields = {}) => foldEvent(r, { ...base, event, ...fields }, seen);
  event("intent", { ms: 50, verdictCounts: { deny: 1, clear: 2 } });
  event("intent.failed");
  event("intent.unverified", { wentOn: false });
  event("intent.unverified", { wentOn: true });
  event("intent.legacy");
  event("hook", { chars: 80, ms: 5 });
  event("hook.late");
  event("hook.stale");
  event("delivery.prepared", { chars: 80 });
  event("delivery.verified", { chars: 80 });
  event("provider.usage", {
    turnId: "a",
    index: 1,
    inputTokens: 5,
    cacheReadTokens: 10,
    cacheWriteTokens: 2,
    outputTokens: 3,
  });
  event("provider.usage", { turnId: "a", index: 1, inputTokens: 5 });
  event("provider.usage", { turnId: "a", index: 1, agentId: "child", inputTokens: 2 });
  for (const name of ["finding.prepared", "finding.requested"]) {
    event(name, { findings: ["f", "f"] });
    event(name, { findings: ["f"] });
  }
  for (const at of ["publish", "review", "done"]) event("handoff.stale", { at });
  event("handoff.unverified");
  event("handoff.refused", { refusal: "stale_context" });
  event("handoff.refused", { refusal: "other" });
  event("forecast.metric", { name: "confirmed", n: 2 });
  expect(r.counters).toMatchObject({
    "intents.decided.claude_mod": 1,
    "intents.contested.claude_mod": 1,
    "intents.unverified.claude_mod": 1,
    "verdicts.deny": 1,
    "provider.requests": 2,
    "provider.input_tokens": 19,
    "provider.output_tokens": 3,
    "findings.prepared": 1,
    "findings.requested": 1,
    "x.forecast.confirmed": 2,
    "delivery.verified_chars": 80,
  });
  expect(r.durations["intent_ms.claude_mod"]?.[3]).toBe(1);
  expect(KNOWN_COUNTERS).toHaveLength(44);
  const empty = init();
  foldEvent(empty, { event: "hook", chars: 80 });
  expect(empty.counters).toEqual({});
  expect(() => event("forecast.metric", { name: "Metric_Name", n: 1 })).toThrow();
  expect(() => event("forecast.metric", { name: "n".repeat(49), n: 1 })).toThrow();
});
it("bounds task and extension cardinality and preserves totals across sums", () => {
  const r = init();
  for (let i = 0; i < 60; i++)
    addTask(r, `t_${i.toString(16).padStart(12, "0")}`, {
      in: 1,
      out: 2,
      cached: 1,
      turns: 1,
      partial: 0,
    });
  for (let i = 0; i < 21; i++)
    foldEvent(r, { ...base, event: "forecast.metric", name: `n${i}`, n: 1 });
  expect(Object.keys(r.tasks)).toHaveLength(49);
  expect(Object.keys(r.counters)).toHaveLength(20);
  const total = sum([r, r]);
  expect(Object.values(total.tasks).reduce((n, v) => n + v.in + v.out, 0)).toBe(360);
  expect(total.counters["x.forecast.n0"]).toBe(2);
});
