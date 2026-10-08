import * as Schema from "effect/Schema";

/**
 * Schemas Peer's core and its plugins share: the error every Peer request fails with, and the
 * vocabulary of work (tasks, threads, their status). Plugin contracts import these from here, never
 * from `../peerHub.ts`, so no import cycle can form; `peerHub.ts` re-exports them.
 */

/** Agent runtime families a workspace project may allow, named as the hub names them. */
export const PeerHarness = Schema.Literals([
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "antigravity",
]);
export type PeerHarness = typeof PeerHarness.Type;

export const PeerCurrency = Schema.Literals(["EUR", "USD"]);
export type PeerCurrency = typeof PeerCurrency.Type;

/** The period a shared-capacity budget is counted over. */
export const PeerBudgetPeriod = Schema.Literals(["day", "week", "month"]);
export type PeerBudgetPeriod = typeof PeerBudgetPeriod.Type;

/** What an agent thread is doing: ● working, ◐ blocked (needs an answer), ✓ done, ○ idle. */
export const PeerWorkStatus = Schema.Literals(["working", "blocked", "done", "idle", "unknown"]);
export type PeerWorkStatus = typeof PeerWorkStatus.Type;

/** Delivery outlives a runtime. A stopped agent is still unfinished work. */
export const PeerWorkDelivery = Schema.Literals(["open", "review", "merged", "closed"]);
export type PeerWorkDelivery = typeof PeerWorkDelivery.Type;

export const PeerWorkPullRequest = Schema.Struct({
  url: Schema.String,
  state: Schema.Literals(["open", "closed", "merged", "unknown"]),
  headBranch: Schema.String,
});
export type PeerWorkPullRequest = typeof PeerWorkPullRequest.Type;

/** A piece of the product being built, e.g. `KRK-812 · Split Payments` under "Groups & Events". */
export const PeerTask = Schema.Struct({
  id: Schema.String,
  /** The tracker's key; a branch or title naming it attaches the thread. */
  key: Schema.optional(Schema.String),
  title: Schema.String,
  area: Schema.optional(Schema.String),
  status: Schema.Literals(["open", "review", "done"]),
  createdBy: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PeerTask = typeof PeerTask.Type;

/** A colleague's (or another computer's) agent thread; the person is metadata, not a level. */
export const PeerWorkThread = Schema.Struct({
  id: Schema.String,
  task: Schema.optional(Schema.String),
  title: Schema.String,
  email: Schema.String,
  status: PeerWorkStatus,
  harness: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  source: Schema.Literals(["peer", "herdr"]),
  environment: Schema.String,
  seenAt: Schema.String,
  /** Its owner lets the project's members watch it live (Observe). */
  observable: Schema.optional(Schema.Boolean),
  runtimePresent: Schema.optional(Schema.Boolean),
  previousId: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  pullRequests: Schema.optional(Schema.Array(PeerWorkPullRequest)),
  delivery: Schema.optional(PeerWorkDelivery),
});
export type PeerWorkThread = typeof PeerWorkThread.Type;

export class PeerHubError extends Schema.TaggedError<PeerHubError>()("PeerHubError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
