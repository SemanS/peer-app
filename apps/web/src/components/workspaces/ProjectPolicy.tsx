import type { PeerHubStatus } from "@t3tools/contracts";

import { InlineButton } from "../ui/button";
import { DecisionChip } from "./DecisionChip";
import { pathRulesText, projectPolicyLine } from "./DecisionChip.logic";
import { useOpenPeerSettings } from "./settings/peerSettingsLinks";
import type { WorkProjectNode } from "./workTree.logic";

/**
 * The line a project's header in Work carries about its policy: what applies to the agents here and
 * who set it, how many path rules the project has, and the page that changes it (the project's own
 * settings, or this computer's when its default decides).
 */
export function ProjectPolicy({
  status,
  project,
}: {
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
}) {
  const open = useOpenPeerSettings();
  const line = projectPolicyLine(status, project.workspace, {
    id: project.projectId,
    name: project.name,
  });
  if (line === null) return null;
  const toProject = line.change.page === "project";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs text-muted-foreground">
      <span>Policy</span>
      <DecisionChip chip={line.chip} />
      {line.rules === 0 ? null : <span>{pathRulesText(line.rules)}</span>}
      <InlineButton
        aria-label={
          toProject
            ? `Coordination settings of ${project.name}`
            : "Coordination policy of this computer"
        }
        onClick={() =>
          void open(
            toProject
              ? {
                  kind: "project",
                  workspace: project.workspace,
                  projectId: project.projectId,
                  tab: "coordination",
                }
              : { kind: "computer", section: "coordination" },
          )
        }
      >
        {line.change.label}
      </InlineButton>
    </div>
  );
}
