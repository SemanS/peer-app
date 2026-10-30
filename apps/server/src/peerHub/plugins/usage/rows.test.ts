import { describe, expect, it } from "@effect/vitest";
import {
  PEER_USAGE_REPORT_LIMITS,
  PeerUsageReportBody,
  type PeerUsageReportRow,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { reportRows, type UsageRowInput } from "./rows.ts";

const session = (over: Partial<UsageRowInput> & { readonly output?: number }): UsageRowInput => {
  const { output = 1, ...rest } = over;
  return {
    provider: "claude",
    model: "claude-opus-5-5",
    capacity: "personal",
    sessionId: "one",
    totals: {
      uncachedInputTokens: 10,
      cachedInputTokens: 4,
      cacheCreationTokens: 3,
      outputTokens: output,
      reasoningTokens: 0,
    },
    costUsd: 0.5,
    unpriced: false,
    ...rest,
  };
};

const decodes = Schema.is(PeerUsageReportBody);
const tokens = (rows: ReadonlyArray<PeerUsageReportRow>) =>
  rows.reduce((sum, row) => sum + row.input + row.output + row.cached, 0);

describe("a day's rows", () => {
  it("fold by agent, model and capacity, counting each session once", () => {
    const rows = reportRows(
      [
        session({ sessionId: "one" }),
        session({ sessionId: "one", output: 2 }),
        session({ sessionId: "two" }),
        session({ sessionId: "" }),
        session({ capacity: "shared" }),
        session({ provider: "codex", model: "gpt-6" }),
      ],
      "env",
    );
    expect(rows).toEqual([
      {
        agent: "claude",
        model: "claude-opus-5-5",
        capacity: "personal",
        input: 52,
        output: 5,
        cached: 16,
        usd: 2,
        sessions: 2,
      },
      {
        agent: "claude",
        model: "claude-opus-5-5",
        capacity: "shared",
        input: 13,
        output: 1,
        cached: 4,
        usd: 0.5,
        sessions: 1,
      },
      {
        agent: "codex",
        model: "gpt-6",
        capacity: "personal",
        input: 13,
        output: 1,
        cached: 4,
        usd: 0.5,
        sessions: 1,
      },
    ]);
  });

  it("leave a model without a price at null, its tokens still counted", () => {
    const rows = reportRows([session({ model: "mystery", unpriced: true, costUsd: 0 })], "env");
    expect(rows[0]?.usd).toBeNull();
    expect(tokens(rows)).toBe(18);
  });

  it("do not depend on the order sessions were read in", () => {
    const sessions = Array.from({ length: 40 }, (_, index) =>
      session({ sessionId: `s${index}`, costUsd: 0.1 + index / 7 }),
    );
    expect(reportRows(sessions.toReversed(), "env")).toEqual(reportRows(sessions, "env"));
  });

  it("over 64, fold the smallest into `other`, keeping every token and the priced apart", () => {
    const sessions = Array.from({ length: 100 }, (_, index) =>
      session({
        model: `model-${String(index).padStart(3, "0")}`,
        output: index + 1,
        unpriced: index % 10 === 0,
      }),
    );
    const rows = reportRows(sessions, "env");
    expect(rows).toHaveLength(PEER_USAGE_REPORT_LIMITS.rows);
    // 17 tokens of each session are its input and cache; the rest are its output.
    expect(tokens(rows)).toBe(
      sessions.reduce((sum, item) => sum + 17 + item.totals.outputTokens, 0),
    );
    // The largest stay named.
    expect(rows.map((row) => row.model)).toContain("model-099");
    expect(rows.map((row) => row.model)).not.toContain("model-000");
    const others = rows.filter((row) => row.model === "other");
    expect(others.map((row) => row.usd === null).toSorted()).toEqual([false, true]);
    expect(decodes({ environment: "env", rev: 1, rows })).toBe(true);
  });

  it("stay under the Hub's 16 KiB, which the schema cannot say", () => {
    const longName = (index: number) =>
      String(index).padEnd(PEER_USAGE_REPORT_LIMITS.modelChars, "x");
    const sessions = Array.from({ length: 64 }, (_, index) =>
      session({
        model: longName(index),
        output: 1e12 + index,
        costUsd: 123_456.789012,
        totals: {
          uncachedInputTokens: 1e12,
          cachedInputTokens: 1e12,
          cacheCreationTokens: 0,
          outputTokens: 1e12 + index,
          reasoningTokens: 0,
        },
      }),
    );
    const environment = "e".repeat(120);
    const rows = reportRows(sessions, environment);
    const body = { environment, rev: Number.MAX_SAFE_INTEGER, rows };
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThanOrEqual(
      PEER_USAGE_REPORT_LIMITS.bytes,
    );
    expect(rows.length).toBeLessThan(64);
    expect(decodes(body)).toBe(true);
  });

  it("name a model only when the whole name has a model's shape", () => {
    const named = (model: string) => reportRows([session({ model })], "env")[0]?.model;
    expect(named("gpt-6.1_sol+fast")).toBe("gpt-6.1_sol+fast");
    expect(named("m".repeat(PEER_USAGE_REPORT_LIMITS.modelChars))).toBe(
      "m".repeat(PEER_USAGE_REPORT_LIMITS.modelChars),
    );
    expect(named("m".repeat(PEER_USAGE_REPORT_LIMITS.modelChars + 1))).toBe("other");
    expect(named("/Users/ana/models/llama.gguf")).toBe("other");
    expect(named("arn:aws:bedrock:eu-west-1:123456789012:foundation-model/x")).toBe("other");
  });

  it("leave out records of no tokens, and count no session for them", () => {
    const empty = {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    const synthetic = {
      model: "<synthetic>",
      sessionId: "two",
      totals: empty,
      costUsd: 0,
      unpriced: true,
    };
    expect(reportRows([session(synthetic)], "env")).toEqual([]);
    const rows = reportRows(
      [session({}), session(synthetic), session({ ...synthetic, model: "claude-opus-5-5" })],
      "env",
    );
    expect(rows.map(({ model, sessions, usd }) => ({ model, sessions, usd }))).toEqual([
      { model: "claude-opus-5-5", sessions: 1, usd: 0.5 },
    ]);
  });

  it("keep a session whose only tokens are of one kind", () => {
    const zero = {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    for (const kind of [
      "uncachedInputTokens",
      "cachedInputTokens",
      "cacheCreationTokens",
      "outputTokens",
    ] as const)
      expect(tokens(reportRows([session({ totals: { ...zero, [kind]: 1 } })], "env"))).toBe(1);
  });

  it("hold only what the Hub allows, however odd the transcript", () => {
    const rows = reportRows(
      [
        session({ model: "m".repeat(500) }),
        session({ model: "bad\nname" }),
        session({ model: "" }),
        session({ model: "huge", costUsd: 1e12, output: 1e15 }),
        session({ model: "gone", costUsd: Number.NaN }),
      ],
      "env",
    );
    expect(decodes({ environment: "env", rev: 1, rows })).toBe(true);
    for (const row of rows)
      expect(Object.keys(row).toSorted()).toEqual([
        "agent",
        "cached",
        "capacity",
        "input",
        "model",
        "output",
        "sessions",
        "usd",
      ]);
  });
});
