import { PeerAuditPage, type PeerAuditListInput } from "@t3tools/contracts";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

/** Audit reads explicitly; it never subscribes or places entries in an agent's context. */
export const auditHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  list: (input: PeerAuditListInput) => {
    const query = new URLSearchParams();
    for (const kind of input.kinds ?? []) query.append("kind", kind);
    if (input.member !== undefined) query.set("member", input.member);
    if (input.project !== undefined) query.set("project", input.project);
    if (input.before !== undefined) query.set("before", String(input.before));
    query.set("limit", String(input.limit ?? 50));
    return client.request(PeerAuditPage, {
      workspace: input.workspace,
      path: `/audit?${query}`,
      unsupported: { value: { entries: [], unsupported: true } },
    });
  },
});
