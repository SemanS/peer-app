import type { PeerHubStatus } from "@t3tools/contracts";

/** The lab's observed cache, never a fresh list request or an implicit Hub synchronization. */
export function cachedImpactHealth(
  computer: string,
  root: string,
  status: Pick<PeerHubStatus, "impact">,
) {
  return {
    computer,
    open: status.impact?.counts
      .filter((row) => row.workspace === "acme" && row.project === "lab")
      .reduce((count, row) => count + row.count, 0),
    state: status.impact?.roots.find((row) => row.root === root)?.state ?? "not checked",
  };
}
