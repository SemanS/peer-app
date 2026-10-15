import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Knowledge: what agents find that a project may want to keep becomes a candidate people dismiss
 * or keep, and a kept one is written into the project's reviewed knowledge (kontext, `.ai/` in its
 * repository), staged for its next commit.
 */

/** One finding behind a knowledge candidate. */
export const PeerCandidateSource = Schema.Struct({
  finding: Schema.String,
  email: Schema.String,
  session: Schema.String,
  task: Schema.optional(Schema.String),
  text: Schema.String,
  /** Its agent marked it for the project. */
  tagged: Schema.Boolean,
  /** It found this on its own: on another work, without having heard it first. */
  independent: Schema.Boolean,
  at: Schema.String,
  /** Where it came from when not an agent's line, e.g. `context:task:krk-335@v7`. */
  origin: Schema.optional(Schema.String),
});
export type PeerCandidateSource = typeof PeerCandidateSource.Type;

/** The knowledge entry a kept candidate became in the project's `.ai/`. */
export const PeerKeptAs = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  kind: Schema.String,
});
export type PeerKeptAs = typeof PeerKeptAs.Type;

/**
 * Something agents found that the project may want to keep: a finding its agent
 * marked for the project, or findings that match across works. People dismiss
 * it or promote it into the project's knowledge.
 */
export const PeerKnowledgeCandidate = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  text: Schema.String,
  sources: Schema.Array(PeerCandidateSource),
  /** Agents that found it on their own. */
  finders: Schema.Number,
  status: Schema.Literals(["proposed", "dismissed", "promoted", "kept_pending_review"]),
  decidedBy: Schema.optional(Schema.String),
  decidedAt: Schema.optional(Schema.String),
  /** Found again, on its own, after people dismissed it. */
  reopened: Schema.optional(Schema.Boolean),
  firstAt: Schema.String,
  lastAt: Schema.String,
  /** decision, convention, learning or incident, when someone already said. */
  kind: Schema.optional(Schema.String),
  /** The entry's body, when it came already written. */
  detail: Schema.optional(Schema.String),
  /** Repository paths retained from extraction until the entry is staged. */
  paths: Schema.optional(Schema.Array(Schema.String)),
  keptAs: Schema.optional(PeerKeptAs),
});
export type PeerKnowledgeCandidate = typeof PeerKnowledgeCandidate.Type;

/** Kept for Git review counts as kept, but does not establish publication. */
export const isCandidateKept = (status: PeerKnowledgeCandidate["status"]) =>
  status === "promoted" || status === "kept_pending_review";

/** A project's knowledge on this computer: its checkout, and whether kontext keeps knowledge there. */
export const PeerKnowledgeStatus = Schema.Struct({
  /** The repository checkout it would live in; null when the project is not on this computer. */
  checkout: Schema.NullOr(Schema.String),
  /** `kontext init` ran there. */
  store: Schema.Boolean,
  /** kontext is installed here. */
  kontext: Schema.Boolean,
  /** Peer may word entries with kontext's llm adapter (on this person's own account). */
  llm: Schema.Boolean,
  /** The project's own guidance for its agents on what to mark [project], when it has one. */
  guidance: Schema.NullOr(Schema.String),
});
export type PeerKnowledgeStatus = typeof PeerKnowledgeStatus.Type;

/** A candidate written into the project's knowledge, staged for its next commit. */
export const PeerKeptCandidate = Schema.Struct({
  checkout: Schema.String,
  keptAs: PeerKeptAs,
  /** An entry already in the knowledge that may say the same, to check before committing. */
  related: Schema.NullOr(Schema.String),
  /** Why kontext's model did not word it, when it was kept as the agents wrote it. */
  asWritten: Schema.NullOr(Schema.String),
});
export type PeerKeptCandidate = typeof PeerKeptCandidate.Type;

/** A knowledge entry Peer staged in a project's repository, e.g. the agents' proposed guidance. */
export const PeerStagedEntry = Schema.Struct({
  checkout: Schema.String,
  path: Schema.String,
  title: Schema.String,
});
export type PeerStagedEntry = typeof PeerStagedEntry.Type;

/** A project's knowledge candidates; `waiting` is the count the caller knows of, so a new one reads again. */
export const PeerHubCandidatesInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  waiting: Schema.optional(Schema.Number),
});
export type PeerHubCandidatesInput = typeof PeerHubCandidatesInput.Type;

export const PeerHubDecideCandidateInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  status: Schema.Literals(["proposed", "dismissed", "promoted"]),
});
export type PeerHubDecideCandidateInput = typeof PeerHubDecideCandidateInput.Type;

/** One knowledge candidate of a project. */
export const PeerHubCandidateInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type PeerHubCandidateInput = typeof PeerHubCandidateInput.Type;

/** The longest text a person may give a candidate before keeping it. */
export const PEER_KEPT_TEXT_MAX = 2_000;

/** Keeps a candidate, in the person's own words when they edited its text first. */
export const PeerHubKeepCandidateInput = Schema.Struct({
  ...PeerHubCandidateInput.fields,
  text: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(PEER_KEPT_TEXT_MAX))),
});
export type PeerHubKeepCandidateInput = typeof PeerHubKeepCandidateInput.Type;

/** A task's (or a project's) shared context to read for what the project should keep. */
export const PeerHubHarvestInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  scope: TrimmedNonEmptyString,
});
export type PeerHubHarvestInput = typeof PeerHubHarvestInput.Type;
