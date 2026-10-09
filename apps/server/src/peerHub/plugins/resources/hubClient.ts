import {
  PeerResourcesList,
  PeerResourceClaimResult,
  PeerResourceReleaseResult,
} from "@t3tools/contracts";
import type { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
export const makeHubClient = (hub: PeerHubClient["Service"]) => ({
  list: (workspace: string) =>
    hub.request(PeerResourcesList, {
      workspace,
      path: "/resources",
      method: "GET",
      unsupported: { value: null },
      timeoutMs: 5000,
    }),
  claim: (
    workspace: string,
    project: string,
    body: {
      environment: string;
      session: string;
      name: string;
      ttlSeconds: number;
      intent?: string;
      op: string;
    },
  ) =>
    hub.request(PeerResourceClaimResult, {
      workspace,
      path: `/resources/${encodeURIComponent(project)}/claim`,
      method: "POST",
      body,
      unsupported: { value: null },
      timeoutMs: 5000,
    }),
  release: (
    workspace: string,
    project: string,
    body: { environment?: string; session?: string; target: string; op: string },
  ) =>
    hub.request(PeerResourceReleaseResult, {
      workspace,
      path: `/resources/${encodeURIComponent(project)}/release`,
      method: "POST",
      body,
      unsupported: { value: null },
      timeoutMs: 5000,
    }),
});
