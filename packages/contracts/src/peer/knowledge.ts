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
  /**
   * A check its agent ran in that session and whether it passed; absent where the Hub keeps none.
   * Evidence of the finding, never a verification of an entry (that is the ledger's).
   */
  check: Schema.optional(Schema.Struct({ command: Schema.String, passed: Schema.Boolean })),
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
  /**
   * Whether the repository pins its agents' harness memory off itself (`autoMemoryEnabled: false`
   * in a committed `.claude/settings.json`), the one lever that holds when Peer is not running:
   * null when the project is not on this computer; absent from an environment from before it.
   */
  harnessMemoryPinned: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /**
   * kontext here can add a finding to an existing entry (`drafts.extend`, staged with `amends`);
   * absent from an environment from before it, which keeps every finding as a new entry.
   */
  extends: Schema.optional(Schema.Boolean),
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
  /** Whether it became a new entry, was added into `keptAs`, or replaced entries; absent from older servers. */
  way: Schema.optional(Schema.Literals(["new", "amended", "superseding"])),
  /** Why it was kept another way than asked, e.g. a kontext that cannot add to an entry. */
  note: Schema.optional(Schema.String),
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

/** A kept entry at the revision kontext related a finding to, which adding to it re-checks. */
export const PeerKeepTarget = Schema.Struct({
  entry: TrimmedNonEmptyString,
  revision: TrimmedNonEmptyString,
});
export type PeerKeepTarget = typeof PeerKeepTarget.Type;

const keptText = Schema.optional(
  TrimmedNonEmptyString.check(Schema.isMaxLength(PEER_KEPT_TEXT_MAX)),
);
const entryIds = Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(5)));

/**
 * Keeps a candidate, in the person's own words when they edited its text first: as a new entry
 * (linked to the entries it builds on with `extends`), added `into` an existing one, or replacing
 * the entries it `supersedes`. Adding changes one entry in place, so it takes neither links nor
 * replacements.
 */
export const PeerHubKeepCandidateInput = Schema.Struct({
  ...PeerHubCandidateInput.fields,
  text: keptText,
  /** Entries the person chose to replace with it (offered for a possible conflict, never prefilled). */
  supersedes: entryIds,
  /** The entry to add it to, at the revision it was compared with. */
  into: Schema.optional(PeerKeepTarget),
  /** Kept entries the new entry builds on, written into its `extends`. */
  extends: entryIds,
}).check(
  Schema.makeFilter((input) =>
    input.into === undefined || (input.supersedes === undefined && input.extends === undefined)
      ? true
      : "Adding into an entry takes neither supersedes nor extends.",
  ),
);
export type PeerHubKeepCandidateInput = typeof PeerHubKeepCandidateInput.Type;

/** What applying a keep would stage: added into an entry, a new entry, or a replacement. */
export const PeerKeepOperation = Schema.Literals(["add", "new", "supersede"]);
export type PeerKeepOperation = typeof PeerKeepOperation.Type;

/**
 * Asks for what a card shows before anything is staged. `entry` is the entry to add to or replace
 * (required for those), `extends` the links of a new entry, `text` the person's edited words.
 */
export const PeerKnowledgePreviewInput = Schema.Struct({
  ...PeerHubCandidateInput.fields,
  operation: PeerKeepOperation,
  entry: Schema.optional(PeerKeepTarget),
  extends: entryIds,
  text: keptText,
}).check(
  Schema.makeFilter((input) =>
    input.operation === "new" || input.entry !== undefined
      ? true
      : `${input.operation} needs the entry it acts on.`,
  ),
);
export type PeerKnowledgePreviewInput = typeof PeerKnowledgePreviewInput.Type;

/**
 * The draft a card shows and Apply stages: the entry (`path` null for a new entry, whose file
 * kontext names when staging), its body before (`oldBody`, only when adding) and after, the entries
 * it links to or replaces by title, why it reads as the agents wrote it (`asWritten`, null when
 * kontext's model worded it) and the body's word count.
 */
export const PeerKnowledgePreview = Schema.Struct({
  operation: PeerKeepOperation,
  entry: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    title: Schema.String,
    kind: Schema.String,
    path: Schema.NullOr(Schema.String),
  }),
  oldBody: Schema.NullOr(Schema.String),
  body: Schema.String,
  links: Schema.Array(Schema.Struct({ entry: Schema.String, title: Schema.String })),
  asWritten: Schema.NullOr(Schema.String),
  words: Schema.Number,
});
export type PeerKnowledgePreview = typeof PeerKnowledgePreview.Type;

/** The longest conversation excerpt a person may send to be read for what to keep. */
export const PEER_HARVEST_CONVERSATIONS_MAX = 60_000;

/**
 * A task's (or a project's) shared context to read for what the project should keep, or the
 * excerpts of its conversations the person is looking at, read instead of the context.
 */
