import { deliveryBadge, taskDelivery } from "@t3tools/client-runtime/peer/github";
import { Badge } from "../../ui/badge";
import type { TaskSlotProps } from "../slots.types";
export function GitHubTaskBadge({ status, workspace, project, task }: TaskSlotProps) {
  const summary = taskDelivery(project?.work.threads ?? [], task.id);
  if (!summary.total) return null;
  const badge = deliveryBadge(
    summary,
    status.github.verification?.find((v) => v.workspace === workspace)?.configured === true,
  );
  return (
    <Badge
      size="sm"
      variant={badge.tone === "neutral" ? "info" : badge.tone}
      aria-label={badge.text}
    >
      {badge.text}
    </Badge>
  );
}
