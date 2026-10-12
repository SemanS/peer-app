import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Peer's ownership plugin: who answers for a task, an area and a path of a project, and the
 * owner's call, the request an agent makes to the owner of a path its person does not own (the
 * Hub's `ownership` feature). Everything here mirrors the Hub's wire contract field for field
 * (camelCase, times as RFC 3339 strings, absent fields left out). Names of open vocabularies (why a
 * task has its owner, the state of a call) are plain strings, so an app of one age reads a Hub of
 * another; the values known today are listed beside them.
 *
 * `commandNames` (`peer owner`) is not here: the plugin names its commands where it defines them.
 */
export const PEER_OWNERSHIP_PLUGIN = {
  id: "ownership",
  title: "Ownership",
  summary:
    "Who owns each task and path. Owners hear about changes in their paths and decide them where they ask to.",
  defaultEnabled: true,
  hubFeature: { id: "ownership", revision: 1 },
} as const;

/**
 * What the Hub accepts, so a form can say so before it sends: an owner map names at most 100 areas
 * (each a line of at most 80 characters) and 50 patterns for owners and 50 for owner-decides, as
 * coordination path patterns are limited; an owner's call names at most 20 paths; its reason, and a
 * decision's note, are at most 300 characters; an `op` is at most 64.
 */
export const PEER_OWNERSHIP_LIMITS = {
  areas: 100,
  areaChars: 80,
  patterns: 50,
  patternChars: 200,
  callPaths: 20,
  textChars: 300,
  opChars: 64,
} as const;

/**
 * Why a task has the owner it has: `first-agent` (its person's agent reported work on it first),
 * `request` (the person accepted a request for it), `named` (a lead or an admin named them) or
 * `handover` (the owner passed it on).
 */
export const PEER_TASK_OWNER_REASONS = ["first-agent", "request", "named", "handover"] as const;
export type PeerTaskOwnerReason = (typeof PEER_TASK_OWNER_REASONS)[number];

/**
 * The states of an owner's call: `pending` until it is decided, withdrawn by its asker or expired
 * (7 days after it was opened), `accepted` or `declined` by its owner or by a lead for them.
 */
export const PEER_OWNER_CALL_STATES = [
  "pending",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
] as const;
export type PeerOwnerCallState = (typeof PEER_OWNER_CALL_STATES)[number];

/** A text of at most `max` characters, counted as the Hub counts them: Unicode scalar values. */
const Characters = (max: number) =>
  Schema.String.check(
    Schema.makeFilter((text) => [...text].length <= max || `At most ${max} characters.`),
  );

/** What makes a command this one: sent again, it changes nothing a second time. */
const Op = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(PEER_OWNERSHIP_LIMITS.opChars),
);

/**
 * A task's owner, who is a member of its project when it is written. `by` is who made the change,
 * absent when the Hub did (`first-agent`, `request`). `reason` is one of `PEER_TASK_OWNER_REASONS`.
 */
export const PeerTaskOwner = Schema.Struct({
  project: Schema.String,
  task: Schema.String,
  /** The owner's verified address, in lower case. */
  owner: Schema.String,
  since: Schema.String,
  by: Schema.optional(Schema.String),
  reason: Schema.String,
});
export type PeerTaskOwner = typeof PeerTaskOwner.Type;

/**
 * Who owns each area and each path pattern of a project, and the patterns where the owner decides.
 * `version` counts the saves (0 before the first), and a save names the one it was made from.
 * Emails are lower case; patterns follow coordination path patterns, whose most specific match
 * decides.
 */
export const PeerOwnerMap = Schema.Struct({
  version: NonNegativeInt,
  areas: Schema.Record(Schema.String, Schema.String),
  paths: Schema.Record(Schema.String, Schema.String),
  decide: Schema.Array(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  updatedBy: Schema.optional(Schema.String),
});
export type PeerOwnerMap = typeof PeerOwnerMap.Type;

/**
 * An agent's request to the owner of paths its person does not own. `task`, `session`, `email` and
 * `environment` are the asking agent's task, session, person and computer. `owner` decides, or a
 * lead or an admin for them (`onBehalf`), never `email`; a decision keeps who made it (`decidedBy`)
 * and its note. `state` is one of `PEER_OWNER_CALL_STATES`; a pending call past `expiresAt` reads
 * as expired.
 */
export const PeerOwnerCall = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  task: Schema.optional(Schema.String),
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  owner: Schema.String,
  paths: Schema.Array(Schema.String),
  reason: Schema.String,
  state: Schema.String,
  decidedBy: Schema.optional(Schema.String),
  onBehalf: Schema.Boolean,
  note: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  expiresAt: Schema.String,
});
export type PeerOwnerCall = typeof PeerOwnerCall.Type;

/**
 * What the Hub holds of one project's ownership: its leads who are on it, its owner map, the owner
 * of each task that has one (by task id) and the calls opened in the last 30 days, newest first. A
 * person who left owns nothing, but the rows say what was saved: who is on the project now is for
 * the reader to tell.
 */
export const PeerOwnershipProjectView = Schema.Struct({
  leads: Schema.Array(Schema.String),
  map: PeerOwnerMap,
  tasks: Schema.Record(Schema.String, PeerTaskOwner),
  calls: Schema.Array(PeerOwnerCall),
});
export type PeerOwnershipProjectView = typeof PeerOwnershipProjectView.Type;

