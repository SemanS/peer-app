import { canWithdraw, expiresIn, requestOutcome } from "@t3tools/client-runtime/peer/requests";
import type { PeerAgentRequest } from "@t3tools/contracts";
export function expiryLabel(request: PeerAgentRequest, now: number) {
  if (request.status !== "pending") return undefined;
  const text = expiresIn(request, now);
  return text === undefined
    ? undefined
    : `Expires ${text === "today" || text === "tomorrow" ? text : `in ${text}`}`;
}
export const requestRow = (request: PeerAgentRequest, email: string | null, now: number) => ({
  outcome: requestOutcome(request),
  withdraw: canWithdraw(request, email),
  expiry: expiryLabel(request, now),
});

/** How the sender reads a request's state: waiting, accepted, declined, withdrawn or expired. */
export function sentOutcome(request: PeerAgentRequest): {
  readonly label: string;
  readonly badge: "team" | "success" | "secondary";
} {
  switch (requestOutcome(request)) {
    case "pending":
      return { label: "Waiting", badge: "team" };
    case "accepted":
      return { label: "Accepted", badge: "success" };
    case "dismissed":
      return { label: "Declined", badge: "secondary" };
    case "withdrawn":
      return { label: "Withdrawn", badge: "secondary" };
    case "expired":
      return { label: "Expired", badge: "secondary" };
  }
}
