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
