import * as Schema from "effect/Schema";
import { PeerGitHubEvidence } from "./github.ts";

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
  github: Schema.optional(PeerGitHubEvidence),
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

/** One step of an agent's work, read from its own transcript. */
export const PeerAgentEntry = Schema.Union([
  /** What a person asked. */
  Schema.Struct({ id: Schema.String, kind: Schema.Literal("prompt"), text: Schema.String }),
  /** What the agent said. */
  Schema.Struct({ id: Schema.String, kind: Schema.Literal("text"), text: Schema.String }),
  /** A tool it used, e.g. `Read src/pay.ts` or `$ npm test`, with the start of its result. */
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("tool"),
    name: Schema.String,
    summary: Schema.String,
    result: Schema.optional(Schema.String),
    failed: Schema.Boolean,
  }),
]);
export type PeerAgentEntry = typeof PeerAgentEntry.Type;

/**
 * One of this computer's threads as people watch it (a Peer thread, or an agent herdr runs): its
 * work so far, and whether it is still there.
 */
export const PeerAgentView = Schema.Struct({
  agentId: Schema.String,
  title: Schema.String,
  status: PeerWorkStatus,
  agent: Schema.optional(Schema.String),
  paneId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  /** Its work from its own transcript, newest last, when Peer knows its session. */
  entries: Schema.optional(Schema.Array(PeerAgentEntry)),
  /** Otherwise the end of its terminal. */
  terminal: Schema.optional(Schema.String),
  /** What would let Peer show the transcript instead of the terminal. */
  hint: Schema.optional(Schema.String),
  /** The agent no longer runs in herdr. */
  gone: Schema.Boolean,
});
export type PeerAgentView = typeof PeerAgentView.Type;

/**
 * Where a failed call to the Hub stopped, so a client can say what to do instead of showing one
 * message for everything:
 *
 * - `unreachable`: no answer came: the network failed, or the Hub stayed silent past the wait.
 * - `refused`: the Hub answered with an error status (its own message is the `detail`).
 * - `invalid`: it answered with something Peer could not read: not JSON, or a shape it does not know.
 * - `signedOut`: the Hub no longer accepts the stored session, or there is none.
 * - `unsupported`: the Hub has no such route; it predates the feature or runs without it.
 */
export const PEER_HUB_FAILURE_KINDS = [
  "unreachable",
  "refused",
  "invalid",
  "signedOut",
  "unsupported",
] as const;
export type PeerHubFailureKind = (typeof PEER_HUB_FAILURE_KINDS)[number];

export const isPeerHubFailureKind = (value: unknown): value is PeerHubFailureKind =>
  PEER_HUB_FAILURE_KINDS.some((kind) => kind === value);

/**
 * The error every Peer request fails with. `detail` is the message, and the only field an older
 * client reads. The fields after `refused` are optional and travel with it: an older Peer on either
 * side of the wire ignores them or does not send them, so a client never relies on one being there.
 */
export class PeerHubError extends Schema.TaggedError<PeerHubError>()("PeerHubError", {
  code: Schema.optional(Schema.String),
  detail: Schema.String,
  refused: Schema.optional(Schema.Boolean),
  /**
   * A `PeerHubFailureKind`. An open string on the wire: a failure a newer Peer tells apart in a way
   * this one does not decodes like any other, and `isPeerHubFailureKind` says whether it is known.
   */
  kind: Schema.optional(Schema.String),
  /** The HTTP status the Hub answered with, when it answered. */
  status: Schema.optional(Schema.Number),
  /** The Hub that was asked. */
  hubUrl: Schema.optional(Schema.String),
  /** What was asked of it, e.g. `GET /v1/workspaces/acme/candidates/pay`. */
  request: Schema.optional(Schema.String),
  /** How long the call waited, in milliseconds, when it ended because no answer came. */
  waitedMs: Schema.optional(Schema.Number),
}) {
  override get message(): string {
    return this.detail;
  }
}
