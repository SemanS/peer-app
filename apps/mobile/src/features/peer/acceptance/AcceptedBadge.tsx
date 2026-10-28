import { taskAcceptance } from "@t3tools/client-runtime/peer/acceptance";

import { AppText as Text } from "../../../components/ui/AppText";
import type { PeerTaskProps } from "../slotTypes";
import { badgeText } from "./acceptance.logic";

/** "Accepted" under the task's row, from the status alone; absent while it has none. */
export function AcceptedBadge({ status, workspace, project, task }: PeerTaskProps) {
  const row = taskAcceptance(status, { workspace, project: project.project.id, task: task.id });
  const text = badgeText(row, task.status ?? "open");
  return text === null ? null : <Text className="text-sm text-success-foreground">{text}</Text>;
}
