import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Test reports on the wire: what a task's work was checked against, what passed, what failed and
 * what nobody verified, kept by the Hub per task and author (its `test-reports` feature, camelCase
 * JSON below `/v1/workspaces/{slug}/tests`). A report is what its author says; the Hub cleans and
 * bounds it, and an item is marked `seen` only when Peer saw the session run that exact command.
 * Open vocabularies (an author's `role`) are plain strings, so an app of one age reads a Hub of
 * another; a field a newer Hub adds is dropped on decoding.
 *
 * `commandNames` (`peer tests`) is not here: the plugin names its commands where it defines them.
 */
export const PEER_TEST_REPORTS_PLUGIN = {
  id: "test-reports",
  title: "Test reports",
  summary:
    "What a task was tested against, what failed and what nobody verified; every unverified item needs an owner before an agent finishes the task.",
  defaultEnabled: true,
  hubFeature: { id: "test-reports", revision: 1 },
} as const;

/** What the Hub keeps of a report: a summary of 300 characters, 40 items of 240, 24 KiB in all. */
export const PEER_TEST_REPORT_LIMITS = {
  summaryChars: 300,
  itemChars: 240,
  items: 40,
  bytes: 24 * 1024,
} as const;

/** A report's result; the Hub stores `mixed` when the items disagree with the one filed. */
export const PeerTestReportResult = Schema.Literals(["pass", "fail", "mixed"]);
export type PeerTestReportResult = typeof PeerTestReportResult.Type;

export const PeerTestReportItemKind = Schema.Literals(["pass", "fail", "unverified"]);
export type PeerTestReportItemKind = typeof PeerTestReportItemKind.Type;

/** Peer saw the session run the item's text as a shell command: whether it failed, and when. */
export const PeerTestReportSeen = Schema.Struct({
  failed: Schema.Boolean,
  at: Schema.String,
});
export type PeerTestReportSeen = typeof PeerTestReportSeen.Type;

export const PeerTestReportItem = Schema.Struct({
  kind: PeerTestReportItemKind,
  text: Schema.String,
  /** Who answers for an unverified item: a project member's verified address. */
  owner: Schema.optional(Schema.String),
  seen: Schema.optional(PeerTestReportSeen),
});
export type PeerTestReportItem = typeof PeerTestReportItem.Type;

/** The author's role when they filed it: `author` (a building session) or `review`. */
export const PEER_TEST_REPORT_ROLES = ["author", "review"] as const;

/** The latest report of one author on one task. */
export const PeerTestReport = Schema.Struct({
  project: Schema.String,
  task: Schema.String,
  author: Schema.String,
  number: Schema.Number,
  result: PeerTestReportResult,
  summary: Schema.String,
  items: Schema.Array(PeerTestReportItem),
  role: Schema.String,
  at: Schema.String,
  commit: Schema.optional(Schema.String),
  /** The Hub cut the report to its bounds. */
  shortened: Schema.optional(Schema.Boolean),
});
export type PeerTestReport = typeof PeerTestReport.Type;

/**
 * A report without its text, as the status and the task row read it: the counts, and how many
 * unverified items have no owner.
 */
export const PeerTestReportSummary = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  task: Schema.String,
  author: Schema.String,
  number: Schema.Number,
  result: PeerTestReportResult,
  role: Schema.String,
  at: Schema.String,
  passed: Schema.Number,
  failed: Schema.Number,
  unverified: Schema.Number,
  unowned: Schema.Number,
});
export type PeerTestReportSummary = typeof PeerTestReportSummary.Type;

/** The plugin's status slice: the summaries of the reports this environment has read, newest first. */
export const PeerTestReportsStatus = Schema.Struct({
  summaries: Schema.Array(PeerTestReportSummary),
});
export type PeerTestReportsStatus = typeof PeerTestReportsStatus.Type;

export const PeerTestsPlace = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  task: TrimmedNonEmptyString,
});
export type PeerTestsPlace = typeof PeerTestsPlace.Type;

/** A person files or replaces their own report from the task page. */
export const PeerTestsFileInput = Schema.Struct({
  ...PeerTestsPlace.fields,
  result: PeerTestReportResult,
  summary: TrimmedNonEmptyString,
  items: Schema.Array(
    Schema.Struct({
      kind: PeerTestReportItemKind,
      text: TrimmedNonEmptyString,
      owner: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
});
export type PeerTestsFileInput = typeof PeerTestsFileInput.Type;

/** The stored report, and whether this filing changed it (an identical report changes nothing). */
export const PeerTestsFileResult = Schema.Struct({
  report: PeerTestReport,
  changed: Schema.Boolean,
});
export type PeerTestsFileResult = typeof PeerTestsFileResult.Type;

/**
 * The task's owner, a lead or an admin gives an unverified item of `author`'s report an owner, or
 * clears it (`owner` null). `number` is the report the save was made from.
 */
export const PeerTestsSetOwnerInput = Schema.Struct({
  ...PeerTestsPlace.fields,
  author: TrimmedNonEmptyString,
  index: NonNegativeInt,
  number: PositiveInt,
  owner: Schema.NullOr(TrimmedNonEmptyString),
});
export type PeerTestsSetOwnerInput = typeof PeerTestsSetOwnerInput.Type;

/**
 * `saved` with the report as it is now, or `stale` (409 `stale_report`): the author filed a newer
 * report since, `number` names it and `report` is what is stored now.
 */
export const PeerTestsSetOwnerResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("saved"), report: PeerTestReport }),
  Schema.Struct({
    kind: Schema.Literal("stale"),
    number: Schema.Number,
    report: Schema.optional(PeerTestReport),
  }),
]);
export type PeerTestsSetOwnerResult = typeof PeerTestsSetOwnerResult.Type;
