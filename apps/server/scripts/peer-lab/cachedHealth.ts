import type { PeerHubStatus } from "@t3tools/contracts";

/** The lab's observed cache, never a fresh list request or an implicit Hub synchronization. */
export function cachedImpactHealth(
  computer: string,
  root: string,
  status: Pick<PeerHubStatus, "impact">,
  tasks?: ReadonlyArray<string>,
) {
  return {
    computer,
    eachTaskOpen:
      tasks === undefined || status.impact === undefined
        ? undefined
        : tasks.length > 0 &&
          tasks.every((task) =>
            status.impact!.counts.some(
              (row) =>
                row.workspace === "acme" &&
                row.project === "lab" &&
                row.task === task &&
                row.count > 0,
            ),
          ),
    open: status.impact?.counts
      .filter(
        (row) =>
          row.workspace === "acme" &&
          row.project === "lab" &&
          (tasks === undefined || tasks.includes(row.task)),
      )
      .reduce((count, row) => count + row.count, 0),
    state: status.impact?.roots.find((row) => row.root === root)?.state ?? "not checked",
  };
}
