import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Changes in flight on the wire: what each computer reports of its agents' Jujutsu changes (facts,
 * never code), what the Hub keeps and members read (its `changes` feature, camelCase JSON below
 * `/v1/workspaces/{slug}`), and what an environment's `changes` plugin hands its clients. Names on
 * the wire never change, and an app of one age reads a Hub of another: a field a newer Hub adds is
 * dropped on decoding, and the open vocabularies (a version's `kind`) are plain strings with the
 * known values listed beside them.
 */
export const PEER_CHANGES_PLUGIN = {
  id: "changes",
  title: "Changes",
  summary:
    "Everyone's Jujutsu changes in flight as one graph, with the versions of each, so a reviewer sees only what moved.",
  defaultEnabled: true,
  hubFeature: { id: "changes", revision: 1 },
} as const;

/** The Hub's limits on one report; the app cuts to them before it sends. */
export const PEER_CHANGES_LIMITS = {
  changes: 20,
  paths: 50,
  bookmarks: 5,
  subject: 120,
  versions: 50,
} as const;

/** Why a version exists: the paths or tree changed, only the subject did, or only the parents did. */
export const PEER_CHANGE_VERSION_KINDS = ["edit", "description", "rebase"] as const;
export type PeerChangeVersionKind = (typeof PEER_CHANGE_VERSION_KINDS)[number];
export const isPeerChangeVersionKind = (value: string): value is PeerChangeVersionKind =>
  (PEER_CHANGE_VERSION_KINDS as ReadonlyArray<string>).includes(value);

/** jj's change ids are 32 letters from k to z; commit ids are 40 hex digits. */
export const ChangeId = Schema.String.check(Schema.isPattern(/^[k-z]{32}$/));
export const CommitId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

/** One change as a session's report names it. */
export const ReportedChange = Schema.Struct({
  changeId: ChangeId,
  commitId: CommitId,
  parents: Schema.Array(ChangeId),
  subject: Schema.String.check(Schema.isMaxLength(PEER_CHANGES_LIMITS.subject)),
  paths: Schema.Array(Schema.String).check(Schema.isMaxLength(PEER_CHANGES_LIMITS.paths)),
  bookmarks: Schema.Array(Schema.String).check(Schema.isMaxLength(PEER_CHANGES_LIMITS.bookmarks)),
  conflict: Schema.Boolean,
  empty: Schema.Boolean,
  divergent: Schema.Boolean,
  /** An agent works in this change now: it is the session's working-copy change. */
  working: Schema.Boolean,
  kind: Schema.Literals(PEER_CHANGE_VERSION_KINDS),
});
export type ReportedChange = typeof ReportedChange.Type;

/**
 * The body of `PUT …/changes/{project}`: one agent session's changes in flight. The person is the
 * caller's verified email and is never sent.
 */
export const ChangeReport = Schema.Struct({
  session: TrimmedNonEmptyString,
  /** Higher than the stored one, or the Hub answers `409 stale_seq`. */
  seq: NonNegativeInt,
  environment: Schema.String,
  agent: Schema.String,
  task: Schema.NullOr(Schema.String),
  changes: Schema.Array(ReportedChange).check(Schema.isMaxLength(PEER_CHANGES_LIMITS.changes)),
});
export type ChangeReport = typeof ChangeReport.Type;

/** The body of `POST …/changes/withdraw`: a session ended. */
export const ChangeWithdraw = Schema.Struct({
  project: TrimmedNonEmptyString,
  session: TrimmedNonEmptyString,
});
export type ChangeWithdraw = typeof ChangeWithdraw.Type;

/** A commit id a change had, as the author's computer reported it. */
export const ChangeVersion = Schema.Struct({
  commit: Schema.String,
  at: Schema.String,
  /** One of `PEER_CHANGE_VERSION_KINDS`; a plain string so a newer Hub's kind still decodes. */
  kind: Schema.String,
});
export type ChangeVersion = typeof ChangeVersion.Type;

export const ChangePerson = Schema.Struct({ email: Schema.String, agent: Schema.String });
export type ChangePerson = typeof ChangePerson.Type;

/** A session whose work builds on, or sits in, a change. */
export const ChangeSession = Schema.Struct({
  email: Schema.String,
  agent: Schema.String,
  environment: Schema.String,
  task: Schema.optional(Schema.NullOr(Schema.String)),
  working: Schema.Boolean,
});
export type ChangeSession = typeof ChangeSession.Type;

/** Where a row's data comes from, as the legend says it. */
export const PEER_CHANGE_SOURCES = ["live", "shared", "pushed", "reported"] as const;
export type PeerChangeSource = (typeof PEER_CHANGE_SOURCES)[number];

/**
 * One change in flight as members read it (`GET …/changes`), with what only the environment that
 * shows it can add (`source`, `sourceAt`, `lines`): all optional, so the Hub's own rows decode.
 */
export const ChangeRow = Schema.Struct({
  project: Schema.String,
  changeId: Schema.String,
  commitId: Schema.String,
  parents: Schema.Array(Schema.String),
  subject: Schema.String,
  paths: Schema.Array(Schema.String),
  bookmarks: Schema.Array(Schema.String),
  conflict: Schema.Boolean,
  empty: Schema.Boolean,
  divergent: Schema.Boolean,
  working: Schema.Boolean,
  /** The person and agent of the session that first reported it as its working change. */
  author: ChangePerson,
  versions: Schema.Array(ChangeVersion),
  sessions: Schema.Array(ChangeSession),
  lastReportAt: Schema.String,
  /** The task whose session reported it, when a session named one. */
  task: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(PEER_CHANGE_SOURCES)),
  sourceAt: Schema.optional(Schema.String),
  lines: Schema.optional(Schema.Struct({ added: NonNegativeInt, removed: NonNegativeInt })),
});
export type ChangeRow = typeof ChangeRow.Type;

