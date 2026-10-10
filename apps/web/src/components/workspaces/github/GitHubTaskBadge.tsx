import { taskDelivery } from "@t3tools/client-runtime/peer/github";
import { Badge } from "../../ui/badge";
import type { TaskSlotProps } from "../slots.types";
export function GitHubTaskBadge({ status, workspace, project, task }: TaskSlotProps) {
  const summary = taskDelivery(project?.work.threads ?? [], task.id);
  const configured =
    status.github.verification?.find((v) => v.workspace === workspace)?.configured === true;
  if (!summary.total) return null;
  return (
    <Badge
      size="sm"
      variant={
        summary.closedUnmerged
          ? "warning"
          : configured && summary.verifiedAll && summary.merged === summary.total
            ? "success"
            : "info"
      }
      aria-label={`${summary.merged}/${summary.total} merged${configured ? (summary.verifiedAll ? " · Verified by GitHub" : " · unverified") : ""}`}
    >
      {summary.merged}/{summary.total} merged
      {summary.closedUnmerged
        ? " · closed without merge"
        : configured
          ? summary.verifiedAll
            ? " · Verified by GitHub"
            : " · unverified"
          : ""}
    </Badge>
  );
}
