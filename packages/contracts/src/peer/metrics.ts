import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
export const PEER_METRICS_BUCKETS = [
  5,
  10,
  25,
  50,
  100,
  250,
  500,
  1000,
  2500,
  5000,
  15000,
  60000,
  300000,
  900000,
  3600000,
  14400000,
  86400000,
  259200000,
  604800000,
  1209600000,
  null,
] as const;
const count = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const validNames = Schema.makeFilter((v: Readonly<Record<string, unknown>>) =>
  Object.keys(v).every((k) => /^[a-z][a-z0-9_.-]{0,47}$/.test(k)),
);
const day = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((v) => {
    const date = Date.parse(`${v}T00:00:00Z`);
    return (
      Number.isFinite(date) && DateTime.formatIso(DateTime.makeUnsafe(date)).slice(0, 10) === v
    );
  }),
);
export const PeerMetricsTaskRow = Schema.Struct({
  in: count,
  out: count,
  cached: count,
  turns: count,
  partial: count,
});
export type PeerMetricsTaskRow = typeof PeerMetricsTaskRow.Type;
export const PeerMetricsRow = Schema.Struct({
  day: Schema.optional(day),
  computers: Schema.optional(count),
  incomplete: Schema.optional(Schema.Boolean),
  deviceWithheld: Schema.optional(Schema.Literal("below-three-computers")),
  counters: Schema.Record(Schema.String, count).check(validNames),
  durations: Schema.Record(
    Schema.String,
    Schema.Array(count).check(Schema.isMinLength(21), Schema.isMaxLength(21)),
  ).check(validNames),
  tasks: Schema.Record(Schema.String, PeerMetricsTaskRow).check(
    Schema.makeFilter((v) => Object.keys(v).every((k) => /^(t_[a-f0-9]{12}|none|other)$/.test(k))),
  ),
});
export type PeerMetricsRow = typeof PeerMetricsRow.Type;
export const PeerMetricsScope = Schema.Literals(["environment", "team"]);
export const PeerMetricsTeam = Schema.Struct({
  state: Schema.Literals(["on", "off", "unsupported", "unknown"]),
  reason: Schema.String,
  epoch: Schema.optional(count),
});
export type PeerMetricsTeam = typeof PeerMetricsTeam.Type;
const place = { workspace: Schema.String, project: Schema.String };
export const PeerMetricsSummaryInput = Schema.Struct({
  ...place,
  scope: PeerMetricsScope,
  window: Schema.Literals([7, 28, 90]),
});
export type PeerMetricsSummaryInput = typeof PeerMetricsSummaryInput.Type;
export const PeerMetricsSummary = Schema.Struct({
  ...place,
  scope: PeerMetricsScope,
  window: Schema.Literals([7, 28, 90]),
  current: PeerMetricsRow,
  previous: PeerMetricsRow,
  dayEnding: day,
  computedAt: Schema.String,
  team: PeerMetricsTeam,
});
export type PeerMetricsSummary = typeof PeerMetricsSummary.Type;
export const metricsDayCount = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
export const PeerMetricsDaysInput = Schema.Struct({
  ...place,
  scope: PeerMetricsScope,
  from: day,
  to: day,
}).check(
  Schema.makeFilter(
    (v) =>
      Number.isInteger(metricsDayCount(v.from, v.to)) &&
      metricsDayCount(v.from, v.to) >= 1 &&
      metricsDayCount(v.from, v.to) <= 366,
  ),
);
export type PeerMetricsDaysInput = typeof PeerMetricsDaysInput.Type;
export const PeerMetricsDays = Schema.Struct({
  ...place,
  scope: PeerMetricsScope,
  from: day,
  to: day,
  computedAt: Schema.String,
  rows: Schema.Array(PeerMetricsRow).check(Schema.isMaxLength(366)),
  team: PeerMetricsTeam,
});
export type PeerMetricsDays = typeof PeerMetricsDays.Type;
export const PeerMetricsConfigureInput = Schema.Struct({
  workspace: Schema.optional(Schema.String),
  team: Schema.optional(Schema.Boolean),
  sharing: Schema.optional(Schema.Boolean),
  debug: Schema.optional(Schema.Literals(["on", "off", "delete"])),
  eraseLocal: Schema.optional(Schema.Boolean),
});
export type PeerMetricsConfigureInput = typeof PeerMetricsConfigureInput.Type;
export const PeerMetricsStatus = Schema.Struct({
  debug: Schema.Struct({
    on: Schema.Boolean,
    until: Schema.optional(count),
    forced: Schema.Boolean,
    path: Schema.String,
  }),
  workspaces: Schema.Array(
    Schema.Struct({
      workspace: Schema.String,
      sharing: Schema.Boolean,
      sharedSince: Schema.optional(day),
      team: PeerMetricsTeam,
      lastUpload: Schema.optional(count),
      eraseOwed: Schema.Boolean,
    }),
  ),
  scrubbed: Schema.Literal(true),
});
export type PeerMetricsStatus = typeof PeerMetricsStatus.Type;