/** `GET …/changes`: the project's changes in flight. */
export const HubChanges = Schema.Struct({ changes: Schema.Array(ChangeRow) });
export type HubChanges = typeof HubChanges.Type;

/** What a person marked reviewed: the version, its commit (kept addressable) and when. */
export const ReviewMark = Schema.Struct({
  changeId: Schema.String,
  commit: Schema.String,
  version: NonNegativeInt,
  at: Schema.String,
});
export type ReviewMark = typeof ReviewMark.Type;

/** The newest landed change on trunk, which the graph ends at. */
export const LandedChange = Schema.Struct({
  changeId: Schema.String,
  commitId: Schema.String,
  subject: Schema.String,
  /** The trunk bookmark it is read from, such as `main@origin`. */
  bookmark: Schema.String,
  author: Schema.optional(Schema.String),
  at: Schema.optional(Schema.String),
  paths: Schema.optional(Schema.Array(Schema.String)),
});
export type LandedChange = typeof LandedChange.Type;

/**
 * jj failed in a workspace on this computer. The page shows jj's message and says that Peer retries
 * at the agent's next step.
 */
export const ChangesProblem = Schema.Struct({
  workspace: Schema.String,
  message: Schema.String,
});
export type ChangesProblem = typeof ChangesProblem.Type;

/**
 * One project's changes as an environment's `changes` plugin shows them: the Hub's rows (what it
 * last read, with the environment's own facts added), trunk's newest landed change, this person's
 * review marks, and what failed locally. The payload of `peer.changes.subscribe`.
 */
export const ProjectChanges = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  changes: Schema.Array(ChangeRow),
  landed: Schema.optional(LandedChange),
  marks: Schema.Array(ReviewMark),
  problems: Schema.Array(ChangesProblem),
  /** When the Hub was last read; absent while it has not been. */
  readAt: Schema.optional(Schema.String),
});
export type ProjectChanges = typeof ProjectChanges.Type;

/** Where `peer.changes.subscribe` reads. */
export const ChangesPlace = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
});
export type ChangesPlace = typeof ChangesPlace.Type;

/**
 * A person marks a version reviewed (or takes the mark back with `unmark`: a one-way door is a
 * bug). Answered with the mark now kept, or null after an unmark.
 */
export const MarkReviewedInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  changeId: TrimmedNonEmptyString,
  commit: TrimmedNonEmptyString,
  version: NonNegativeInt,
  unmark: Schema.optional(Schema.Boolean),
});
export type MarkReviewedInput = typeof MarkReviewedInput.Type;

export const ReviewDiffMode = Schema.Literals(["since", "whole"]);
export type ReviewDiffMode = typeof ReviewDiffMode.Type;

export const ReviewDiffInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  changeId: TrimmedNonEmptyString,
  mode: ReviewDiffMode,
  /**
   * A commit to compare from instead of the person's mark (the version a task last built on): the
   * diff is its interdiff to the change's newest commit. `mode` then names only the fallback while
   * this computer does not have the commit.
   */
  from: Schema.optional(CommitId),
});
export type ReviewDiffInput = typeof ReviewDiffInput.Type;

export const ReviewDiffLine = Schema.Struct({
  kind: Schema.Literals(["context", "add", "del"]),
  n: Schema.optional(NonNegativeInt),
  text: Schema.String,
});
export type ReviewDiffLine = typeof ReviewDiffLine.Type;

export const ReviewDiffFile = Schema.Struct({
  path: Schema.String,
  added: NonNegativeInt,
  removed: NonNegativeInt,
  lines: Schema.Array(ReviewDiffLine).check(Schema.isMaxLength(400)),
});
export type ReviewDiffFile = typeof ReviewDiffFile.Type;

/**
 * What moved, from `jj interdiff` ("Since your review") or `jj diff` ("Whole change").
 * `notHere`: the newest commit is not on this computer and nothing is compared. `partial`: compared
 * up to `toVersion`, the newest this computer has. It never fetches on its own.
 */
export const ReviewDiff = Schema.Struct({
  state: Schema.Literals(["ok", "partial", "notHere"]),
  mode: ReviewDiffMode,
  /** The jj command that ran, shown beside the lines. */
  command: Schema.optional(Schema.String),
  fromVersion: Schema.optional(NonNegativeInt),
  toVersion: Schema.optional(NonNegativeInt),
  files: Schema.Array(ReviewDiffFile).check(Schema.isMaxLength(100)),
  /** Commits trunk gained between the two versions' parents, which "since" leaves out. */
  leftOut: Schema.optional(NonNegativeInt),
});
export type ReviewDiff = typeof ReviewDiff.Type;

/**
 * The status field (`changes`, omitted while the plugin is inactive): counts only. Per project, the
 * changes in flight and those that need a person (a conflict or two versions), which the project
 * navigation row counts; the rows are behind `peer.changes.subscribe`.
 */
export const PeerChangesStatus = Schema.Struct({
  hubSupport: Schema.Literals(["unknown", "supported", "unsupported"]),
  lastContact: Schema.optional(Schema.String),
  projects: Schema.Array(
    Schema.Struct({
      workspace: Schema.String,
      project: Schema.String,
      inFlight: NonNegativeInt,
      needAttention: NonNegativeInt,
    }),
  ),
});
export type PeerChangesStatus = typeof PeerChangesStatus.Type;
