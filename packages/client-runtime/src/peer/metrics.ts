import {
  PEER_METRICS_BUCKETS,
  WS_METHODS,
  metricsDayCount,
  type PeerMetricsRow,
  type PeerMetricsSummary,
  type PeerMetricsDays,
  type PeerTask,
} from "@t3tools/contracts";
import { taskRef } from "@t3tools/shared/peerRef";
import type { Atom } from "effect/unstable/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export const ADAPTERS = ["claude_mod", "claude_hooks", "codex_hooks"] as const;
const agentName = {
  claude_mod: "Claude Mod",
  claude_hooks: "Claude settings hooks",
  codex_hooks: "Codex settings hooks",
};
const adapterTotal = (row: PeerMetricsRow, name: string) =>
  ADAPTERS.reduce((n, a) => n + (row.counters[`${name}.${a}`] ?? 0), 0);
const has = (row: PeerMetricsRow, key: string) => Object.hasOwn(row.counters, key);
const hasAdapter = (row: PeerMetricsRow, key: string) =>
  ADAPTERS.some((a) => has(row, `${key}.${a}`));
export function percentile(
  histogram: ReadonlyArray<number> | undefined,
  rank: number,
): number | "over 14 days" | null {
  const total = histogram?.reduce((a, b) => a + b, 0) ?? 0;
  if (!histogram || !total) return null;
  let count = 0;
  for (let i = 0; i < histogram.length; i++) {
    count += histogram[i]!;
    if (count >= Math.ceil(total * rank)) return PEER_METRICS_BUCKETS[i] ?? "over 14 days";
  }
  return null;
}
const mergedHistogram = (row: PeerMetricsRow, name: string) =>
  PEER_METRICS_BUCKETS.map((_, i) =>
    ADAPTERS.reduce((n, a) => n + (row.durations[`${name}.${a}`]?.[i] ?? 0), 0),
  );
export const windowChange = (current: number | null, previous: number | null) =>
  current === null || previous === null ? null : current - previous;
type MetricValue = number | "over 14 days" | null;
export interface MetricCard {
  id: string;
  title: string;
  value: MetricValue;
  previous: MetricValue;
  change: number | null;
  unit: string;
  reason: string | null;
  definition: string;
  source: string;
  covers: string;
  excludes: string;
}
const HOOKS = "Claude Mod, Claude settings hooks and Codex settings hooks";
const EXCLUDED =
  "Cursor, Grok, OpenCode and Antigravity do not provide Peer hook counters. Shared-capacity usage can include them.";
