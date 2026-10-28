import { useAtomValue } from "@effect/atom-react";
import { BadgeCheckIcon } from "lucide-react";

import { serverEnvironment } from "../../../state/server";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import type { TaskSlotProps } from "../slots.types";
import { acceptanceFacts } from "./acceptance.logic";
import { openAcceptanceDialog } from "./acceptanceDialog";

/**
 * Accept… on the row of a task in review, for a lead or an admin: the moment the work waits for
 * them. Done tasks and withdrawals are reached through the task's menu and page.
 */
export function AcceptAction(props: TaskSlotProps) {
  const allowed = useAtomValue(
    serverEnvironment.peerAcceptanceAccept.permissionAtom(props.environmentId),
  );
  const projectId = props.project?.project.id;
  const facts =
    projectId === undefined
      ? undefined
      : acceptanceFacts(
          props.status,
          { workspace: props.workspace, project: projectId, task: props.task.id },
          allowed,
        );
  if (facts === undefined || facts.delivery !== "review" || !facts.actions.includes("accept"))
    return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Accept ${facts.taskName}`}
            onClick={(event) => {
              event.stopPropagation();
              openAcceptanceDialog({
                kind: "accept",
                environmentId: props.environmentId,
                ...facts.place,
              });
            }}
          >
            <BadgeCheckIcon />
          </Button>
        }
      />
      <TooltipPopup>
        Accept the delivered work: it moves the task to done as your move.
      </TooltipPopup>
    </Tooltip>
  );
}
