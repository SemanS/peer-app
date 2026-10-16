import { plansBadge } from "@t3tools/client-runtime/peer/plans-view";

import { AppText as Text } from "../../../components/ui/AppText";
import type { PeerTaskProps } from "../slotTypes";

/**
 * How many relations name the task, under its row: "Plans · 1 relation". The relations are listed
 * under the task once it is selected. Absent while none does, and while Plans is off.
 */
export function PlansBadge({ status, workspace, project, task }: PeerTaskProps) {
  const text = plansBadge(status, { workspace, project: project.project.id, task: task.id });
  return text === null ? null : <Text className="text-sm text-foreground-muted">{text}</Text>;
}
