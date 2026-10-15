import { expect, it } from "vite-plus/test";
import type { PeerMetricsSummary, PeerMetricsRow, PeerMetricsDays } from "@t3tools/contracts";
import {
  csvCell,
  metricsExport,
  metricsUnavailable,
  metricsView,
  percentile,
  windowChange,
} from "./metrics.ts";
const empty = (): PeerMetricsRow => ({ counters: {}, durations: {}, tasks: {} });
const summary = (
  current: PeerMetricsRow = empty(),
  previous = empty(),
  extra: Partial<PeerMetricsSummary> = {},
): PeerMetricsSummary => ({
  workspace: "acme",
  project: "pay",
  scope: "environment",
  window: 28,
  current,
  previous,
  dayEnding: "2026-10-09",
  computedAt: "2026-10-09T12:00:00Z",
  team: { state: "unknown", reason: "Peer Hub has not been reached." },
  ...extra,
});
const card = (s: PeerMetricsSummary, id: string) => metricsView(s).cards.find((c) => c.id === id)!;
it("distinguishes missing bases from measured zero and states each source's coverage", () => {
  expect(card(summary(), "pr").value).toBeNull();
  expect(card(summary({ ...empty(), counters: { "pr.checked": 1 } }), "pr").value).toBe(0);
  const hooks = summary({
    ...empty(),
    counters: { "hook.events.codex_hooks": 1, "hook.chars.codex_hooks": 80 },
  });
  expect(card(hooks, "offered").value).toBe(20);
  expect(card(hooks, "verified").value).toBeNull();
  expect(card(hooks, "provider").value).toBeNull();
  expect(card(hooks, "ratio").value).toBeNull();
  expect(
    card(
      summary({ ...empty(), counters: { "provider.requests": 1, "provider.input_tokens": 20 } }),
      "ratio",
    ).value,
  ).toBeNull();
  const measured = summary({
    ...empty(),
    counters: {
      "delivery.prepared": 1,
      "delivery.verified_chars": 80,
      "provider.requests": 1,
      "provider.input_tokens": 100,
    },
  });
  expect(card(measured, "ratio").value).toBe(0.2);
  expect(card(measured, "provider").covers).toBe("Claude Mod only");
  expect(card(summary({ ...empty(), counters: { "stale.held.review": 2 } }), "stale").value).toBe(
    2,
  );
  expect(
    card(
      summary({ ...empty(), counters: { "overlaps.measured": 0 } }, empty(), {
        scope: "team",
        team: { state: "on", reason: "Enabled" },
      }),
      "overlap",
    ).value,
  ).toBe(0);
  expect(
    card(summary({ ...empty(), counters: { "hub.no_intent": 1 } }), "coverage").reason,
  ).toContain("does not support edit");
  expect(
    metricsView(summary(), { coordinationEnabled: false }).cards.find((c) => c.id === "verified")
      ?.value,
  ).toBeNull();
});
it("computes coverage per adapter, upper-bound percentiles and honest window changes", () => {
  const row = {
    ...empty(),
    counters: {
      "intents.decided.claude_mod": 3,
      "intents.unverified.claude_mod": 1,
      "intents.decided.codex_hooks": 2,
      "intents.unverified.codex_hooks": 2,
    },
    durations: {
      "intent_ms.claude_mod": Array.from({ length: 21 }, (_, i) => (i === 3 ? 3 : i === 4 ? 1 : 0)),
    },
  };
  const view = metricsView(
    summary(row, { ...empty(), counters: { "intents.decided.claude_mod": 2 } }),
  );
  expect(view.cards.find((c) => c.id === "coverage")).toMatchObject({
    value: 5 / 8,
    previous: 1,
    change: -3 / 8,
  });
  expect(view.adapters.map((a) => a.coverage)).toEqual([0.75, null, 0.5]);
  expect(view.p50).toBe(50);
  expect(view.cards.find((c) => c.id === "latency")?.value).toBe(100);
  expect(
    percentile(
      Array.from({ length: 21 }, (_, i) => (i === 20 ? 1 : 0)),
      0.95,
    ),
  ).toBe("over 14 days");
  expect(windowChange(0, null)).toBeNull();
  expect(windowChange(0, 1)).toBe(-1);
  expect(view.cards.find((c) => c.id === "coverage")?.definition).toContain(
    "late Hub answer may count twice",
  );
  expect(view.cards.find((c) => c.id === "done")?.definition).toContain(
    "within one sweep interval counts as done directly",
  );
  expect(view.cards.find((c) => c.id === "pr")?.definition).toContain("once on each");
});
it("keeps Team failure reasons specific and withholds small device sums while showing Hub outcomes", () => {
  for (const [state, reason] of [
    ["off", "Not enabled"],
    ["unsupported", "Older Hub"],
    ["unknown", "Unreachable"],
  ] as const)
    expect(
      card(summary(empty(), empty(), { scope: "team", team: { state, reason } }), "coverage")
        .reason,
    ).toBe(reason);
  const small = summary({ ...empty(), computers: 2, counters: { "tasks.measured": 0 } }, empty(), {
    scope: "team",
    team: { state: "on", reason: "Enabled" },
  });
  expect(card(small, "coverage").reason).toContain("below three");
  expect(card(small, "done").reason).not.toContain("below three");
  expect(card(summary(), "offered").value).toBeNull();
  expect(metricsUnavailable(Error("Unknown method peer.metrics.summary"))).toBe(
    "Metrics are unavailable on this environment.",
  );
});
it("exports long CSV, guarded task labels and scoped JSON without inventing measurements", () => {
  const days: PeerMetricsDays = {
    workspace: "acme",
    project: "pay",
    scope: "environment",
    from: "2026-10-09",
    to: "2026-10-09",
    computedAt: "2026-10-09T12:00:00Z",
    team: { state: "unknown", reason: "Not reached" },
    rows: [
      {
        ...empty(),
        day: "2026-10-09",
        counters: { "pr.checked": 1, "x.forecast.confirmed": 2 },
        durations: { "intent_ms.claude_mod": Array(21).fill(1) },
        tasks: {
          t_ae9c96b09dfc: { in: 10, out: 2, cached: 3, turns: 1, partial: 0 },
          t_000000000000: { in: 1, out: 0, cached: 0, turns: 1, partial: 1 },
        },
      },
    ],
  };
  const result = metricsExport(days, "ana-laptop", [
    { id: "krk-1", key: "-2+3", title: '=HYPERLINK("http://x","y")' },
  ]);
  expect(result.csv.split("\r\n").filter((s) => s.includes(",intent_ms.claude_mod,"))).toHaveLength(
    21,
  );
  expect(result.csv).toContain(",intents.decided.claude_mod,,,");
  expect(result.csv).toContain(",pr.conflicting,0,,");
  expect(result.csv).toContain(",x.forecast.confirmed,2,,");
  expect(result.tasksCsv).toContain("'-2+3");
  expect(result.tasksCsv).toContain("'=HYPERLINK");
  expect(result.tasksCsv).toContain("t_000000000000");
  const parsed = JSON.parse(result.json);
  expect(parsed.scope).toBe("environment");
  expect(parsed.bucketEdgesMs).toHaveLength(21);
  expect(parsed.coverage["x.forecast.confirmed"]).toBeTruthy();
  expect(parsed.taskRows[0].some((r: { title: string }) => r.title.startsWith("=HYPERLINK"))).toBe(
    true,
  );
  expect(csvCell("\tformula")).toBe("'\tformula");
  expect(csvCell('hello,"world"\n')).toBe('"hello,""world""\n"');
  expect(() => metricsExport({ ...days, from: "2025-01-01" }, "ana")).toThrow();
});
it("never tells a person to choose Team when Team cannot be chosen", () => {
  const hubCards = (s: PeerMetricsSummary) =>
    metricsView(s).cards.filter((c) => ["overlap", "resolve", "review", "done"].includes(c.id));
  // Team is off, so the Hub's outcomes are not measured for this computer, and the reason is the Hub's.
  for (const state of ["off", "unsupported", "unknown"] as const) {
    const cards = hubCards(
      summary(empty(), empty(), { team: { state, reason: `team is ${state}` } }),
    );
    expect(cards.map((c) => c.reason)).toEqual(Array(4).fill(`team is ${state}`));
    expect(JSON.stringify(cards)).not.toContain("Choose Team");
  }
  // Where Team is on but not chosen, choosing it is the way to the Hub's outcomes.
  const on = { state: "on" as const, reason: "Enabled" };
  for (const id of ["overlap", "resolve", "review", "done"])
    expect(card(summary(empty(), empty(), { team: on }), id).reason).toBe(
      "Choose Team to read Hub outcomes.",
    );
  // Only a chosen Team that is on can say what the Hub did not observe, and says it for each outcome.
  // Where one outcome has values, its neighbours do not claim the Hub measured nothing.
  const chosen = summary(
    { ...empty(), counters: { "overlaps.measured": 0, "tasks.measured": 0, "tasks.reviewed": 2 } },
    empty(),
    {
      scope: "team",
      team: on,
    },
  );
  expect(card(chosen, "resolve").reason).toBe(
    "No overlap resolution has a measured opening in this range.",
  );
  expect(card(chosen, "review").reason).toBe("No task was observed reaching review in this range.");
  expect(card(chosen, "done").reason).toBe(
    "No task was observed going from review to done in this range.",
  );
  expect(JSON.stringify(metricsView(chosen).cards)).not.toContain("no measured outcomes");
});
