import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Agent runs: one attempt of one agent on one task, from its start until it ends or is handed off.
 * A run outlives the provider sessions inside it (a `--resume`, a crash, a pane restart), so the
 * task keeps its work whatever the harness does. The Hub keeps runs (its `runs` feature); `state`
 * is derived there from `endedAt` and the live sessions, never stored on its own.
 */

/** `running` while a session in it is live, `detached` once all ended, `ended` with `endedAt`. */
export const PeerRunState = Schema.Literals(["running", "detached", "ended"]);
export type PeerRunState = typeof PeerRunState.Type;

/** Where the run's agent lives, which decides how a person can open or continue it. */
export const PeerRunRuntime = Schema.Literals(["terminal", "herdr", "peer", "mcp"]);
export type PeerRunRuntime = typeof PeerRunRuntime.Type;

export const PeerRunOutcome = Schema.Literals(["handed-off", "done", "stopped", "task-closed"]);
export type PeerRunOutcome = typeof PeerRunOutcome.Type;

/** A provider session inside a run: `<agent>:<native id>`, with when it joined and left. */
export const PeerRunSession = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  to: Schema.optional(Schema.String),
});
export type PeerRunSession = typeof PeerRunSession.Type;

export const PeerRun = Schema.Struct({
  /** `run_` and the 20 Crockford base-32 characters of a ULID, so ids sort by start. */
  id: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  /** The task's id, never its key: a person may change the key. */
  task: Schema.String,
  /** The person every agent of the run acts as. */
  email: Schema.String,
  /** The Peer that minted it; only that Peer writes it. */
  environment: Schema.String,
  /** The harness (`claude`, `codex`), or an editor id for an MCP session: an open vocabulary. */
  agent: Schema.String,
  runtime: PeerRunRuntime,
  /** `peer:<thread id>` when the runtime is `peer`. */
  thread: Schema.optional(Schema.String),
  startedAt: Schema.String,
  endedAt: Schema.optional(Schema.String),
  state: PeerRunState,
  outcome: Schema.optional(PeerRunOutcome),
  /** Oldest first; the Hub keeps the newest 20 and counts the rest in `sessionsBefore`. */
  sessions: Schema.Array(PeerRunSession),
  sessionsBefore: Schema.Number,
  /** What created it (startAgent's `requestId`, the menu's nonce), so a retry creates no second run. */
  requestId: Schema.optional(Schema.String),
});
export type PeerRun = typeof PeerRun.Type;

/** How many of a task's runs are in each state, as the work view carries them per task. */
export const PeerRunCounts = Schema.Struct({
  running: Schema.Number,
  detached: Schema.Number,
  ended: Schema.Number,
});
export type PeerRunCounts = typeof PeerRunCounts.Type;

/** A project's runs, or one task's. */
export const PeerHubRunsInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  taskId: Schema.optional(TrimmedNonEmptyString),
});
export type PeerHubRunsInput = typeof PeerHubRunsInput.Type;

export const PeerHubRunsResult = Schema.Struct({ runs: Schema.Array(PeerRun) });
export type PeerHubRunsResult = typeof PeerHubRunsResult.Type;

/** Its person, or a lead or admin, ends a run: the Hub decides who may. */
export const PeerHubEndRunInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
});
export type PeerHubEndRunInput = typeof PeerHubEndRunInput.Type;

/** Starts a new session in a detached run on the Peer that minted it. */
export const PeerHubContinueRunInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
});
export type PeerHubContinueRunInput = typeof PeerHubContinueRunInput.Type;

/** Whether a session started; `reason` says why not, in words for a person. */
export const PeerHubContinueRunResult = Schema.Struct({
  started: Schema.Boolean,
  reason: Schema.optional(Schema.String),
});
export type PeerHubContinueRunResult = typeof PeerHubContinueRunResult.Type;
