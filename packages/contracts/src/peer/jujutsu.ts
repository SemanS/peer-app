import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Jujutsu workspaces on the wire: the state of jj on this computer, its operation log, undo, and
 * the two moves a person starts from a card (build on another change, integrate two). Everything
 * here is local to the environment: the plugin has no Hub feature, so it works with any Hub. Names
 * on the wire never change; vocabularies that grow are plain strings.
 */
export const PEER_JUJUTSU_PLUGIN = {
  id: "jujutsu",
  title: "Jujutsu workspaces",
  summary:
    "Agents in Jujutsu repositories snapshot after every step, cannot rewrite each other's changes, can follow a teammate's change, and a person can undo one step.",
  defaultEnabled: true,
} as const;

/** The oldest jj Peer reads; an older one is "Problem with the version". */
export const PEER_JUJUTSU_MIN_VERSION = "0.46.0";

/**
 * jj on this computer, as Settings says it in Peer's connection words: `notAvailable` when jj is
 * missing or older than the minimum, `off` when the plugin is off, `connected` otherwise.
 * `problem` is a checkout Peer cannot use yet (not colocated); the project ids are in `notColocated`.
 */
export const JujutsuConnection = Schema.Literals(["connected", "off", "notAvailable", "problem"]);
export type JujutsuConnection = typeof JujutsuConnection.Type;

/** Why jj is not usable, so a page names the cause and the fix. */
export const JujutsuProblem = Schema.Literals(["missing", "tooOld", "notColocated"]);
export type JujutsuProblem = typeof JujutsuProblem.Type;

/** The status field (`jujutsu`, omitted while the plugin is inactive): ids and counts only. */
export const JujutsuState = Schema.Struct({
  connection: JujutsuConnection,
  problem: Schema.optional(JujutsuProblem),
  /** jj's version when it answered, such as `0.46.0`. */
  version: Schema.optional(Schema.String),
  agentWorkspaces: NonNegativeInt,
  /** Agents' changes are read-only to each other's workspaces (the default). */
  protection: Schema.Boolean,
  /** Projects whose checkout is a jj repository without a `.git` beside it. */
  notColocated: Schema.optional(Schema.Array(Schema.String)),
  checkedAt: Schema.optional(Schema.String),
});
export type JujutsuState = typeof JujutsuState.Type;

/** The payload of `peer.jujutsu.configure`. */
export const JujutsuSettings = Schema.Struct({ protection: Schema.optional(Schema.Boolean) });
export type JujutsuSettings = typeof JujutsuSettings.Type;

/** A project's checkout on this computer. */
export const JujutsuPlace = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
});
export type JujutsuPlace = typeof JujutsuPlace.Type;

/**
 * One operation of the repository's log. `user` is jj's `operation.username` as written: a person,
 * `<person>·<agent>` for an agent, or `peer·follow` / `peer·check` for Peer's own steps; clients
 * read it with `operationActor`. `changed` lists the change ids it changed (empty when Peer could
 * not read them).
 */
export const JujutsuOperation = Schema.Struct({
  id: Schema.String,
  time: Schema.String,
  user: Schema.String,
  workspace: Schema.optional(Schema.String),
  description: Schema.String,
  /** The command that ran, as jj records it. */
  args: Schema.String,
  changed: Schema.Array(Schema.String),
});
export type JujutsuOperation = typeof JujutsuOperation.Type;

/**
 * Newest first, at most 50. `changedUnread` is set when Peer could not read what steps changed
 * (jj's output moved): undo still works but its preview says so.
 */
export const JujutsuOperations = Schema.Struct({
  operations: Schema.Array(JujutsuOperation).check(Schema.isMaxLength(50)),
  changedUnread: Schema.optional(Schema.Boolean),
});
export type JujutsuOperations = typeof JujutsuOperations.Type;

export const JujutsuOperationInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  operation: TrimmedNonEmptyString,
});
export type JujutsuOperationInput = typeof JujutsuOperationInput.Type;

