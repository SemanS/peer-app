import { newestSummary, reportBadge } from "@t3tools/client-runtime/peer/test-reports";

import { Badge } from "../../ui/badge";
import type { TaskSlotProps } from "../slots.types";

/**
 * The task's newest test report beside its state: "Tests: mixed · 1 item needs an owner". It reads
 * the status's summaries only, so a row asks the Hub for nothing.
 */
export function TaskBadge({ status, workspace, project, task }: TaskSlotProps) {
  const projectId = project?.project.id;
  if (projectId === undefined) return null;
  const newest = newestSummary(status, { workspace, project: projectId, task: task.id });
  if (newest === undefined) return null;
  return (
    <Badge variant={newest.unowned > 0 ? "warning" : "outline"} size="control">
      {reportBadge(newest)}
    </Badge>
  );
}
