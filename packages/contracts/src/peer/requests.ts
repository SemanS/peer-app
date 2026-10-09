import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Team requests: a member asks a teammate, in the teammate's Needs you, to start their agent on a
 * task. The Hub keeps each request until its recipient accepts or dismisses it.
 */

/** A member-to-member request. Acceptance is ownership, not proof an agent ran. */
export const PeerAgentRequest = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  task: Schema.String,
  sender: Schema.String,
  recipient: Schema.String,
  title: Schema.String,
  prompt: Schema.String,
  status: Schema.Literals(["pending", "accepted", "dismissed"]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  expiresAt: Schema.optional(Schema.String),
  /** Future closing reasons must remain readable by older clients. */
  closedBy: Schema.optional(Schema.String),
  replayed: Schema.optional(Schema.Boolean),
});
export type PeerAgentRequest = typeof PeerAgentRequest.Type;

export const PeerHubSendRequestInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  op: TrimmedNonEmptyString,
  recipient: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  task: Schema.optional(TrimmedNonEmptyString),
});
export type PeerHubSendRequestInput = typeof PeerHubSendRequestInput.Type;

export const PeerHubDismissRequestInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  requestId: TrimmedNonEmptyString,
});
export type PeerHubDismissRequestInput = typeof PeerHubDismissRequestInput.Type;

export const PeerHubWithdrawRequestInput = PeerHubDismissRequestInput;
export type PeerHubWithdrawRequestInput = typeof PeerHubWithdrawRequestInput.Type;

/** The compatible wire status plus who closed an unanswered request. */
export function peerRequestOutcome(request: PeerAgentRequest) {
  if (request.status !== "dismissed") return request.status;
  return request.closedBy === "sender"
    ? "withdrawn"
    : request.closedBy === "expiry"
      ? "expired"
      : "dismissed";
}