export const PeerHubHarvestInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  scope: TrimmedNonEmptyString,
  conversations: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PEER_HARVEST_CONVERSATIONS_MAX)),
  ),
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
  /** The entry's revision the relation was computed against, which adding to it re-checks. */
  revision: Schema.optional(Schema.String),
  /** The entry's kind: only a convention, learning or incident is ever added to. */
  kind: Schema.optional(Schema.String),
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
  /**
   * The entry's own check, when the Peer that filed it ran it and it did not pass: its command, exit
   * code (null when it timed out), the end of its output (2 KB at most), the time and the commit.
   * The Hub keeps the latest filing's.
   */
  verify: Schema.optional(
    Schema.Struct({
      passed: Schema.Boolean,
      command: Schema.String,
      exitCode: Schema.NullOr(Schema.Number),
      outputTail: Schema.String,
      at: Schema.String,
      commit: Schema.NullOr(Schema.String),
    }),
  ),
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
   * The superseding entry, the retired entry itself, the entry confirmed (`kind: confirmed`) or
   * whose own check passed (`kind: verified`), once staged.
   */
  resolvedAs: Schema.optional(PeerKeptAs),
  /** What kontext's drift found, when a member's Peer filed it after the default branch advanced. */
  drift: Schema.optional(PeerKnowledgeDrift),
  firstAt: Schema.String,
  lastAt: Schema.String,
});
export type PeerKnowledgeChallenge = typeof PeerKnowledgeChallenge.Type;

/**
 * How an entry was last verified, from kontext's verification ledger: a person's `read`, an
 * `agent`'s or a `bulk` confirmation (stamps, not checks), or its `verify` command run, with
 * `passed`. `commit` is the commit it looked at, `by` who (git `user.name`).
 */
export const PeerKnowledgeVerification = Schema.Struct({
  at: Schema.String,
  kind: Schema.Literals(["read", "agent", "bulk", "verify"]),
  commit: Schema.NullOr(Schema.String),
  by: Schema.NullOr(Schema.String),
  because: Schema.NullOr(Schema.String),
  passed: Schema.NullOr(Schema.Boolean),
  /**
   * The commit in HEAD's history that carries the newest ledger line; null while it is only staged.
   * Absent from a kontext that does not say.
   */
  landed: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PeerKnowledgeVerification = typeof PeerKnowledgeVerification.Type;

/** Commits on an entry's governed paths after its verification commit, and the files they changed (20 at most). */
export const PeerKnowledgeSince = Schema.Struct({
  commits: Schema.Number,
  head: Schema.String,
  paths: Schema.Array(Schema.String),
});
export type PeerKnowledgeSince = typeof PeerKnowledgeSince.Type;

/** An entry this one builds on that is now superseded, retired or deprecated. */
export const PeerKnowledgePremise = Schema.Struct({ id: Schema.String, status: Schema.String });
export type PeerKnowledgePremise = typeof PeerKnowledgePremise.Type;

/** What a kontext with the verification ledger says of an entry; absent from older engines. */
const entryProvenance = {
  verification: Schema.optional(PeerKnowledgeVerification),
  since: Schema.optional(PeerKnowledgeSince),
  /** The shell command the entry names to check itself. */
  verify: Schema.optional(Schema.String),
  premises: Schema.optional(Schema.Array(PeerKnowledgePremise)),
};

/**
 * One step of a flow's trail: the entry a reader meets there, what it settles in one sentence, and
 * the stage heading it stands under (null before the first stage).
 */
export const PeerFlowStep = Schema.Struct({
  stage: Schema.NullOr(Schema.String),
  entry: Schema.String,
  text: Schema.String,
});
export type PeerFlowStep = typeof PeerFlowStep.Type;

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
  ...entryProvenance,
  /**
   * A flow's trail (an architecture entry with id `flow-…` or tagged `flow`), read from its full
   * text so a long one keeps every step; absent from other entries and from older servers.
   */
  trail: Schema.optional(Schema.Array(PeerFlowStep)),
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
      ...entryProvenance,
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
  /** Why it still holds, in one line; kept with a confirmation in kontext's ledger. */
  because: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PEER_CHALLENGE_REASON_MAX)),
  ),
});
export type PeerHubDecideChallengeInput = typeof PeerHubDecideChallengeInput.Type;

/** A decision's outcome: what was staged, if anything. */
export const PeerChallengeDecided = Schema.Struct({
  challenge: PeerKnowledgeChallenge,
  staged: Schema.NullOr(PeerStagedEntry),
});
export type PeerChallengeDecided = typeof PeerChallengeDecided.Type;

/**
 * The outcome of running an entry's `verify` command (kontext's `drafts.verify`): whether it passed,
 * its exit code, the end of its output, and the ledger line's time and commit. Unavailable where
 * this kontext cannot run checks, with why.
 */
export const PeerKnowledgeVerified = Schema.Union([
  Schema.Struct({
    available: Schema.Literal(true),
    passed: Schema.Boolean,
    exitCode: Schema.NullOr(Schema.Number),
    outputTail: Schema.String,
    at: Schema.String,
    commit: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ available: Schema.Literal(false), reason: Schema.String }),
]);
export type PeerKnowledgeVerified = typeof PeerKnowledgeVerified.Type;
