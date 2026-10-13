import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Task agreements on the wire: what the agents of two tasks agreed when they settled an overlap,
 * kept by the Hub for that pair of tasks (its `agreements` feature, camelCase JSON below
 * `/v1/workspaces/{slug}`). Names on the wire never change, and an app of one age reads a Hub of
 * another: a field a newer Hub adds is dropped on decoding, and the two open vocabularies, an
 * agreement's `state` and the `why` of its closing, are plain strings. The values known today are
 * listed beside them, each with a guard that says whether a string is one of them.
 *
 * `commandNames` (`peer agreements`) is not here: the plugin names its commands where it defines them.
 */
export const PEER_AGREEMENTS_PLUGIN = {
  id: "agreements",
  title: "Agreements",
  summary:
    "What the agents of two tasks agreed is kept for those tasks and told to whoever works on or lands either one later.",
  defaultEnabled: true,
  hubFeature: { id: "agreements", revision: 1 },
} as const;

/**
 * Where an agreement stands for the reader: `open` until a task lands, `due` once exactly one has
 * (it falls due for the other, `dueFor`), `closed` (`closed.why` says how).
 */
export const PEER_AGREEMENT_STATES = ["open", "due", "closed"] as const;
export type PeerAgreementState = (typeof PEER_AGREEMENT_STATES)[number];
export const isPeerAgreementState = (value: string): value is PeerAgreementState =>
  (PEER_AGREEMENT_STATES as ReadonlyArray<string>).includes(value);

/**
 * How an agreement closed. A person closes it as `handled` or `not-needed`; the Hub as `replaced`
 * (a newer agreement between the same two tasks), `removed` (a task was removed), `expired` (no
 * task landed within 30 days, or newer agreements pushed it out) or `landed` (both tasks landed).
 */
export const PEER_AGREEMENT_CLOSE_REASONS = [
  "handled",
  "not-needed",
  "replaced",
  "removed",
  "expired",
  "landed",
] as const;
export type PeerAgreementCloseReason = (typeof PEER_AGREEMENT_CLOSE_REASONS)[number];
export const isPeerAgreementCloseReason = (value: string): value is PeerAgreementCloseReason =>
  (PEER_AGREEMENT_CLOSE_REASONS as ReadonlyArray<string>).includes(value);

/**
 * What a person closes an agreement as, the only reasons a client sends. It is a closed set, unlike
 * the `why` a view reads, since the Hub refuses a reason it does not know.
 */
export const PEER_AGREEMENT_PERSON_REASONS = ["handled", "not-needed"] as const;
export const PeerAgreementPersonReason = Schema.Literals(PEER_AGREEMENT_PERSON_REASONS);
export type PeerAgreementPersonReason = typeof PeerAgreementPersonReason.Type;
export const isPeerAgreementPersonReason = (value: string): value is PeerAgreementPersonReason =>
  (PEER_AGREEMENT_PERSON_REASONS as ReadonlyArray<string>).includes(value);

/** One session that took part in the overlap the agreement settled, and the task it was on. */
export const PeerAgreementSide = Schema.Struct({
  session: Schema.String,
  environment: Schema.String,
  email: Schema.String,
  task: Schema.String,
});
export type PeerAgreementSide = typeof PeerAgreementSide.Type;

/** Who settled the agreement: the person, and the task of the session that settled it. */
export const PeerAgreementBy = Schema.Struct({
  email: Schema.String,
  task: Schema.String,
});
export type PeerAgreementBy = typeof PeerAgreementBy.Type;

/**
 * How an agreement closed and when. `by` is the person who closed it and is absent when the Hub
 * did; `why` is one of `PEER_AGREEMENT_CLOSE_REASONS`.
 */
export const PeerAgreementClosed = Schema.Struct({
  at: Schema.String,
  by: Schema.optional(Schema.String),
  why: Schema.String,
});
export type PeerAgreementClosed = typeof PeerAgreementClosed.Type;

