import {
  acceptanceBadge,
  acceptanceState,
  deliveryOf,
  taskAcceptance,
} from "@t3tools/client-runtime/peer/acceptance";

import { Badge } from "../../ui/badge";
import type { TaskSlotProps } from "../slots.types";

/**
 * "Accepted" beside the task's state on its card, or "Accepted before reopening". It reads the
 * status's summaries only, so a row asks the Hub for nothing.
 */
export function AcceptedBadge({ status, workspace, project, task }: TaskSlotProps) {
  const projectId = project?.project.id;
  if (projectId === undefined) return null;
  const row = taskAcceptance(status, { workspace, project: projectId, task: task.id });
  const label = acceptanceBadge(acceptanceState(row, deliveryOf(task)));
  if (label === null) return null;
  return (
    <Badge variant={label === "Accepted" ? "success" : "outline"} size="control">
      {label}
    </Badge>
  );
}