export const metricDefinitions = {
  coverage:
    "Decided edits / (decided edits + edits that went on without a verdict). A late Hub answer may count twice after a hook deadline.",
  latency: "Nearest-rank histogram percentiles are upper bounds, shown as at most the bucket edge.",
  offered:
    "Characters offered by settings hooks, about characters / 4 tokens. This estimate is not proof of model delivery or use.",
  verified:
    "Characters confirmed by Claude Mod model-input receipts, about characters / 4 tokens. Settings hooks have no equivalent receipt.",
  ratio:
    "Confirmed coordination character estimate / provider-reported input tokens, including cache reads and writes. Both must have measurements.",
  stale:
    "Publish, review or done held by a stale shared-context check. Unverified checks and Hub refusals are counted separately.",
  provider:
    "Provider-reported input tokens including cache reads and writes. These are Claude Mod request totals; hook character estimates have a different basis.",
  resolve:
    "Time between a measured overlap opening and its resolution, from the Hub ledger. Openings before metrics were enabled have no measured age.",
  overlap:
    "The Hub classifies openings as before an edit when an edit operation is recorded; otherwise after an edit. Task questions are excluded.",
  review:
    "Time from first agent activity on a task to its first observed review transition. An hourly sweep observes the task's timestamps; edits can move them later.",
  done: "Time from first observed review to done. A task reviewed and finished within one sweep interval counts as done directly, so it has no measured review-to-done time.",
  pr: "Open linked pull requests with known mergeability, counted once on each computer. A pull request linked on two computers counts once on each.",
  task: "Provider-reported main-agent tokens on shared capacity, attributed to the thread's assigned task. Personal capacity is excluded; subagents or incomplete reports mark partial totals. Tokens are not money.",
} as const;
export function metricsView(
  summary: PeerMetricsSummary,
  options: { coordinationEnabled?: boolean } = {},
) {
  const { current, previous } = summary,
    withheld =
      summary.scope === "team" && summary.team.state === "on" && (current.computers ?? 0) < 3;
  const deviceReason = withheld
    ? "Device sums are withheld below three contributing computers."
    : options.coordinationEnabled === false
      ? "Coordination is off on this environment."
      : "No supported hook measurements in this range. Coordination may be off or only other agents ran.";
  const rowCoverage = (r: PeerMetricsRow) => {
    const d = adapterTotal(r, "intents.decided"),
      u = adapterTotal(r, "intents.unverified");
    return d + u > 0 ? d / (d + u) : null;
  };
  const basis = (r: PeerMetricsRow, group: string) =>
    group === "edits"
      ? rowCoverage(r) !== null
      : group === "hooks"
        ? hasAdapter(r, "hook.events")
        : group === "stale"
          ? Object.keys(r.counters).some(
              (k) => k.startsWith("stale.") || k.startsWith("refused."),
            ) || rowCoverage(r) !== null
          : group === "task"
            ? Object.values(r.tasks).some((t) => t.turns > 0)
            : has(r, group);
  const make = (
    id: keyof typeof metricDefinitions,
    title: string,
    group: string,
    value: (r: PeerMetricsRow) => MetricValue,
    unit: string,
    source: string,
    covers = HOOKS,
    reason = deviceReason,
  ): MetricCard => {
    const a = basis(current, group) ? value(current) : null,
      b = basis(previous, group) ? value(previous) : null;
    return {
      id,
      title,
      value: a,
      previous: b,
      change: typeof a === "number" && typeof b === "number" ? windowChange(a, b) : null,
      unit,
      reason:
        a === null
          ? summary.scope === "team" && summary.team.state !== "on"
            ? summary.team.reason
            : withheld && source !== "Hub"
              ? deviceReason
              : options.coordinationEnabled === false &&
                  summary.scope === "environment" &&
                  ["edits", "hooks", "delivery.prepared", "provider.requests"].includes(group)
                ? deviceReason
                : reason
          : null,
      definition: metricDefinitions[id],
      source,
      covers,
      excludes:
        source === "Hub"
          ? "The Hub sees all reported agents; work not reported to Peer is excluded."
          : group === "task"
            ? "Personal capacity and unavailable subagent usage are excluded."
            : group === "pr.checked"
              ? "Closed links, unknown mergeability and threads without assigned tasks are excluded."
              : EXCLUDED,
    };
  };
  // Hub outcomes come from the team. Where Team cannot be chosen the reason is why, not an invitation
  // to choose it.
  // Only a Team that is on and chosen can say that the Hub measured nothing of a kind in the range.
  const chosenTeam = summary.team.state === "on" && summary.scope === "team";
  const hubReason =
    summary.team.state !== "on"
      ? summary.team.reason
      : summary.scope !== "team"
        ? "Choose Team to read Hub outcomes."
        : "The Hub has no measured outcomes in this range.";
  const cards = [
    make(
      "coverage",
      "Edit coverage",
      "edits",
      rowCoverage,
      "ratio",
      "This computer's Peer decision protocol",
      HOOKS,
      has(current, "hub.no_intent")
        ? "This Hub does not support edit decisions."
        : withheld
          ? deviceReason
          : "No edits were measured in this range.",
    ),
    make(
      "latency",
      "Edit-decision latency (p95)",
      "edits",
      (r) => percentile(mergedHistogram(r, "intent_ms"), 0.95),
      "ms-upper",
      "This computer's Peer decision protocol",
    ),
    make(
      "offered",
      "Hook context estimate",
      "hooks",
      (r) => Math.ceil(adapterTotal(r, "hook.chars") / 4),
      "tokens-estimate",
      "Settings-hook characters",
    ),
    make(
      "verified",
      "Confirmed coordination estimate",
      "delivery.prepared",
      (r) => Math.ceil((r.counters["delivery.verified_chars"] ?? 0) / 4),
      "tokens-estimate",
      "Claude Mod model-input receipt",
      "Claude Mod only",
      withheld
        ? deviceReason
        : "No Claude Mod preparations; settings hooks have no delivery receipts.",
    ),
    make(
      "ratio",
      "Confirmed estimate / provider input",
      "provider.requests",
      (r) =>
        has(r, "delivery.prepared") && (r.counters["provider.input_tokens"] ?? 0) > 0
          ? Math.ceil((r.counters["delivery.verified_chars"] ?? 0) / 4) /
            r.counters["provider.input_tokens"]!
          : null,
      "ratio",
      "Claude Mod receipt and provider usage",
      "Claude Mod only",
      "Both Mod receipts and provider input must be measured. Codex hooks do not report provider tokens.",
    ),
    make(
      "stale",
      "Stale handoffs held",
      "stale",
      (r) =>
        ["publish", "review", "done"].reduce(
          (n, at) => n + (r.counters[`stale.held.${at}`] ?? 0),
          0,
        ),
      "count",
      "This computer's handoff checks",
    ),
    make(
      "overlap",
      "Overlaps found after an edit",
      "overlaps.measured",
      (r) => r.counters["overlaps.after_edit"] ?? 0,
      "count",
      "Hub",
      "All reported agents",
      hubReason,
    ),
    make(
      "resolve",
      "Time to resolve an overlap (p50)",
      "overlaps.measured",
      (r) => percentile(r.durations.overlap_resolve_ms, 0.5),
      "ms-upper",
      "Hub",
      "All reported agents",
      chosenTeam ? "No overlap resolution has a measured opening in this range." : hubReason,
    ),
    make(
      "provider",
      "Provider input tokens",
      "provider.requests",
      (r) => r.counters["provider.input_tokens"] ?? 0,
      "tokens",
      "Claude Mod provider reports",
      "Claude Mod only",
      "No Claude Mod provider usage reports; Codex hooks do not report provider tokens.",
    ),
    make(
      "task",
      "Shared-capacity task tokens",
      "task",
      (r) => Object.values(r.tasks).reduce((n, t) => n + t.in + t.out, 0),
      "tokens",
      "This environment’s completed provider turns",
      "All shared-capacity agents",
      withheld ? deviceReason : "No shared-capacity turns have been measured in this range.",
    ),
    make(
      "review",
      "Time to review (p50)",
      "tasks.measured",
      (r) => percentile(r.durations.task_to_review_ms, 0.5),
      "ms-upper",
      "Hub",
      "All reported agents",
      chosenTeam ? "No task was observed reaching review in this range." : hubReason,
    ),
    make(
      "done",
      "Review to done (p50)",
      "tasks.measured",
      (r) => percentile(r.durations.task_review_to_done_ms, 0.5),
      "ms-upper",
      "Hub",
      "All reported agents",
      chosenTeam ? "No task was observed going from review to done in this range." : hubReason,
    ),
    make(
      "pr",
      "Conflicting pull requests",
      "pr.checked",
      (r) => r.counters["pr.conflicting"] ?? 0,
      "count",
      "This computer's PR snapshots",
      "All agents with assigned task threads",
      withheld
        ? deviceReason
        : "No open linked pull requests with known mergeability in this range.",
    ),
  ];
  const providerMeasured = has(current, "provider.requests"),
    p50 = percentile(mergedHistogram(current, "intent_ms"), 0.5),
    resolve = percentile(current.durations.overlap_resolve_ms, 0.5);
  return {
    cards,
    p50,
    resolve,
    providerInput: providerMeasured ? (current.counters["provider.input_tokens"] ?? 0) : null,
    providerReason: providerMeasured
      ? null
      : "No Claude Mod provider usage reports; Codex hooks do not report provider tokens.",
    doneDirect: has(current, "tasks.measured")
      ? (current.counters["tasks.done_direct"] ?? 0)
      : null,
    adapters: ADAPTERS.map((a) => {
      const d = current.counters[`intents.decided.${a}`] ?? 0,
        u = current.counters[`intents.unverified.${a}`] ?? 0;
      return {
        adapter: a,
        label: agentName[a],
        decided: d,
        wentOn: u,
        coverage: d + u > 0 ? d / (d + u) : null,
      };
    }),
  };
}
export const formatMetric = (value: MetricValue, unit = "count") =>
  value === null
    ? "Not measured"
    : typeof value === "string"
      ? value
      : unit === "ratio"
        ? `${(value * 100).toFixed(1)}%`
        : unit === "ms-upper"
          ? `at most ${value < 1000 ? `${value} ms` : value < 60000 ? `${value / 1000} s` : value < 3600000 ? `${value / 60000} min` : `${(value / 3600000).toFixed(1)} h`}`
          : value.toLocaleString("en-US");
