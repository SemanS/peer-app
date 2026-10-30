import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { MoreHorizontalIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NewTaskDialog } from "./NewTaskDialog";
import { projectActionItems } from "./slots.logic";
import type { PeerWebPlugin } from "./slots.types";
import { projectCheckout } from "./useOpenWorkspaceProject";
import type { WorkProjectNode } from "./workTree.logic";

/**
 * What the head of a project's tasks offers: New task, and a "More" menu with the actions
 * the active plugins add (Request a teammate…, Notify agents…) and a chat without a task. The
 * menu's dialogs mount here, outside the menu, so they outlive it closing.
 */
export function ProjectActions({
  environmentId,
  status,
  project,
  plugins,
  activeThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const openNewThread = useNewThreadHandler();
  const state = status.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((candidate) => candidate.project.id === project.projectId);
  // The project's repository as it is open on this computer; a chat needs it.
  const t3ProjectId = state === undefined ? undefined : projectCheckout(state).projectId;
  const slot = { environmentId, status, project, activeThread };
  const items = projectActionItems(plugins, slot);
  const opened = items.find((item) => item.key === dialog);
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
            {items.map(({ key, action }) => {
              const Icon = action.icon;
              return (
                <MenuItem key={key} className="items-start" onClick={() => setDialog(key)}>
                  <Icon aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span>{action.label}</span>
                    <span className="text-xs text-muted-foreground">{action.hint}</span>
                  </span>
                </MenuItem>
              );
            })}
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
      {opened === undefined ? null : (
        <opened.action.Dialog {...slot} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
