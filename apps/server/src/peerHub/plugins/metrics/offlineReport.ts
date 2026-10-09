import { PEER_METRICS_BUCKETS } from "@t3tools/contracts";
import { ADAPTERS, dedupe, foldEvent, init } from "./vocabulary.ts";
/** The supplied local records use the same fold as live collection; offline runs join projects. */
export function coordinationMetrics(samples: ReadonlyArray<Readonly<Record<string, unknown>>>) {
  const row = init(),
    seen = dedupe(),
    deliveries = new Set<string>();
  for (const e of samples) {
    if (e.event === "delivery.prepared" || e.event === "delivery.verified") {
      if (typeof e.chars !== "number") continue;
      const id = JSON.stringify([e.event, e.session, e.runtimeGeneration, e.id]);
      if (deliveries.has(id)) continue;
      deliveries.add(id);
    }
    foldEvent(
      row,
      { ...e, workspace: "offline", project: "offline", adapter: e.adapter ?? "claude_hooks" },
      seen,
    );
  }
  const n = (key: string) => row.counters[key] ?? 0,
    adapters = (key: string) => ADAPTERS.reduce((total, a) => total + n(`${key}.${a}`), 0),
    intent = PEER_METRICS_BUCKETS.map((_, i) =>
      ADAPTERS.reduce((total, a) => total + (row.durations[`intent_ms.${a}`]?.[i] ?? 0), 0),
    );
  const percentile = (q: number) => {
    const total = intent.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let cumulative = 0;
    for (let i = 0; i < intent.length; i++) {
      cumulative += intent[i]!;
      if (cumulative >= Math.ceil(total * q)) return PEER_METRICS_BUCKETS[i] ?? "over 14 days";
    }
    return null;
  };
  return {
    hookContext: {
      chars: adapters("hook.chars"),
      tokenEstimate: Math.ceil(adapters("hook.chars") / 4),
      estimateMethod: "chars/4",
      receipt: "unknown for settings hooks",
    },
    modDelivery: {
      prepared: n("delivery.prepared"),
      verified: n("delivery.verified"),
      pending: Math.max(0, n("delivery.prepared") - n("delivery.verified")),
      confirmedChars: n("delivery.verified_chars"),
    },
    intent: {
      count: adapters("intents.decided"),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      fallbackEvents: adapters("intents.unverified"),
    },
    handoffsBlocked:
      n("stale.held.publish") +
      n("stale.held.review") +
      n("stale.held.done") +
      n("stale.unverified"),
    findings: {
      noticePrepared: n("findings.prepared"),
      explicitlyRequested: n("findings.requested"),
      evidence: "host preparation and explicit request; not proof of model use",
    },
    provider: {
      usageSamples: n("provider.requests"),
      inputTokens: n("provider.input_tokens"),
      outputTokens: n("provider.output_tokens"),
      source: "provider-reported request usage; includes cache input",
    },
    findingUse: "unknown; task outcome evaluation required",
  };
}
