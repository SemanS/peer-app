import type { PeerFindingDecisionInput } from "@t3tools/contracts";
import type { HubFinding } from "../hub/coordApi.ts";

export function validateFindingDecisions(
  findings: readonly HubFinding[],
  project: string,
  scope: string,
  findingDecisions: readonly PeerFindingDecisionInput[],
) {
  const ids = new Set<string>();
  for (const decision of findingDecisions) {
    if (
      ids.has(decision.id) ||
      decision.reason.trim() === "" ||
      Buffer.byteLength(decision.reason) > 2000
    )
      throw new Error(
        "Each finding decision needs a unique ID and a reason of at most 2000 bytes.",
      );
    ids.add(decision.id);
    const finding = findings.find(
      (finding) => finding.id === decision.id && finding.project === project,
    );
    if (finding === undefined) throw new Error("This finding is unavailable.");
    if ((finding.task === undefined ? "project" : `task:${finding.task}`) !== scope)
      throw new Error("Decide findings in the shared context of their work.");
    if (finding.decision !== undefined) throw new Error("This finding has already been decided.");
  }
}
