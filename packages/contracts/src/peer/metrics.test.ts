import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  PeerMetricsDays,
  PeerMetricsDaysInput,
  PeerMetricsRow,
  PeerMetricsSummary,
  PEER_METRICS_BUCKETS,
} from "./metrics.ts";
const decodeRow = Schema.decodeUnknownSync(PeerMetricsRow),
  encodeRow = Schema.encodeSync(PeerMetricsRow),
  decodeSummary = Schema.decodeSync(PeerMetricsSummary),
  encodeSummary = Schema.encodeSync(PeerMetricsSummary),
  decodeDays = Schema.decodeUnknownSync(PeerMetricsDaysInput),
  encodeDays = Schema.encodeSync(PeerMetricsDays);
const row = {
  counters: { "intents.decided.claude_mod": 3 },
  durations: { "intent_ms.claude_mod": Array<number>(21).fill(1) },
  tasks: { t_ae9c96b09dfc: { in: 50, out: 10, cached: 5, turns: 2, partial: 1 } },
};
const place = {
  workspace: "acme",
  project: "pay",
  scope: "environment" as const,
  computedAt: "2026-10-09T00:00:00Z",
  team: { state: "unknown" as const, reason: "Not reached" },
};
it("round trips measured rows, windows and day ranges and enforces all 21 slots", () => {
  expect(decodeRow(encodeRow(row))).toEqual(row);
  const summary = {
    ...place,
    window: 28 as const,
    dayEnding: "2026-10-09",
    current: row,
    previous: row,
  };
  expect(decodeSummary(encodeSummary(summary))).toEqual(summary);
  for (const slots of [20, 22])
    expect(() =>
      decodeRow({
        ...row,
        durations: { intent_ms: Array(slots).fill(0) },
      }),
    ).toThrow();
  expect(() =>
    decodeRow({
      ...row,
      tasks: { "SENTINEL-task-title": row.tasks.t_ae9c96b09dfc },
    }),
  ).toThrow();
  expect(() =>
    decodeDays({
      ...place,
      from: "2025-01-01",
      to: "2026-10-09",
    }),
  ).toThrow();
  expect(PEER_METRICS_BUCKETS).toHaveLength(21);
});
it("keeps bounded worst-case exports and summaries inside the wire budgets", () => {
  const big = {
    counters: Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [`x.${"n".repeat(40)}.${i}`, 1e12]),
    ),
    durations: Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`hist.${"n".repeat(38)}.${i}`, Array(21).fill(1e12)]),
    ),
    tasks: Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [
        `t_${i.toString(16).padStart(12, "0")}`,
        { in: 1e12, out: 1e12, cached: 1e12, turns: 1e12, partial: 1e12 },
      ]),
    ),
  };
  const result = {
    ...place,
    from: "2025-10-09",
    to: "2026-10-09",
    rows: Array.from({ length: 366 }, () => big),
  };
  expect(JSON.stringify(encodeDays(result)).length).toBeLessThan(6 * 1024 * 1024);
  expect(
    JSON.stringify(
      encodeSummary({
        ...place,
        window: 90,
        dayEnding: "2026-10-09",
        current: big,
        previous: big,
      }),
    ).length,
  ).toBeLessThan(40 * 1024);
});
