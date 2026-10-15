import { impactCount, impactRunning } from "@t3tools/client-runtime/peer/impact";
import { Badge } from "../../ui/badge";
import type { TaskSlotProps } from "../slots.types";

export function ImpactTaskCount({ status, workspace, project, task }: TaskSlotProps) {
  const count = impactCount(status.impact, {
    workspace,
    project: project?.project.id,
    task: task.id,
  });
  return impactRunning(status) && project && count ? (
    <Badge variant="coordination" size="sm" aria-label={`${count} open impact overlaps`}>
      Impact {count}
    </Badge>
  ) : null;
}
