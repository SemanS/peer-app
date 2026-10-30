import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";
import { PeerBudgetPeriod } from "./base.ts";

/**
 * A workspace's usage page: what the Hub answers and what a computer reports to it. `null` always
 * means not measured and stays apart from `0`, so no field here defaults. Money is in USD whatever
 * the workspace's currency, since reports are estimates at list prices. `PeerUsage…` keeps these
 * apart from the local usage engine's `packages/contracts/src/usage.ts`.
 */

/** The windows a workspace's usage page offers, in UTC days. */
export const PeerUsageDays = Schema.Literals([1, 7, 30]);
export type PeerUsageDays = typeof PeerUsageDays.Type;

/** `workspace` for owners and admins; `self` for anyone else, who sees only their own rows. */
export const PeerUsageScope = Schema.Literals(["workspace", "self"]);
export type PeerUsageScope = typeof PeerUsageScope.Type;

export const PeerUsageTickets = Schema.Struct({
  total: Schema.Number,
  open: Schema.Number,
  completed: Schema.Number,
});
export type PeerUsageTickets = typeof PeerUsageTickets.Type;

export const PeerUsageImplementations = Schema.Struct({
  runs: Schema.Number,
  agents: Schema.Number,
  seconds: Schema.Number,
});
export type PeerUsageImplementations = typeof PeerUsageImplementations.Type;

/** The gateway's running total for its budget period, which is not the page's window. */
export const PeerUsageGateway = Schema.Struct({
  state: Schema.Literals(["ok", "unreachable"]),
  /** These three are absent while the gateway is unreachable. */
  spentUsd: Schema.optional(Schema.Number),
  budgetUsd: Schema.optional(Schema.Number),
  period: Schema.optional(PeerBudgetPeriod),
});
export type PeerUsageGateway = typeof PeerUsageGateway.Type;

export const PeerUsageApiSpend = Schema.Struct({
  /** Null: nothing priced was reported on shared capacity. */
  usd: Schema.NullOr(Schema.Number),
  /** Null: no project has a gateway team, or the scope is `self`. */
  gateway: Schema.NullOr(PeerUsageGateway),
});
export type PeerUsageApiSpend = typeof PeerUsageApiSpend.Type;

export const PeerUsageTokenValue = Schema.Struct({
  usd: Schema.Number,
  onPlansUsd: Schema.Number,
  /** A model without a known price left its cost out. */
  partial: Schema.Boolean,
});
export type PeerUsageTokenValue = typeof PeerUsageTokenValue.Type;

export const PeerUsageCode = Schema.Struct({
  /** Null: no merged pull request's record has line counts. */
  additions: Schema.NullOr(Schema.Number),
  deletions: Schema.NullOr(Schema.Number),
  /** Some merged pull request's record has no line counts. */
  partial: Schema.Boolean,
  pullRequestsMerged: Schema.Number,
});
export type PeerUsageCode = typeof PeerUsageCode.Type;

export const PeerUsageTokens = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cached: Schema.Number,
});
export type PeerUsageTokens = typeof PeerUsageTokens.Type;

export const PeerUsageAgentRow = Schema.Struct({
  agent: Schema.String,
  runs: Schema.Number,
  usd: Schema.NullOr(Schema.Number),
  tokens: Schema.NullOr(Schema.Number),
});
export type PeerUsageAgentRow = typeof PeerUsageAgentRow.Type;

export const PeerUsageUserRow = Schema.Struct({
  email: Schema.String,
  name: Schema.String,
  runs: Schema.Number,
  usd: Schema.NullOr(Schema.Number),
  tokens: Schema.NullOr(Schema.Number),
  sharing: Schema.Boolean,
  former: Schema.Boolean,
});
export type PeerUsageUserRow = typeof PeerUsageUserRow.Type;

export const PeerUsageCoverage = Schema.Struct({
  members: Schema.Number,
  sharing: Schema.Number,
  /** Null: nothing has been reported in the window. */
  latestReportAt: Schema.NullOr(Schema.String),
});
export type PeerUsageCoverage = typeof PeerUsageCoverage.Type;

/** `GET /usage/overview` of a workspace, for an inclusive range of UTC days. */
export const PeerUsageOverview = Schema.Struct({
  workspace: Schema.String,
  days: PeerUsageDays,
  from: Schema.String,
  to: Schema.String,
  project: Schema.NullOr(Schema.String),
  scope: PeerUsageScope,
  /** Null in scope `self`. */
  tickets: Schema.NullOr(PeerUsageTickets),
  implementations: PeerUsageImplementations,
  apiSpend: PeerUsageApiSpend,
  /** Null: nothing priced was reported; `tokens` may still hold tokens of unpriced models. */
  tokenValue: Schema.NullOr(PeerUsageTokenValue),
  /** Null: the workspace has no `github` block, or the scope is `self`. */
  code: Schema.NullOr(PeerUsageCode),
  /** Null: nothing was reported. */
  tokens: Schema.NullOr(PeerUsageTokens),
  byAgent: Schema.Array(PeerUsageAgentRow),
  byUser: Schema.Array(PeerUsageUserRow),
  coverage: PeerUsageCoverage,
});
export type PeerUsageOverview = typeof PeerUsageOverview.Type;

