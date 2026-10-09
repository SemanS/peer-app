import { PeerDigest, type PeerDigestInput } from "@t3tools/contracts";
import type { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
export const hubDigest = (hub: PeerHubClient["Service"]) => (input: PeerDigestInput) =>
  hub.request(PeerDigest, {
    workspace: input.workspace,
    path: `/projects/${encodeURIComponent(input.project)}/digest?since=${encodeURIComponent(input.since)}${input.limit === undefined ? "" : `&limit=${input.limit}`}`,
    method: "GET",
    unsupported: { value: null },
    timeoutMs: 5000,
  });
