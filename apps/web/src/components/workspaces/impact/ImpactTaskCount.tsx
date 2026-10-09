import { impactCount } from "@t3tools/client-runtime/peer/impact";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { Badge } from "../../ui/badge";
import type { TaskSlotProps } from "../slots.types";

export function ImpactTaskCount({ status, workspace, project, task }: TaskSlotProps) {
  const count = impactCount(status.impact, {
    workspace,
    project: project?.project.id,
    task: task.id,
  });
  return activePlugin(status, "impact") && project && count ? (
    <Badge variant="outline" size="sm" aria-label={`${count} open impact overlaps`}>
      Impact {count}
    </Badge>
  ) : null;
}
