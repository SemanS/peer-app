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
  /** Proposed, and no source joined it for 60 days: the queue shows it under "Older". */
  stale: Schema.optional(Schema.Boolean),
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
  /** Optional saved-knowledge content/path search; older servers ignore it. */
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});
export type PeerHubCandidatesInput = typeof PeerHubCandidatesInput.Type;

export const PeerHubDecideCandidateInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  status: Schema.Literals(["proposed", "dismissed", "promoted"]),
  /** Why it was dismissed ("already in …"), kept here for the project's guidance. */
  reason: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(300))),
});
export type PeerHubDecideCandidateInput = typeof PeerHubDecideCandidateInput.Type;

/** One knowledge candidate of a project. */
export const PeerHubCandidateInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type PeerHubCandidateInput = typeof PeerHubCandidateInput.Type;

export const PeerKnowledgeEntryInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  entry: TrimmedNonEmptyString,
});
export type PeerKnowledgeEntryInput = typeof PeerKnowledgeEntryInput.Type;

/** The longest text a person may give a candidate before keeping it. */
export const PEER_KEPT_TEXT_MAX = 2_000;

/** Keeps a candidate, in the person's own words when they edited its text first. */
export const PeerHubKeepCandidateInput = Schema.Struct({
  ...PeerHubCandidateInput.fields,
  text: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(PEER_KEPT_TEXT_MAX))),
  /** Entries the person chose to replace with it (offered for a possible conflict, never prefilled). */
  supersedes: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(5))),
});
export type PeerHubKeepCandidateInput = typeof PeerHubKeepCandidateInput.Type;

/** A task's (or a project's) shared context to read for what the project should keep. */
export const PeerHubHarvestInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  scope: TrimmedNonEmptyString,
});
export type PeerHubHarvestInput = typeof PeerHubHarvestInput.Type;

/**
 * How a candidate relates to an entry already in the project's knowledge, as kontext judged it:
 * `conflicts` may contradict it, `extends` adds to it, `same` says it already, `related` and
 * `uncertain` only name it. A label to check, never a decision. Plain strings, since a newer kontext
 * may name another.
 */
export const PeerKnowledgeRelation = Schema.Struct({
  entry: Schema.String,
  title: Schema.String,
  relation: Schema.String,
  reason: Schema.String,
});
export type PeerKnowledgeRelation = typeof PeerKnowledgeRelation.Type;

/** A candidate's relations; none when kontext here cannot say (`unavailable` says why). */
export const PeerKnowledgeRelations = Schema.Struct({
  relations: Schema.Array(PeerKnowledgeRelation),
  unavailable: Schema.NullOr(Schema.String),
});
export type PeerKnowledgeRelations = typeof PeerKnowledgeRelations.Type;

/**
 * What kontext's drift found of an entry (the Hub's `knowledge` feature from revision 3): at `head`
 * of the project's default branch, the paths it governs changed in `commits` while the entry did
 * not. Full commit ids, repository-relative paths, at most 50 of each.
 */
export const PeerKnowledgeDrift = Schema.Struct({
  head: Schema.String,
  commits: Schema.Array(Schema.String),
  paths: Schema.Array(Schema.String),
});
export type PeerKnowledgeDrift = typeof PeerKnowledgeDrift.Type;

/**
 * A challenge of an entry of a project's knowledge: agents or people said it may no longer hold,
 * or the code it governs changed under it (`drift`). The Hub counts the agents that said so on
 * their own (`finders`) and names the people who opened or seconded it; people dismiss it, confirm
 * that it still holds, or resolve it by superseding or retiring the entry in Git.
 */
export const PeerKnowledgeChallenge = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  /** The entry's kontext id. */
  entry: Schema.String,
  reason: Schema.String,
  sources: Schema.Array(PeerCandidateSource),
  finders: Schema.Number,
  people: Schema.Array(Schema.String),
  status: Schema.Literals(["open", "dismissed", "resolving", "resolved"]),
  decidedBy: Schema.optional(Schema.String),
  decidedAt: Schema.optional(Schema.String),
  reopened: Schema.optional(Schema.Boolean),
  /** The entry's revision as the first client that knew it saw it. */
  entryRevision: Schema.optional(Schema.String),
  /**
   * The superseding entry, the retired entry itself, or the entry confirmed (`kind: confirmed`),
   * once staged.
   */
  resolvedAs: Schema.optional(PeerKeptAs),
  /** What kontext's drift found, when a member's Peer filed it after the default branch advanced. */
  drift: Schema.optional(PeerKnowledgeDrift),
  firstAt: Schema.String,
  lastAt: Schema.String,
});
export type PeerKnowledgeChallenge = typeof PeerKnowledgeChallenge.Type;

