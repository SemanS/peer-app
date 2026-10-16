import { deliveryBadge, taskDelivery } from "@t3tools/client-runtime/peer/github";
import { AppText as Text } from "../../../components/ui/AppText";
import type { PeerTaskProps } from "../slotTypes";
export function GitHubTaskBadge({ workspace, project, task, status }: PeerTaskProps) {
  const summary = taskDelivery(project.work.threads, task.id);
  if (!summary.total) return null;
  const badge = deliveryBadge(
    summary,
    status.github.verification?.find((v) => v.workspace === workspace)?.configured === true,
  );
  return (
    <Text
      accessibilityLabel={badge.text}
      className={
        badge.tone === "warning" ? "text-sm text-warning" : "text-sm text-foreground-muted"
      }
    >
      {badge.text}
    </Text>
  );
}
