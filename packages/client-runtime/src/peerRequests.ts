import type { PeerHubStatus } from "@t3tools/contracts";
/** Hub data is person-owned; switching the selected environment never changes its recipient. */
export function incomingPeerRequests(
  status: Pick<PeerHubStatus, "signedIn" | "email" | "requests"> | null | undefined,
) {
  if (!status?.signedIn || status.email === null) return [];
  return (status.requests ?? []).filter(
    ({ request }) => request.recipient === status.email && request.status === "pending",
  );
}
