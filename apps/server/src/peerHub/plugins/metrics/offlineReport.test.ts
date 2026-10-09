import { describe, expect, it } from "@effect/vitest";
import { coordinationMetrics } from "./offlineReport.ts";
describe("coordination measurement", () => {
  it("requires exact runtime receipts and deduplicates provider requests", () => {
    const base = { session: "claude:a", runtimeGeneration: "one", id: "delivery" };
    const usage = {
      ...base,
      event: "provider.usage",
      turnId: "t",
      index: 1,
      inputTokens: 5,
      cacheReadTokens: 10,
      outputTokens: 3,
    };
    const result = coordinationMetrics([
      { ...base, event: "delivery.prepared", chars: 80 },
      { ...base, runtimeGeneration: "two", event: "delivery.verified" },
      { ...base, event: "delivery.verified", chars: 80 },
      { ...base, event: "delivery.verified", chars: 80 },
      usage,
      usage,
      { event: "hook", chars: 80 },
      { event: "intent", ms: 50 },
      { event: "intent", ms: 100 },
    ]);
    expect(result.modDelivery).toEqual({
      prepared: 1,
      verified: 1,
      pending: 0,
      confirmedChars: 80,
    });
    expect(result.provider).toMatchObject({ usageSamples: 1, inputTokens: 15, outputTokens: 3 });
    expect(result.intent).toMatchObject({ p50Ms: 50, p95Ms: 100 });
    expect(result.findingUse).toContain("unknown");
  });
  it("reads privacy-projected usage without needing debug evidence", () => {
    const result = coordinationMetrics([
      {
        event: "provider.usage",
        session: "codex:a",
        turnId: "one",
        index: 0,
        inputTokens: 5,
        cacheReadTokens: 10,
        cacheWriteTokens: 2,
        outputTokens: 3,
      },
      {
        event: "provider.usage",
        session: "codex:a",
        turnId: "one",
        index: 0,
        inputTokens: 5,
        cacheReadTokens: 10,
        cacheWriteTokens: 2,
        outputTokens: 3,
      },
    ]);
    expect(result.provider).toMatchObject({ usageSamples: 1, inputTokens: 17, outputTokens: 3 });
  });
  it("does not invent latency or delivery when no evidence exists", () => {
    expect(coordinationMetrics([]).intent.p95Ms).toBeNull();
    expect(coordinationMetrics([{ event: "hook", chars: 100 }]).modDelivery.verified).toBe(0);
  });
  it("counts distinct subagent requests that share a parent turn and index", () => {
    const sample = {
      event: "provider.usage",
      session: "claude:a",
      runtimeGeneration: "one",
      turnId: "t",
      index: 1,
      inputTokens: 5,
      outputTokens: 2,
    };
    const result = coordinationMetrics([
      sample,
      { ...sample, agentId: "child" },
      { ...sample, agentId: "child" },
    ]);
    expect(result.provider).toMatchObject({ usageSamples: 2, inputTokens: 10, outputTokens: 4 });
  });
  it("distinguishes repeated notices from explicit requests by each session", () => {
    const base = { session: "a", runtimeGeneration: "one", findings: ["f", "f", 42] };
    const result = coordinationMetrics([
      { ...base, event: "finding.prepared" },
      { ...base, event: "finding.prepared" },
      { ...base, event: "finding.requested" },
      { ...base, event: "finding.requested" },
      { ...base, session: "b", event: "finding.requested" },
    ]);
    expect(result.findings).toMatchObject({ noticePrepared: 1, explicitlyRequested: 2 });
    expect(result.findingUse).toContain("unknown");
  });
});
