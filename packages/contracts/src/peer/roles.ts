import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Peer's roles plugin: what an agent session is for (the Hub's `roles` feature). A review session
 * (role `review`) reads, runs commands and reports what it found; Peer denies its edits and landing
 * steps, and the Hub refuses its `peer review` and `peer done`. A role belongs to one agent session
 * and ends with it. Rows mirror the Hub's wire contract field for field (camelCase, times as RFC 3339
 * strings). A role and its setter are plain strings in rows, so an app reads a newer Hub's; the
 * values known today are listed beside them.
 *
 * `commandNames` (`peer role`) is not here: the plugin names its commands where it defines them.
 */
export const PEER_ROLES_PLUGIN = {
  id: "roles",
  title: "Review sessions",
  summary:
    "A session started to review changes nothing and lands nothing, and the team sees it reviewing.",
  defaultEnabled: true,
  hubFeature: { id: "roles", revision: 1 },
} as const;

/** The roles a person or an agent can give a session today. */
export const PEER_SESSION_ROLES = ["review"] as const;
export const PeerSessionRole = Schema.Literals(PEER_SESSION_ROLES);
export type PeerSessionRole = typeof PeerSessionRole.Type;

/** Who gave a session its role: its `person` in Peer, or the `agent` itself while it was clean. */
export const PEER_ROLE_SETTERS = ["person", "agent"] as const;

/**
 * One session's role, as the Hub keeps it: by its run (`rl:{slug}:{project}:{run}`) when the
 * session carries one, so a new session of the run keeps it, else by session.
 */
export const PeerRoleRow = Schema.Struct({
  /** `claude:<id>` or `codex:<id>`, as coordination reports it. */
  session: Schema.String,
  /** One of `PEER_SESSION_ROLES`. */
  role: Schema.String,
  /** The session's person. */
  email: Schema.String,
  /** The computer that reported the session. */
  environment: Schema.String,
  /** One of `PEER_ROLE_SETTERS`. */
  setBy: Schema.String,
  at: Schema.String,
  /** Its reported files changed through the shell while it had the role; content-free. */
  changedFiles: Schema.optional(Schema.Boolean),
  /** The run the role belongs to, from a Hub that keys roles by run (`roles` revision 3). */
  run: Schema.optional(Schema.String),
});
export type PeerRoleRow = typeof PeerRoleRow.Type;

/** A project's roles as this computer last read them from the Hub, and when (RFC 3339). */
export const PeerRolesProject = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  at: Schema.String,
  roles: Schema.Array(PeerRoleRow),
});
export type PeerRolesProject = typeof PeerRolesProject.Type;

/**
 * A thread a person started as a review (or gave the role in its header) before its agent session
 * reported: its sessions take the role when they start. `thread` is the work report's thread key.
 */
export const PeerRolesThread = Schema.Struct({
  thread: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  role: Schema.String,
  at: Schema.String,
});
export type PeerRolesThread = typeof PeerRolesThread.Type;

/** The plugin's status slice: counts and ids only, no text. */
export const PeerRolesStatus = Schema.Struct({
  projects: Schema.Array(PeerRolesProject),
  threads: Schema.Array(PeerRolesThread),
});
export type PeerRolesStatus = typeof PeerRolesStatus.Type;

/** A person gives one of their sessions, or one of their threads, a role: `session` or `thread`. */
export const PeerRolesSetInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  role: PeerSessionRole,
  session: Schema.optional(TrimmedNonEmptyString),
  thread: Schema.optional(TrimmedNonEmptyString),
});
export type PeerRolesSetInput = typeof PeerRolesSetInput.Type;

/** A person clears the role of one of their sessions, or of a thread's sessions. */
export const PeerRolesClearInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  session: Schema.optional(TrimmedNonEmptyString),
  thread: Schema.optional(TrimmedNonEmptyString),
});
export type PeerRolesClearInput = typeof PeerRolesClearInput.Type;

export const PeerRolesListInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
});
export type PeerRolesListInput = typeof PeerRolesListInput.Type;

/** Start a review: an agent on a task, in its own checkout, whose sessions take the role `review`. */
export const PeerRolesStartReviewInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  taskId: TrimmedNonEmptyString,
  repositoryId: TrimmedNonEmptyString,
  harness: Schema.Literals(["claude", "codex"]),
  baseBranch: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
});
export type PeerRolesStartReviewInput = typeof PeerRolesStartReviewInput.Type;

export const PeerRolesStartReviewResult = Schema.Struct({
  thread: Schema.String,
  /** The run Peer created for it. */
  run: Schema.optional(Schema.String),
  paneId: Schema.String,
  terminalId: Schema.String,
  promptError: Schema.optional(Schema.String),
});
export type PeerRolesStartReviewResult = typeof PeerRolesStartReviewResult.Type;
