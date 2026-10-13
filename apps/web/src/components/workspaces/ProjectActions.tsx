import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { ChevronDownIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { NewTaskDialog } from "./NewTaskDialog";
import { projectActionItems } from "./slots.logic";
import type { PeerWebPlugin } from "./slots.types";
import { projectCheckout } from "./useOpenWorkspaceProject";
import type { WorkProjectNode } from "./workTree.logic";

/**
 * What a project's header offers by name: a "New task" button, and a "More" menu with the actions
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
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Button className="min-w-0 flex-1" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden />
          New task
        </Button>
        <Menu>
          <MenuTrigger render={<Button variant="outline" />}>
            More
            <ChevronDownIcon aria-hidden />
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
      </div>
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
    </div>
  );
}
