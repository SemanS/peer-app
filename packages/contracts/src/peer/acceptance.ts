import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Acceptance on the wire: a lead's (or an admin's) acceptance of a task's delivered work, kept by
 * the Hub as a fact on the task (its `acceptance` feature, camelCase JSON below
 * `/v1/workspaces/{slug}/acceptance`). It gates nothing: no move waits for it, and withdrawing it
 * changes no status. Open vocabularies (an event's `kind`, the status the task had) are plain
 * strings, so an app of one age reads a Hub of another; a field a newer Hub adds is dropped on
 * decoding.
 */
export const PEER_ACCEPTANCE_PLUGIN = {
  id: "acceptance",
  title: "Acceptance",
  summary:
    "A project's lead accepts delivered work: who accepted a task, when and with what note, shown on the task and the Team page. It stops nothing.",
  defaultEnabled: true,
  hubFeature: { id: "acceptance", revision: 1 },
} as const;

/** What the Hub keeps: a note of at most 300 characters; an `op` of at most 64. */
export const PEER_ACCEPTANCE_LIMITS = { noteChars: 300, opChars: 64 } as const;

/** The kinds of a task's acceptance history: given, then perhaps withdrawn. */
export const PEER_ACCEPTANCE_EVENT_KINDS = ["accepted", "withdrawn"] as const;

/**
 * A task's current acceptance: who gave it (a verified address), when, their note, and the task's
 * status when it was given (`review` or `done`). Whether the task was reopened after it is the
 * Hub's `beforeReopening`, on the task's acceptance and its summary.
 */
export const PeerAcceptance = Schema.Struct({
  by: Schema.String,
  at: Schema.String,
  note: Schema.optional(Schema.String),
  statusThen: Schema.String,
});
export type PeerAcceptance = typeof PeerAcceptance.Type;

/** One entry of a task's acceptance history, oldest first; `kind` is one of `PEER_ACCEPTANCE_EVENT_KINDS`. */
export const PeerAcceptanceEvent = Schema.Struct({
  kind: Schema.String,
  by: Schema.String,
  at: Schema.String,
  note: Schema.optional(Schema.String),
});
export type PeerAcceptanceEvent = typeof PeerAcceptanceEvent.Type;

/**
 * Whether the task was reopened after its current acceptance, as the Hub says it (the task is not
 * done while the acceptance stands; it may be in review again). Absent from an older Peer.
 */
const BeforeReopening = Schema.optional(Schema.Boolean);

/** What a task's page shows: the current acceptance, if any, and every acceptance and withdrawal. */
export const PeerTaskAcceptance = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  task: Schema.String,
  current: Schema.NullOr(PeerAcceptance),
  beforeReopening: BeforeReopening,
  history: Schema.Array(PeerAcceptanceEvent),
});
export type PeerTaskAcceptance = typeof PeerTaskAcceptance.Type;

/** A current acceptance without its note, as the status, the task row and the Team page read it. */
export const PeerAcceptanceSummary = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  task: Schema.String,
  by: Schema.String,
  at: Schema.String,
  statusThen: Schema.String,
  beforeReopening: BeforeReopening,
});
export type PeerAcceptanceSummary = typeof PeerAcceptanceSummary.Type;

/** The plugin's status slice: the current acceptances on the person's projects, newest first. */
export const PeerAcceptanceStatus = Schema.Struct({
  accepted: Schema.Array(PeerAcceptanceSummary),
});
export type PeerAcceptanceStatus = typeof PeerAcceptanceStatus.Type;

export const PeerAcceptancePlace = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  task: TrimmedNonEmptyString,
});
export type PeerAcceptancePlace = typeof PeerAcceptancePlace.Type;

/** A text of at most `max` characters, counted as the Hub counts them: Unicode scalar values. */
const Characters = (max: number) =>
  Schema.String.check(
    Schema.makeFilter((text) => [...text].length <= max || `At most ${max} characters.`),
  );

/**
 * A lead accepts a task in review or done (one in review is finished as their own move), or
 * withdraws the acceptance. `op` makes it this one command: sent again, it changes nothing twice.
 */
export const PeerAcceptanceInput = Schema.Struct({
  ...PeerAcceptancePlace.fields,
  note: Schema.optional(Characters(PEER_ACCEPTANCE_LIMITS.noteChars)),
  op: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PEER_ACCEPTANCE_LIMITS.opChars),
  ),
});
export type PeerAcceptanceInput = typeof PeerAcceptanceInput.Type;