/**
 * What two tasks' agents agreed when they settled an overlap, as one reader sees it. `tasks` are the
 * pair's task ids in sorted order, `words` what the agents wrote (at most 600 characters), `sides`
 * the sessions that took part. `state` is one of `PEER_AGREEMENT_STATES`; the Hub works it out per
 * reader, with the rules of the reader's Work. `dueFor` is the task that has not landed, set only
 * while the agreement is due; `landed` the tasks that landed as this reader may see; `closed` is
 * set only once the agreement is closed.
 */
export const PeerAgreement = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  tasks: Schema.Array(Schema.String),
  words: Schema.String,
  by: PeerAgreementBy,
  settledAt: Schema.String,
  sides: Schema.Array(PeerAgreementSide),
  state: Schema.String,
  dueFor: Schema.optional(Schema.String),
  landed: Schema.Array(Schema.String),
  closed: Schema.optional(PeerAgreementClosed),
});
export type PeerAgreement = typeof PeerAgreement.Type;

/** `GET …/agreements[?project=]`: the agreements of the caller's projects, and when it read them. */
export const PeerAgreementsView = Schema.Struct({
  agreements: Schema.Array(PeerAgreement),
  at: Schema.String,
});
export type PeerAgreementsView = typeof PeerAgreementsView.Type;

/** Where a view is read: a workspace, or one of its projects. The payload of `peer.agreements.view`. */
export const PeerAgreementsPlace = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: Schema.optional(TrimmedNonEmptyString),
});
export type PeerAgreementsPlace = typeof PeerAgreementsPlace.Type;

/** A project member closes an agreement as handled or as not needed. */
export const PeerAgreementCloseInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  why: PeerAgreementPersonReason,
});
export type PeerAgreementCloseInput = typeof PeerAgreementCloseInput.Type;

/** A project member reopens an agreement a person closed. */
export const PeerAgreementReopenInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type PeerAgreementReopenInput = typeof PeerAgreementReopenInput.Type;

/** The agreement as it stands after a close or a reopen. */
export const PeerAgreementResult = Schema.Struct({ agreement: PeerAgreement });
export type PeerAgreementResult = typeof PeerAgreementResult.Type;

/**
 * The status field (`agreements`, omitted while the plugin is inactive): counts and ids only, since
 * a status is published again and again. Per workspace, how many agreements are not closed (open,
 * or due for a task) and the due ones that wait on this person: their agent took part on the task
 * that has not landed, and no agent is live on that task. `tasks` counts, per task, the agreements
 * not closed that name it and the due ones that wait on it (a Team row's fact), and `due` lists every
 * due agreement by its ids (the Team page's and the phone's signals, which judge for themselves
 * whether an agent is live on the task). An older Peer sends neither. The words and every other
 * detail are behind `peer.agreements.view`.
 */
export const PeerAgreementsStatus = Schema.Struct({
  enabled: Schema.Boolean,
  forcedOff: Schema.Boolean,
  hubSupport: Schema.Literals(["unknown", "supported", "unsupported"]),
  lastContact: Schema.optional(Schema.String),
  workspaces: Schema.Array(
    Schema.Struct({
      workspace: Schema.String,
      open: NonNegativeInt,
      dueForMe: Schema.Array(Schema.Struct({ project: Schema.String, id: Schema.String })),
      tasks: Schema.optional(
        Schema.Array(
          Schema.Struct({
            project: Schema.String,
            task: Schema.String,
            open: NonNegativeInt,
            due: NonNegativeInt,
          }),
        ),
      ),
      due: Schema.optional(
        Schema.Array(
          Schema.Struct({
            project: Schema.String,
            id: Schema.String,
            dueFor: Schema.String,
            landed: Schema.String,
          }),
        ),
      ),
    }),
  ),
});
export type PeerAgreementsStatus = typeof PeerAgreementsStatus.Type;
