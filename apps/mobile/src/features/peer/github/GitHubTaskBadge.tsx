import { taskDelivery } from "@t3tools/client-runtime/peer/github";
import { AppText as Text } from "../../../components/AppText";
import type { PeerTaskProps } from "../slotTypes";
export function GitHubTaskBadge({ workspace, project, task, status }: PeerTaskProps) {
  const summary = taskDelivery(project.work.threads, task.id),
    configured =
      status.github.verification?.find((v) => v.workspace === workspace)?.configured === true;
  if (!summary.total) return null;
  return (
    <Text
      accessibilityLabel={`${summary.merged}/${summary.total} merged${configured && summary.verifiedAll ? " · Verified by GitHub" : ""}`}
      className={summary.closedUnmerged ? "text-sm text-warning" : "text-sm text-foreground-muted"}
    >
      {summary.merged}/{summary.total} merged
      {summary.closedUnmerged
        ? " · closed without merge"
        : configured
          ? summary.verifiedAll
            ? " · Verified by GitHub"
            : " · unverified"
          : ""}
    </Text>
  );
}