export function taskTokenRows(
  row: PeerMetricsRow,
  tasks: ReadonlyArray<Pick<PeerTask, "id" | "key" | "title">>,
) {
  const names = new Map(tasks.map((t) => [taskRef(t.id), t]));
  return Object.entries(row.tasks)
    .map(([ref, tokens]) => {
      const task = names.get(ref);
      return {
        ref,
        key: task?.key ?? "",
        title: task?.title ?? (ref === "none" ? "No task" : ref === "other" ? "Other tasks" : ref),
        ...tokens,
      };
    })
    .sort((a, b) => b.in + b.out - a.in - a.out || a.ref.localeCompare(b.ref));
}
export const csvCell = (value: string | number | null | undefined) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[,"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const coversOf = (metric: string) =>
  metric.endsWith(".claude_mod")
    ? "Claude Mod"
    : metric.endsWith(".claude_hooks")
      ? "Claude settings hooks"
      : metric.endsWith(".codex_hooks")
        ? "Codex settings hooks"
        : metric.startsWith("delivery.") || metric.startsWith("provider.")
          ? "Claude Mod"
          : metric.startsWith("overlaps.") ||
              metric.startsWith("tasks.") ||
              metric.startsWith("task_") ||
              metric === "overlap_resolve_ms"
            ? "All Hub-reported agents"
            : HOOKS;
const groupOf = (metric: string) =>
  metric.startsWith("intents.") ||
  metric.startsWith("verdicts.") ||
  metric.startsWith("intent_ms.") ||
  metric.startsWith("stale.") ||
  metric.startsWith("refused.")
    ? "edits"
    : metric.startsWith("hook.") || metric.startsWith("hook_ms.")
      ? "hooks"
      : metric.startsWith("delivery.")
        ? "delivery.prepared"
        : metric.startsWith("provider.")
          ? "provider.requests"
          : metric.startsWith("pr.")
            ? "pr.checked"
            : metric.startsWith("overlaps.") || metric === "overlap_resolve_ms"
              ? "overlaps.measured"
              : metric.startsWith("tasks.") || metric.startsWith("task_")
                ? "tasks.measured"
                : null;
const measured = (row: PeerMetricsRow, metric: string) => {
  if (has(row, metric)) return true;
  const group = groupOf(metric),
    adapter = ADAPTERS.find((a) => metric.endsWith(`.${a}`));
  if (adapter && group === "edits")
    return (
      (row.counters[`intents.decided.${adapter}`] ?? 0) +
        (row.counters[`intents.unverified.${adapter}`] ?? 0) >
      0
    );
  if (adapter && group === "hooks") return has(row, `hook.events.${adapter}`);
  return group === "edits"
    ? hasAdapter(row, "intents.decided") || hasAdapter(row, "intents.unverified")
    : group === "hooks"
      ? hasAdapter(row, "hook.events")
      : group
        ? has(row, group)
        : has(row, metric);
};
const counterNames = [
  ...ADAPTERS.flatMap((a) =>
    [
      "intents.decided",
      "intents.contested",
      "intents.unverified",
      "hook.events",
      "hook.chars",
      "hook.late",
      "hook.stale",
    ].map((k) => `${k}.${a}`),
  ),
  ...["clear", "notify", "deny", "ask", "held"].map((v) => `verdicts.${v}`),
  "hub.no_intent",
  "delivery.prepared",
  "delivery.prepared_chars",
  "delivery.verified",
  "delivery.verified_chars",
  "provider.requests",
  "provider.input_tokens",
  "provider.output_tokens",
  "findings.prepared",
  "findings.requested",
  "stale.held.publish",
  "stale.held.review",
  "stale.held.done",
  "stale.unverified",
  "refused.stale",
  "refused.other",
  "pr.checked",
  "pr.conflicting",
  "overlaps.before_edit",
  "overlaps.after_edit",
  "overlaps.resolved",
  "overlaps.measured",
  "tasks.reviewed",
  "tasks.done",
  "tasks.done_direct",
  "tasks.measured",
];
const durationNames = [
  ...ADAPTERS.flatMap((a) => [`intent_ms.${a}`, `hook_ms.${a}`]),
  "overlap_resolve_ms",
  "task_to_review_ms",
  "task_review_to_done_ms",
];
export function metricsExport(
  days: PeerMetricsDays,
  environment: string,
  tasks: ReadonlyArray<Pick<PeerTask, "id" | "key" | "title">> = [],
) {
  if (
    metricsDayCount(days.from, days.to) < 1 ||
    metricsDayCount(days.from, days.to) > 366 ||
    !Number.isFinite(metricsDayCount(days.from, days.to)) ||
    days.rows.length > 366
  )
    throw Error("Choose a range of 1 to 366 UTC days.");
  const csv: (string | number | null)[][] = [
      [
        "scope",
        "environment",
        "workspace",
        "project",
        "day",
        "metric",
        "value",
        "bucket_le_ms",
        "covers",
      ],
    ],
    taskCsv: (string | number)[][] = [
      [
        "scope",
        "environment",
        "workspace",
        "project",
        "day",
        "reference",
        "key",
        "title",
        "in",
        "out",
        "cached",
        "turns",
        "partial",
      ],
    ],
    taskRows: ReturnType<typeof taskTokenRows>[] = [],
    coverage: Record<string, string> = {};
  for (const row of days.rows) {
    const base = [
      days.scope,
      days.scope === "environment" ? environment : "",
      days.workspace,
      days.project,
      row.day ?? "",
    ];
    for (const name of new Set([...counterNames, ...Object.keys(row.counters)])) {
      coverage[name] = coversOf(name);
      csv.push([
        ...base,
        name,
        measured(row, name) ? (row.counters[name] ?? 0) : null,
        null,
        coverage[name]!,
      ]);
    }
    for (const name of new Set([...durationNames, ...Object.keys(row.durations)])) {
      coverage[name] = coversOf(name);
      PEER_METRICS_BUCKETS.forEach((edge, i) =>
        csv.push([
          ...base,
          name,
          measured(row, name) ? (row.durations[name]?.[i] ?? 0) : null,
          edge === null ? "overflow" : edge,
          coverage[name]!,
        ]),
      );
    }
    const joined = taskTokenRows(row, tasks);
    taskRows.push(joined);
    for (const task of joined)
      taskCsv.push([
        ...base,
        task.ref,
        task.key,
        task.title,
        task.in,
        task.out,
        task.cached,
        task.turns,
        task.partial,
      ]);
  }
  return {
    csv: csv.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n",
    tasksCsv: taskCsv.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n",
    json: JSON.stringify(
      {
        ...days,
        environment: days.scope === "environment" ? environment : undefined,
        bucketEdgesMs: PEER_METRICS_BUCKETS,
        taskRows,
        coverage,
      },
      null,
      2,
    ),
  };
}
export const metricsUnavailable = (error: unknown) =>
  /unknown.*method|method.*unknown|unhandled|not implemented|not available|inactive/i.test(
    String(error),
  )
    ? "Metrics are unavailable on this environment."
    : error instanceof Error
      ? error.message
      : String(error);
export function createPeerMetricsAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerMetricsSummary: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "peer:metrics:summary",
      tag: WS_METHODS.peerMetricsSummary,
      staleTimeMs: 30000,
    }),
    peerMetricsDays: createEnvironmentRpcCommand(runtime, {
      label: "peer:metrics:days",
      tag: WS_METHODS.peerMetricsDays,
    }),
    peerMetricsConfigure: createEnvironmentRpcCommand(runtime, {
      label: "peer:metrics:configure",
      tag: WS_METHODS.peerMetricsConfigure,
    }),
  };
}