/** What a person sees before an undo: the step, the later steps that touched its changes, the commands. */
export const UndoPreview = Schema.Struct({
  operation: JujutsuOperation,
  /** Later operations whose changed ids intersect the step's own, oldest first. */
  later: Schema.Array(JujutsuOperation),
  /** The change ids both touched: the ones Peer converges afterwards. */
  shared: Schema.Array(Schema.String),
  /** The commands Peer will run, in order. */
  commands: Schema.Array(Schema.String),
  /** Peer could not read what later steps changed, so `later` may be incomplete. */
  changedUnread: Schema.optional(Schema.Boolean),
});
export type UndoPreview = typeof UndoPreview.Type;

export const UndoResult = Schema.Struct({
  /** The operation that was reverted. */
  reverted: Schema.String,
  /** What ran. */
  ran: Schema.Array(Schema.String),
  converged: Schema.Array(Schema.String),
  /** Changes left with two versions because the merge needs a person's choice. */
  needsPerson: Schema.Array(Schema.String),
});
export type UndoResult = typeof UndoResult.Type;

/** A change as `jj log` shows it in the project's revset, at an operation. */
export const AtOpRow = Schema.Struct({
  changeId: Schema.String,
  commitId: Schema.String,
  parents: Schema.Array(Schema.String),
  subject: Schema.String,
  paths: Schema.Array(Schema.String),
  bookmarks: Schema.Array(Schema.String),
  conflict: Schema.Boolean,
  empty: Schema.Boolean,
  divergent: Schema.Boolean,
});
export type AtOpRow = typeof AtOpRow.Type;

/** The project's changes right after an operation, read with `--at-op` and no snapshot. */
export const AtOpRows = Schema.Struct({
  operation: Schema.String,
  rows: Schema.Array(AtOpRow).check(Schema.isMaxLength(100)),
});
export type AtOpRows = typeof AtOpRows.Type;

/**
 * Move an agent session's own changes onto another task's newest change (`task`), or back onto
 * trunk (`stop`). The session is the one that works in this environment.
 */
export const JujutsuFollowInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  session: TrimmedNonEmptyString,
  task: Schema.optional(TrimmedNonEmptyString),
  stop: Schema.optional(Schema.Boolean),
});
export type JujutsuFollowInput = typeof JujutsuFollowInput.Type;

export const JujutsuFollowResult = Schema.Struct({
  /** The session's change that moved. */
  change: Schema.String,
  /** The change it now builds on; absent after `stop`. */
  onto: Schema.optional(Schema.String),
  /** jj's own output lines. */
  output: Schema.Array(Schema.String),
  /** Files that now hold a stored conflict in the session's change. */
  conflicts: Schema.Array(Schema.String),
});
export type JujutsuFollowResult = typeof JujutsuFollowResult.Type;

/** One side of an integration: a task and the revision (change id or bookmark) of its work. */
export const JujutsuIntegrateSide = Schema.Struct({
  task: TrimmedNonEmptyString,
  rev: TrimmedNonEmptyString,
});
export type JujutsuIntegrateSide = typeof JujutsuIntegrateSide.Type;

/** Make a change with both sides as parents, for the later side's task to resolve on top of. */
export const JujutsuIntegrateInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  a: JujutsuIntegrateSide,
  b: JujutsuIntegrateSide,
  /** Whose task starts the agent on the integration: the side started later. */
  later: Schema.Literals(["a", "b"]),
});
export type JujutsuIntegrateInput = typeof JujutsuIntegrateInput.Type;

export const JujutsuIntegrateResult = Schema.Struct({
  change: Schema.String,
  /** `peer/integrate/<K1>-<K2>`, which herdr's launcher takes as the base. */
  bookmark: Schema.String,
  /** The task to start the agent for. */
  task: Schema.String,
});
export type JujutsuIntegrateResult = typeof JujutsuIntegrateResult.Type;
