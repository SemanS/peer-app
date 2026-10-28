import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ScanEyeIcon } from "lucide-react";
import { useState } from "react";

import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../ui/button";
import { toastManager } from "../../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import type { TaskMenuEntry, TaskSlotProps } from "../slots.types";
import { reportFailure } from "../workFeedback";
import { reviewLaunch, type ReviewLaunch } from "./roles.logic";

const START_LABEL = "Start a review";
const START_HINT =
  "An agent reads and checks the task's work; Peer stops it changing or landing anything.";

const starting = new Set<string>();

/** Starts a review once per task at a time; true when it started. */
async function startReview(environmentId: EnvironmentId, launch: ReviewLaunch): Promise<boolean> {
  const key = `${environmentId}:${launch.input.workspace}:${launch.input.projectId}:${launch.input.taskId}`;
  if (starting.has(key)) return false;
  starting.add(key);
  try {
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.peerRoles.startReview,
      { environmentId, input: launch.input },
      { reportFailure: false },
    );
    if (!reportFailure("Could not start the review", result) || result._tag !== "Success")
      return false;
    const { promptError } = result.value;
    toastManager.add(
      promptError === undefined
        ? { type: "success", title: `Review of ${launch.label} started` }
        : {
            type: "warning",
            title: `Review of ${launch.label} started without its prompt`,
            description: promptError,
          },
    );
    return true;
  } finally {
    starting.delete(key);
  }
}

/**
 * Start a review on an open task's row and page: an agent on the task in its own checkout, whose
 * sessions take the role review. Not offered on a done task, while the plugin is inactive, where
 * no checkout is ready here, or to a connection without the grant to run agents.
 */
export function StartReviewAction(props: TaskSlotProps) {
  const allowed = useAtomValue(
    serverEnvironment.peerRoles.startReview.permissionAtom(props.environmentId),
  );
  const [busy, setBusy] = useState(false);
  const launch = reviewLaunch(props);
  if (launch === null || !allowed) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={START_LABEL}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              setBusy(true);
              void startReview(props.environmentId, launch).finally(() => setBusy(false));
            }}
          >
            <ScanEyeIcon />
          </Button>
        }
      />
      <TooltipPopup>{`${START_LABEL}: ${START_HINT}`}</TooltipPopup>
    </Tooltip>
  );
}

/** Start a review in a task's menu, on its page and in the sidebar's row, offered as the action is. */
export function startReviewMenu(props: TaskSlotProps): ReadonlyArray<TaskMenuEntry> {
  const launch = reviewLaunch(props);
  if (
    launch === null ||
    !appAtomRegistry.get(
      serverEnvironment.peerRoles.startReview.permissionAtom(props.environmentId),
    )
  )
    return [];
  return [
    {
      item: { id: "roles:start-review", label: START_LABEL, separatorBefore: true },
      run: () => void startReview(props.environmentId, launch),
    },
  ];
}
