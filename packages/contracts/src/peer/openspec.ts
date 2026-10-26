import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";

export const PEER_OPENSPEC_PLUGIN = {
  id: "openspec",
  title: "OpenSpec",
  summary: "Read a task's current OpenSpec change and prepare its agent prompt.",
  defaultEnabled: true,
} as const;

const Identifier = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

export const PeerOpenSpecReadInput = Schema.Struct({
  workspace: Identifier,
  projectId: Identifier,
  taskId: Identifier,
  repositoryId: Schema.optional(Identifier),
});
export type PeerOpenSpecReadInput = typeof PeerOpenSpecReadInput.Type;

// A task's own brief, kept by the Hub's `briefs` feature: what an agent starts from when its
// OpenSpec change was archived, renamed or never existed. OpenSpec only refreshes it.
const ChangeName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,199}$/i));

export const PeerBriefChecklistItem = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(500)),
  done: Schema.Boolean,
});
export type PeerBriefChecklistItem = typeof PeerBriefChecklistItem.Type;

export const PeerBriefSource = Schema.Struct({
  kind: Schema.Literal("openspec"),
  repository: Schema.String,
  change: ChangeName,
  /** SHA-256 of `proposal.md`, a NUL and `tasks.md`, as the brief was taken. */
  fingerprint: Schema.String,
});
export type PeerBriefSource = typeof PeerBriefSource.Type;

export const PeerTaskBrief = Schema.Struct({
  project: Schema.String,
  task: Schema.String,
  goal: Schema.String.check(Schema.isMaxLength(4_000)),
  checklist: Schema.Array(PeerBriefChecklistItem).check(Schema.isMaxLength(200)),
  notes: Schema.optional(Schema.String.check(Schema.isMaxLength(8_000))),
  source: Schema.optional(PeerBriefSource),
  savedBy: Schema.String,
  savedAt: Schema.String,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type PeerTaskBrief = typeof PeerTaskBrief.Type;

/**
 * How a task's brief relates to its OpenSpec change on this environment. `proposed`: no brief yet,
 * and the repository names a change a person may link; `none`: no brief and nothing to propose.
 */
export const PeerBriefLinkState = Schema.Literals([
  "current",
  "changed",
  "archived",
  "missing",
  "unlinked",
  "unreadable",
  "proposed",
  "none",
]);
export type PeerBriefLinkState = typeof PeerBriefLinkState.Type;

export const PeerBriefLink = Schema.Struct({
  state: PeerBriefLinkState,
  /** False while the signed-in Hub does not keep briefs: then nothing can be linked or saved. */
  served: Schema.Boolean,
  brief: Schema.NullOr(PeerTaskBrief),
  /** The change a person may link, and how the repository names it. */
  proposed: Schema.optional(
    Schema.Struct({ change: Schema.String, via: Schema.Literals(["mapping", "name"]) }),
  ),
  /** The repository's own mapping, when it names another change than the saved link. */
  mappingDiffers: Schema.optional(Schema.String),
  /** Where `openspec archive` moved the linked change, below `openspec/changes/archive/`. */
  archivedAs: Schema.optional(Schema.String),
  /** The repository's current changes, to link another one; absent when it cannot be read. */
  changes: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(500))),
});
export type PeerBriefLink = typeof PeerBriefLink.Type;

/** The live change as a brief would hold it, for linking and for showing what changed. */
export const PeerOpenSpecSnapshot = Schema.Struct({
  goal: Schema.String,
  checklist: Schema.Array(PeerBriefChecklistItem),
  fingerprint: Schema.String,
});
export type PeerOpenSpecSnapshot = typeof PeerOpenSpecSnapshot.Type;

const BriefTarget = {
  workspace: Identifier,
  projectId: Identifier,
  taskId: Identifier,
  /** The revision the person last read; 0 when there was no brief. */
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};

/** Link a task to a change (or relink, or refresh from the linked one when `change` is absent). */
export const PeerOpenSpecLinkInput = Schema.Struct({
  ...BriefTarget,
  repositoryId: Schema.optional(Identifier),
  change: Schema.optional(ChangeName),
});
export type PeerOpenSpecLinkInput = typeof PeerOpenSpecLinkInput.Type;

/** Keep the brief and drop its source: the task becomes its own. */
export const PeerOpenSpecUnlinkInput = Schema.Struct(BriefTarget);
export type PeerOpenSpecUnlinkInput = typeof PeerOpenSpecUnlinkInput.Type;

/** A person's own brief; saving it drops any source. */
export const PeerOpenSpecSaveBriefInput = Schema.Struct({
  ...BriefTarget,
  goal: Schema.String.check(Schema.isMaxLength(4_000)),
  checklist: Schema.Array(PeerBriefChecklistItem).check(Schema.isMaxLength(200)),
  notes: Schema.optional(Schema.String.check(Schema.isMaxLength(8_000))),
});
export type PeerOpenSpecSaveBriefInput = typeof PeerOpenSpecSaveBriefInput.Type;

export const PeerOpenSpecReadResult = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("ready"),
    link: Schema.optional(PeerBriefLink),
    snapshot: Schema.optional(PeerOpenSpecSnapshot),
    repositoryId: Schema.String,
    changeId: Schema.String,
    sourcePath: Schema.String,
    proposal: Schema.String,
    tasks: Schema.String,
    design: Schema.NullOr(Schema.String),
    prompt: Schema.String.check(Schema.isMaxLength(20_000)),
    completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  /** The saved brief is authoritative: it is unlinked, or its live source cannot be read. */
  Schema.Struct({
    state: Schema.Literal("brief"),
    repositoryId: Schema.String,
    link: PeerBriefLink,
    reason: Schema.String,
    prompt: Schema.String.check(Schema.isMaxLength(20_000)),
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    code: Schema.Literals(["not-linked", "source-unavailable"]),
    reason: Schema.String,
    link: Schema.optional(PeerBriefLink),
  }),
]);
export type PeerOpenSpecReadResult = typeof PeerOpenSpecReadResult.Type;
