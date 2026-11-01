import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { MoreHorizontalIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NewTaskDialog } from "./NewTaskDialog";
import { projectCheckout } from "./useOpenWorkspaceProject";
import type { WorkProjectNode } from "./workTree.logic";

/** What the head of a project's tasks offers: New task, and a "More" menu with a chat without a task. */
export function ProjectActions({
  environmentId,
  status,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
}) {
  const [adding, setAdding] = useState(false);
  const openNewThread = useNewThreadHandler();
  const state = status.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((candidate) => candidate.project.id === project.projectId);
  // The project's repository as it is open on this computer; a chat needs it.
  const t3ProjectId = state === undefined ? undefined : projectCheckout(state).projectId;
  return (
    <>
      <span className="flex shrink-0 items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="New task"
                onClick={() => setAdding(true)}
              />
            }
          >
            <PlusIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="top">New task</TooltipPopup>
        </Tooltip>
        <Menu>
          <MenuTrigger
            render={
              <Button size="icon-xs" variant="ghost-muted" aria-label="More project actions" />
            }
          >
            <MoreHorizontalIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-64">
            <MenuItem
              className="items-start"
              disabled={t3ProjectId === undefined}
              onClick={() => {
                if (t3ProjectId !== undefined) {
                  void openNewThread(scopeProjectRef(environmentId, t3ProjectId));
                }
              }}
            >
              <MessageSquareIcon aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span>New chat without a task</span>
                <span className="text-xs text-muted-foreground">
                  {t3ProjectId === undefined
                    ? "The project is not open on this computer yet"
                    : "A chat of yours; put it on a task later"}
                </span>
              </span>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </span>
      {adding ? (
        <NewTaskDialog
          environmentId={environmentId}
          project={project}
          t3ProjectId={t3ProjectId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}