/** `GET /ownership`: each of the caller's projects (a project they are not on is absent). */
export const PeerOwnershipView = Schema.Struct({
  projects: Schema.Record(Schema.String, PeerOwnershipProjectView),
  at: Schema.String,
});
export type PeerOwnershipView = typeof PeerOwnershipView.Type;

/** One project's ownership as the status carries it: the Hub's view of it, and when the Hub made it. */
export const PeerOwnershipProject = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  at: Schema.String,
  ...PeerOwnershipProjectView.fields,
});
export type PeerOwnershipProject = typeof PeerOwnershipProject.Type;

/**
 * The `ownership` field of `PeerHubStatus`, there while the plugin is active: the last view of each
 * project the person is on that the Hub gave. A project it does not list is one whose ownership is
 * not known (no view yet, or the Hub is unreachable and none was read), where clients behave as
 * they did before ownership: no owners, reviews in every member's Needs you.
 */
export const PeerOwnershipStatus = Schema.Struct({
  projects: Schema.Array(PeerOwnershipProject),
});
export type PeerOwnershipStatus = typeof PeerOwnershipStatus.Type;

// ---- calls to the plugin's RPC methods ----------------------------------------------------------

export const PeerOwnershipListInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: Schema.optional(TrimmedNonEmptyString),
});
export type PeerOwnershipListInput = typeof PeerOwnershipListInput.Type;

/**
 * A lead or an admin names a task's owner or takes it away; its owner hands it to someone on the
 * project or gives it back. `owner` is a verified address, or null to give the task back.
 */
export const PeerOwnershipSetTaskOwnerInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  task: TrimmedNonEmptyString,
  owner: Schema.NullOr(TrimmedNonEmptyString),
  op: Schema.optional(Op),
});
export type PeerOwnershipSetTaskOwnerInput = typeof PeerOwnershipSetTaskOwnerInput.Type;

/** The owner row (null once there is none), whether this changed it, and whether its `op` had. */
export const PeerOwnershipSetTaskOwnerResult = Schema.Struct({
  task: Schema.String,
  owner: Schema.NullOr(PeerTaskOwner),
  changed: Schema.Boolean,
  replayed: Schema.optional(Schema.Boolean),
});
export type PeerOwnershipSetTaskOwnerResult = typeof PeerOwnershipSetTaskOwnerResult.Type;

/** A save of the owner map: the whole map the person wants, made from the version it names. */
export const PeerOwnershipSetMapInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  version: NonNegativeInt,
  areas: Schema.Record(Schema.String, Schema.String),
  paths: Schema.Record(Schema.String, Schema.String),
  decide: Schema.Array(Schema.String),
});
export type PeerOwnershipSetMapInput = typeof PeerOwnershipSetMapInput.Type;

/**
 * What a save of the owner map comes to: `saved`, with the map as it is now and whether the save
 * changed it, or `conflict` (409 `owner_map_changed`): the map changed since the person opened it,
 * and `map` is what is saved now, for them to compare their edits with. A refusal of the Hub that
 * is not a conflict (403 `ownership_forbidden`, a 400 naming the field) fails as a `PeerHubError`.
 */
export const PeerOwnershipSetMapResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("saved"), map: PeerOwnerMap, changed: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("conflict"), map: PeerOwnerMap }),
]);
export type PeerOwnershipSetMapResult = typeof PeerOwnershipSetMapResult.Type;

/** What an owner decides: accept the call, or decline it. */
export const PeerOwnershipDecision = Schema.Literals(["accept", "decline"]);
export type PeerOwnershipDecision = typeof PeerOwnershipDecision.Type;

/**
 * The owner decides a pending call, or a lead or an admin does for them (the call then says
 * `onBehalf`); nobody decides a call their own agent opened. The note is for the asking agent.
 */
export const PeerOwnershipDecideInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  decision: PeerOwnershipDecision,
  note: Schema.optional(Characters(PEER_OWNERSHIP_LIMITS.textChars)),
});
export type PeerOwnershipDecideInput = typeof PeerOwnershipDecideInput.Type;

/** The person whose agent opened a pending call takes it back. */
export const PeerOwnershipWithdrawInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type PeerOwnershipWithdrawInput = typeof PeerOwnershipWithdrawInput.Type;

/** The call as it stands after a decision or a withdrawal. */
export const PeerOwnershipCallResult = Schema.Struct({ call: PeerOwnerCall });
export type PeerOwnershipCallResult = typeof PeerOwnershipCallResult.Type;

// ---- the Hub's wire for `peer owner ask`, which has no RPC method: agents ask through the CLI ------

/**
 * An agent session of the caller asks the owners of the paths it wants to change: at most 20 paths
 * of the repository, each one where its owner decides and that someone else owns, and why (the Hub
 * cuts it to 300 characters, and refuses an empty one).
 */
export const PeerOwnershipAskInput = Schema.Struct({
  environment: Schema.String,
  session: Schema.String,
  paths: Schema.Array(Schema.String),
  reason: Schema.String,
  op: Schema.optional(Op),
});
export type PeerOwnershipAskInput = typeof PeerOwnershipAskInput.Type;

/**
 * One call per owner: `calls` are the calls the ask came to, `merged` the ids of those it added
 * paths to instead of opening, `replayed` set when its `op` had asked before.
 */
export const PeerOwnershipAskResult = Schema.Struct({
  calls: Schema.Array(PeerOwnerCall),
  merged: Schema.Array(Schema.String),
  at: Schema.String,
  replayed: Schema.optional(Schema.Boolean),
});
export type PeerOwnershipAskResult = typeof PeerOwnershipAskResult.Type;