/** A person's own choice to share their usage with a workspace. */
export const PeerUsageSharing = Schema.Struct({
  sharing: Schema.Boolean,
  at: Schema.NullOr(Schema.String),
  /** The reports turning sharing off erased; only that answer has it. */
  removed: Schema.optional(Schema.Number),
});
export type PeerUsageSharing = typeof PeerUsageSharing.Type;

/** What a read or a change answers when the Hub has no usage feature. */
export const PeerUsageUnsupported = Schema.Struct({ unsupported: Schema.Literal(true) });
export type PeerUsageUnsupported = typeof PeerUsageUnsupported.Type;

export const PeerUsageOverviewAnswer = Schema.Union([PeerUsageOverview, PeerUsageUnsupported]);
export type PeerUsageOverviewAnswer = typeof PeerUsageOverviewAnswer.Type;

export const PeerUsageSharingAnswer = Schema.Union([PeerUsageSharing, PeerUsageUnsupported]);
export type PeerUsageSharingAnswer = typeof PeerUsageSharingAnswer.Type;

export const PeerUsageOverviewInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  days: PeerUsageDays,
  /** One project; all of them when absent. */
  project: Schema.optional(TrimmedNonEmptyString),
});
export type PeerUsageOverviewInput = typeof PeerUsageOverviewInput.Type;

export const PeerUsageSharingInput = Schema.Struct({ workspace: TrimmedNonEmptyString });
export type PeerUsageSharingInput = typeof PeerUsageSharingInput.Type;

/** No email: the signed-in person is always the subject. */
export const PeerUsageSetSharingInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  sharing: Schema.Boolean,
});
export type PeerUsageSetSharingInput = typeof PeerUsageSetSharingInput.Type;

/** The Hub's bounds on a report, so a computer can stay within them before sending. */
export const PEER_USAGE_REPORT_LIMITS = {
  rows: 64,
  bytes: 16 * 1024,
  /** A token count or a session count. */
  count: 10_000_000_000_000,
  usd: 1_000_000,
  modelChars: 120,
  /** How far back a day may be reported. */
  days: 35,
} as const;

/**
 * The shape of a model's name, and nothing longer: a transcript's model is free text, so a local
 * model's path or a cloud ARN would otherwise reach the Hub. Anything else is reported as `other`.
 */
export const PEER_USAGE_MODEL_PATTERN = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9._+-]{0,${String(PEER_USAGE_REPORT_LIMITS.modelChars - 1)}}$`,
);

const reportCount = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: PEER_USAGE_REPORT_LIMITS.count }),
);

/**
 * One fold of a computer's day. Agent, model, capacity and counts are all a report may hold: the
 * Hub refuses any other field, and this is the boundary that keeps paths, ids and titles at home.
 */
export const PeerUsageReportRow = Schema.Struct({
  agent: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.-]{0,47}$/)),
  model: Schema.String.check(Schema.isPattern(PEER_USAGE_MODEL_PATTERN)),
  capacity: Schema.Literals(["personal", "shared"]),
  input: reportCount,
  output: reportCount,
  cached: reportCount,
  /** Null: the model has no known price, so its tokens count and its cost is left out. */
  usd: Schema.NullOr(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: PEER_USAGE_REPORT_LIMITS.usd })),
  ),
  sessions: reportCount,
});
export type PeerUsageReportRow = typeof PeerUsageReportRow.Type;

/**
 * The body of `PUT /usage/reports/{project}/{day}`. The Hub reads empty `rows` as removing the
 * computer's report; Peer never sends them, since only a person's sharing switch takes rows away.
 */
export const PeerUsageReportBody = Schema.Struct({
  environment: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,120}$/)),
  rev: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  rows: Schema.Array(PeerUsageReportRow).check(Schema.isMaxLength(PEER_USAGE_REPORT_LIMITS.rows)),
});
export type PeerUsageReportBody = typeof PeerUsageReportBody.Type;

/** One computer's report for one project and UTC day. */
export const PeerUsageReportInput = Schema.Struct({
  ...PeerUsageReportBody.fields,
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  day: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
});
export type PeerUsageReportInput = typeof PeerUsageReportInput.Type;
