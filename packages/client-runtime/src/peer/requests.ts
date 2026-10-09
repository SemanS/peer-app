import {
  WS_METHODS,
  peerRequestOutcome,
  type PeerAgentRequest,
  type PeerHubStatus,
} from "@t3tools/contracts";
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

export const requestOutcome = peerRequestOutcome;

export function sentPeerRequests(
  status: Pick<PeerHubStatus, "signedIn" | "email" | "requests"> | null | undefined,
  project?: { readonly workspace: string; readonly project: string },
) {
  if (!status?.signedIn || status.email === null) return [];
  return (status.requests ?? [])
    .filter(
      ({ workspace, request }) =>
        request.sender === status.email &&
        (project === undefined ||
          (workspace === project.workspace && request.project === project.project)),
    )
    .sort(
      (a, b) =>
        Number(b.request.status === "pending") - Number(a.request.status === "pending") ||
        b.request.updatedAt.localeCompare(a.request.updatedAt),
    );
}

export const canWithdraw = (request: PeerAgentRequest, email: string | null) =>
  request.sender === email && request.status === "pending" && request.expiresAt !== undefined;

export function expiresIn(request: PeerAgentRequest, nowMs: number) {
  if (request.expiresAt === undefined) return undefined;
  const expiry = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiry)) return undefined;
  const days = Math.max(0, Math.ceil((expiry - nowMs) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days`;
}

export const requestStartInput = (request: PeerAgentRequest, instruction: string) => ({
  requestId: request.id,
  ...(instruction.trim() === "" ? {} : { instruction: instruction.trim().slice(0, 2_000) }),
});

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
    peerHubWithdrawRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:withdraw-request",
      tag: WS_METHODS.peerHubWithdrawRequest,
    }),
  };
}
