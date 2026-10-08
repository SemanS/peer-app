import { WS_METHODS, type PeerHubStatus } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

/** Hub data is person-owned; switching the selected environment never changes its recipient. */
export function incomingPeerRequests(
  status: Pick<PeerHubStatus, "signedIn" | "email" | "requests"> | null | undefined,
) {
  if (!status?.signedIn || status.email === null) return [];
  return (status.requests ?? []).filter(
    ({ request }) => request.recipient === status.email && request.status === "pending",
  );
}

/** Sending a teammate a request, and dismissing one sent to you. */
export function createPeerRequestsAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerHubSendRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:send-request",
      tag: WS_METHODS.peerHubSendRequest,
    }),
    peerHubDismissRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:dismiss-request",
      tag: WS_METHODS.peerHubDismissRequest,
    }),
  };
}
