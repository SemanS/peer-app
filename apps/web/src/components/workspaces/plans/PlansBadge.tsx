import { Link } from "@tanstack/react-router";

import { Badge } from "../../ui/badge";
import type { TaskSlotProps } from "../slots.types";
import { plansBadge } from "./plans.logic";

/**
 * How many relations name the task, on its page: "Plans · 1 relation", which opens the task's
 * context page, where the Plans section lists them. Absent while none does, and while Plans is off.
 */
export function PlansBadge({ status, workspace, project, task }: TaskSlotProps) {
  const text = plansBadge(status, { workspace, project: project?.project.id, task: task.id });
  if (text === null || project === undefined) return null;
  return (
    <Badge
      variant="coordination"
      size="sm"
      render={
        <Link
          to="/context/$workspace/$project/$scope"
          params={{ workspace, project: project.project.id, scope: `task:${task.id}` }}
        />
      }
    >
      {text}
    </Badge>
  );
}