/** The challenged entry as this computer's checkout has it now. */
export const PeerChallengedEntry = Schema.Struct({
  title: Schema.String,
  kind: Schema.String,
  file: Schema.String,
  summary: Schema.String,
  body: Schema.String,
  status: Schema.optional(Schema.String),
  /** `publication.revision`, when kontext gives one. */
  revision: Schema.optional(Schema.String),
  /** When someone last confirmed it still holds (`checked`: YYYY-MM-DD, or a UTC second from kontext 0.4.1), when they did. */
  checked: Schema.optional(Schema.String),
});
export type PeerChallengedEntry = typeof PeerChallengedEntry.Type;

/** Whether this computer can stage a replacement or retirement, and why not. */
export const PeerChallengeAction = Schema.Struct({
  available: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
});
export type PeerChallengeAction = typeof PeerChallengeAction.Type;

export const PeerChallengeRow = Schema.Struct({
  challenge: PeerKnowledgeChallenge,
  /** Null when the entry is not in this computer's checkout: only Resolve is offered then. */
  current: Schema.NullOr(PeerChallengedEntry),
  /** The entry's revision differs from the one challenged: re-read it before acting. */
  changed: Schema.Boolean,
  /** A drift's commits this checkout has, with their subjects. */
  commits: Schema.optional(
    Schema.Array(Schema.Struct({ sha: Schema.String, subject: Schema.String })),
  ),
});
export type PeerChallengeRow = typeof PeerChallengeRow.Type;

/** A project's challenges, open first, with what this computer can do about them. */
export const PeerKnowledgeChallenges = Schema.Struct({
  /** Refine the search when the engine reached its bounded content result limit. */
  searchLimited: Schema.optional(Schema.Boolean),
  rows: Schema.Array(PeerChallengeRow),
  replace: PeerChallengeAction,
  retire: PeerChallengeAction,
  /** Whether "Still holds" can stage a confirmation here; absent where the Hub takes none. */
  confirm: Schema.optional(PeerChallengeAction),
  /** The active entries a person can challenge, newest first. */
  entries: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      kind: Schema.String,
      summary: Schema.optional(Schema.String),
      paths: Schema.optional(Schema.Array(Schema.String)),
      tags: Schema.optional(Schema.Array(Schema.String)),
      /** A bounded excerpt around the search match. */
      snippet: Schema.optional(Schema.String),
      /** The day someone last confirmed it still holds, when they did. */
      checked: Schema.optional(Schema.String),
    }),
  ),
});
export type PeerKnowledgeChallenges = typeof PeerKnowledgeChallenges.Type;

/** A challenge's reason, as one line. */
export const PEER_CHALLENGE_REASON_MAX = 300;

/** A person opens a challenge of an entry, or seconds the one it has. */
export const PeerHubOpenChallengeInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  entry: TrimmedNonEmptyString.check(Schema.isMaxLength(124)),
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(PEER_CHALLENGE_REASON_MAX)),
});
export type PeerHubOpenChallengeInput = typeof PeerHubOpenChallengeInput.Type;

/** A replacement entry as kontext drafted it and the person edited it. */
export const PeerChallengeDraft = Schema.Struct({
  kind: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(PEER_KEPT_TEXT_MAX * 4)),
  summary: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  paths: Schema.Array(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
});
export type PeerChallengeDraft = typeof PeerChallengeDraft.Type;

export const PeerHubChallengeInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  /** The entry's revision the person read, when it changed since it was challenged. */
  seenRevision: Schema.optional(Schema.String),
});
export type PeerHubChallengeInput = typeof PeerHubChallengeInput.Type;

/** kontext's draft of a replacement that answers the challenge's reasons. */
export const PeerChallengeDrafted = Schema.Struct({
  draft: PeerChallengeDraft,
  notes: Schema.Array(Schema.String),
});
export type PeerChallengeDrafted = typeof PeerChallengeDrafted.Type;

/**
 * What a person does with a challenge: dismiss it ("it still holds"), open it again, mark it
 * resolved (a committed change outside Peer, or an entry this checkout no longer has), retire the
 * entry, replace it with `draft`, or confirm that it still holds (`confirmed`, which stamps the
 * entry checked today). Retiring, replacing and confirming stage a change and leave the challenge
 * resolving until a committed revision shows it.
 */
export const PeerHubDecideChallengeInput = Schema.Struct({
  ...PeerHubChallengeInput.fields,
  decision: Schema.Literals(["dismissed", "open", "resolved", "retire", "replace", "confirmed"]),
  draft: Schema.optional(PeerChallengeDraft),
});
export type PeerHubDecideChallengeInput = typeof PeerHubDecideChallengeInput.Type;

/** A decision's outcome: what was staged, if anything. */
export const PeerChallengeDecided = Schema.Struct({
  challenge: PeerKnowledgeChallenge,
  staged: Schema.NullOr(PeerStagedEntry),
});
export type PeerChallengeDecided = typeof PeerChallengeDecided.Type;
