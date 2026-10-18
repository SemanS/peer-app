import { needAttentionOf, changesRouteKey } from "./changes.logic";
import { GitCompareIcon } from "lucide-react";

import type { PeerWebPlugin } from "../slots.types";
import { ChangeReview } from "./ChangeReview";
import { TaskChanges } from "./TaskChanges";

/**
 * Changes: everyone's Jujutsu changes in flight as one graph. The project's navigation row opens
 * the page and counts the changes that hold a conflict or two versions; the task page lists the
 * task's stack and its review shows the versions. Merge-check results are forecast's, in the
 * inspector's own slot, and never count here.
 */
export const changesWebPlugin: PeerWebPlugin = {
  id: "changes",
  projectSignals: (status, { workspace, projectId }) => [
    {
      id: "changes",
      label: "Changes",
      icon: GitCompareIcon,
      // The count is the row's; the signal itself has no tile or chip.
      count: null,
      detail: "Everyone's changes in flight",
      tone: "neutral",
      navRow: {
        label: "Changes",
        icon: GitCompareIcon,
        count: needAttentionOf(status, workspace, projectId),
        active: (activeThread) => activeThread === changesRouteKey(workspace, projectId),
        open: (navigate) =>
          void navigate({
            to: "/changes/$workspace/$project",
            params: { workspace, project: projectId },
          }),
      },
    },
  ],
  taskSections: TaskChanges,
  taskReview: ChangeReview,
};
