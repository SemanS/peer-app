import {
  PEER_METRICS_BUCKETS,
  type PeerMetricsRow,
  type PeerMetricsTaskRow,
} from "@t3tools/contracts";
export const ADAPTERS = ["claude_mod", "claude_hooks", "codex_hooks"] as const;
export const KNOWN_COUNTERS = [
  ...ADAPTERS.flatMap((a) =>
    [
      "intents.decided",
      "intents.contested",
      "intents.unverified",
      "hook.events",
      "hook.chars",
      "hook.late",
      "hook.stale",
    ].map((n) => `${n}.${a}`),
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
] as const;
export const validName = (n: string) => /^[a-z][a-z0-9_.-]{0,47}$/.test(n);
export type MutableRow = {
  counters: Record<string, number>;
  durations: Record<string, number[]>;
  tasks: Record<string, PeerMetricsTaskRow>;
  incomplete?: boolean;
};
export const init = (): MutableRow => ({
  counters: Object.create(null) as MutableRow["counters"],
  durations: Object.create(null) as MutableRow["durations"],
  tasks: Object.create(null) as MutableRow["tasks"],
});
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
export const plus = (a: number, b: number) => Math.min(1e12, a + b);
export const add = (r: MutableRow, name: string, n = 1) => {
  if (n > 0) r.counters[name] = plus(r.counters[name] ?? 0, n);
};
export const bucket = (ms: number) => PEER_METRICS_BUCKETS.findIndex((b) => b === null || ms <= b);
export const duration = (r: MutableRow, name: string, ms: unknown) => {
  if (typeof ms !== "number" || !Number.isSafeInteger(ms) || ms < 0) return;
  const h = (r.durations[name] ??= Array<number>(21).fill(0)),
    i = bucket(ms);
  h[i] = plus(h[i]!, 1);
};
export const capTasks = (tasks: Readonly<Record<string, PeerMetricsTaskRow>>, limit = 50) => {
  const ordered = Object.entries(tasks)
    .filter(([k]) => k !== "other")
    .sort((a, b) => b[1].in + b[1].out - a[1].in - a[1].out || a[0].localeCompare(b[0]));
  const keep = ordered.length + (tasks.other ? 1 : 0) <= limit ? ordered.length : limit - 1;
  const result = Object.fromEntries(ordered.slice(0, keep));
  for (const [key, row] of [
    ...ordered.slice(keep),
    ...(tasks.other ? [["other", tasks.other] as const] : []),
  ]) {
    void key;
    const other = (result.other ??= { in: 0, out: 0, cached: 0, turns: 0, partial: 0 });
    result.other = Object.fromEntries(
      Object.keys(other).map((k) => [
        k,
        plus(other[k as keyof PeerMetricsTaskRow], row[k as keyof PeerMetricsTaskRow]),
      ]),
    ) as PeerMetricsTaskRow;
  }
  return result;
};
export const addTask = (r: MutableRow, key: string, v: PeerMetricsTaskRow) => {
  const existing = Object.keys(r.tasks).filter((k) => k !== "none" && k !== "other");
  if (key !== "none" && key !== "other" && !r.tasks[key] && existing.length >= 48) key = "other";
  const old = r.tasks[key] ?? { in: 0, out: 0, cached: 0, turns: 0, partial: 0 };
  r.tasks[key] = {
    in: plus(old.in, v.in),
    out: plus(old.out, v.out),
    cached: plus(old.cached, v.cached),
    turns: plus(old.turns, v.turns),
    partial: plus(old.partial, v.partial),
  };
};
export const sum = (rows: ReadonlyArray<PeerMetricsRow>): PeerMetricsRow => {
  const r = init();
  for (const row of rows) {
    for (const [k, n] of Object.entries(row.counters)) r.counters[k] = plus(r.counters[k] ?? 0, n);
    for (const [k, h] of Object.entries(row.durations))
      r.durations[k] = h.map((n, i) => plus(r.durations[k]?.[i] ?? 0, n));
    for (const [k, v] of Object.entries(row.tasks)) {
      const old = r.tasks[k] ?? { in: 0, out: 0, cached: 0, turns: 0, partial: 0 };
      r.tasks[k] = {
        in: plus(old.in, v.in),
        out: plus(old.out, v.out),
        cached: plus(old.cached, v.cached),
        turns: plus(old.turns, v.turns),
        partial: plus(old.partial, v.partial),
      };
    }
    if (row.incomplete) r.incomplete = true;
  }
  return { ...r, tasks: capTasks(r.tasks) };
};
export const dedupe = () => ({
  provider: new Set<string>(),
  prepared: new Set<string>(),
  requested: new Set<string>(),
});
const once = (s: Set<string>, key: string) => {
  if (s.has(key)) return false;
  if (s.size >= 20000) s.delete(s.values().next().value!);
  s.add(key);
  return true;
};
export function foldEvent(r: MutableRow, e: Readonly<Record<string, unknown>>, seen = dedupe()) {
  if (typeof e.workspace !== "string" || typeof e.project !== "string") return;
  const a = ADAPTERS.find((v) => v === e.adapter),
    event = e.event;
  if (event === "intent" && a) {
    add(r, `intents.decided.${a}`);
    duration(r, `intent_ms.${a}`, e.ms);
    const verdicts = e.verdictCounts as Record<string, unknown> | undefined;
    if (verdicts && Object.entries(verdicts).some(([k, v]) => k !== "clear" && count(v) > 0))
      add(r, `intents.contested.${a}`);
    for (const v of ["clear", "notify", "deny", "ask", "held"])
      if (verdicts) add(r, `verdicts.${v}`, count(verdicts[v]));
  } else if (event === "intent.unverified" && a && e.wentOn === true)
    add(r, `intents.unverified.${a}`);
  else if (event === "intent.legacy") add(r, "hub.no_intent");
  else if (event === "hook" && a) {
    add(r, `hook.events.${a}`);
    add(r, `hook.chars.${a}`, count(e.chars));
    duration(r, `hook_ms.${a}`, e.ms);
  } else if ((event === "hook.late" || event === "hook.stale") && a) add(r, `${event}.${a}`);
  else if (event === "delivery.prepared" || event === "delivery.verified") {
    add(r, event);
    add(r, `${event}_chars`, count(e.chars));
  } else if (
    event === "provider.usage" &&
    once(
      seen.provider,
      JSON.stringify([e.session, e.runtimeGeneration, e.agentId, e.turnId, e.index]),
    )
  ) {
    add(r, "provider.requests");
    add(
      r,
      "provider.input_tokens",
      count(e.inputTokens) + count(e.cacheReadTokens) + count(e.cacheWriteTokens),
    );
    add(r, "provider.output_tokens", count(e.outputTokens));
  } else if (event === "finding.prepared" || event === "finding.requested") {
    const kind = event === "finding.prepared" ? "prepared" : "requested";
    for (const id of Array.isArray(e.findings) ? e.findings : [])
      if (
        typeof id === "string" &&
        once(seen[kind], JSON.stringify([e.session, e.runtimeGeneration, id]))
      )
        add(r, `findings.${kind}`);
  } else if (event === "handoff.stale") {
    if (["publish", "review", "done"].includes(String(e.at))) add(r, `stale.held.${e.at}`);
  } else if (event === "handoff.unverified") add(r, "stale.unverified");
  else if (event === "handoff.refused")
    add(r, e.refusal === "stale_context" ? "refused.stale" : "refused.other");
  else if (typeof event === "string" && /^[a-z][a-z0-9-]*\.metric$/.test(event)) {
    const name = `x.${event.slice(0, -7)}.${e.name}`;
    if (!validName(name)) throw Error("invalid metric name");
    if (
      r.counters[name] !== undefined ||
      Object.keys(r.counters).filter((k) => k.startsWith("x.")).length < 20
    )
      add(r, name, count(e.n));
  }
}
