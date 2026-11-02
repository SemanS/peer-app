import { roomFeed, type RoomFeedRow } from "@t3tools/client-runtime/peer/rooms";
import type { PeerHubStatus } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ListIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../../env";
import { useSidebarProjectGroups } from "../../../hooks/useSidebarProjectGroups";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button, InlineButton } from "../../ui/button";
import { SidebarInset, useSidebar } from "../../ui/sidebar";
import { WorkspacePageHeader } from "../../WorkspacePageHeader";
import { WorkspacePageIntro } from "../../WorkspacePageIntro";
import { HubConnectCard } from "../HubConnectCard";
import { LocalWork } from "../LocalWork";
import { WorkSectionLabel } from "../marks";
import { NewTaskDialog } from "../NewTaskDialog";
import { useProjectScope, useWorkScopeUrl } from "../projectScope";
import { isLocalScope } from "../projectScope.logic";
import { SignalCount } from "../signals";
import { useOpenScopedChats } from "../useOpenScopedChats";
import { projectCheckout } from "../useOpenWorkspaceProject";
import { useWorkData } from "../useWorkData";
import { inScope, projectScopeKey } from "@t3tools/client-runtime/peer/work";
import { WorkNoProjects } from "../WorkNoProjects";
import { WorkScopePicker } from "../WorkScopePicker";
import { roomTaskName } from "./roomSlots.logic";
import { feedAuthor, feedInScope, feedSections } from "./roomFeed.logic";

/**
 * A person's rooms across their projects, in the sidebar's scope: what waits on them, then work that
 * is ready, then what only moves. It never shows the words: a row names the task, who wrote last and
 * when, and opens the room.
 */
export function RoomFeed() {
  const { environmentId, status, plugins, tree } = useWorkData();
  const { open: sidebarOpen, isMobile } = useSidebar();
  const projectGroups = useSidebarProjectGroups();
  const selected = useProjectScope(projectGroups);
  useWorkScopeUrl(selected.requestedScope);
  const showScopedChats = useOpenScopedChats();
  const [addingTask, setAddingTask] = useState(false);
  const local = isLocalScope(selected.scope);
  const rows = feedInScope(roomFeed(status?.rooms), selected);
  const listed = tree.filter((project) =>
    selected.members === undefined
      ? inScope(selected.scope, project)
      : selected.members.some((member) => member.scope === projectScopeKey(project)),
  );
  const sole = listed.length === 1 ? listed[0] : undefined;
  const soleState = status?.workspaces
    .find((workspace) => workspace.slug === sole?.workspace)
    ?.projects.find((candidate) => candidate.project.id === sole?.projectId);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <WorkspacePageHeader electron={isElectron}>
          <ListIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-base font-semibold text-foreground">Feed</span>
          {isMobile || !sidebarOpen ? <WorkScopePicker groups={projectGroups} compact /> : null}
        </WorkspacePageHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-(--workspace-page-gutter) pt-6 pb-12 sm:pt-8">
          {status === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Connecting…
            </p>
          ) : local ? (
            <div className="flex max-w-lg flex-col items-start gap-5">
              <WorkspacePageIntro
                title={selected.name ?? "This project"}
                description="Your chats and agent coordination work on this environment without a Hub account."
              />
              <LocalWork status={status} scope={selected} />
              <InlineButton onClick={showScopedChats}>Show its chats</InlineButton>
            </div>
          ) : !status.signedIn ? (
            <>
              <LocalWork status={status} scope={selected} />
              {environmentId === null ? null : (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Work with a team</summary>
                  <HubConnectCard environmentId={environmentId} status={status} />
                </details>
              )}
            </>
          ) : status.workspaces.length === 0 ? (
            environmentId === null ? null : (
              <HubConnectCard environmentId={environmentId} status={status} />
            )
          ) : tree.length === 0 ? (
            environmentId === null ? null : (
              <WorkNoProjects
                environmentId={environmentId}
                status={status}
                plugins={plugins}
                className="max-w-md"
                fallback={
                  <p className="text-sm text-muted-foreground">
                    No team projects yet. Share one from the sidebar’s Work tab.
                  </p>
                }
              />
            )
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                {sole === undefined
                  ? "No room has anything yet. Choose a project in the sidebar to add a task."
                  : "No room has anything yet."}
              </p>
              {sole === undefined || environmentId === null ? null : (
                <Button size="sm" variant="outline" onClick={() => setAddingTask(true)}>
                  New task
                </Button>
              )}
            </div>
          ) : (
            feedSections(rows).map((section) => (
              <section key={section.state} aria-label={section.title} className="flex flex-col">
                <WorkSectionLabel>{section.title}</WorkSectionLabel>
                <ul className="flex flex-col">
                  {section.rows.map((row) => (
                    <FeedRow key={row.key} status={status} row={row} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
      {addingTask && environmentId !== null && sole !== undefined ? (
        <NewTaskDialog
          environmentId={environmentId}
          project={sole}
          t3ProjectId={soleState === undefined ? undefined : projectCheckout(soleState).projectId}
          onClose={() => setAddingTask(false)}
        />
      ) : null}
    </SidebarInset>
  );
}

function FeedRow({ status, row }: { readonly status: PeerHubStatus; readonly row: RoomFeedRow }) {
  const author = feedAuthor(status, row);
  const said = row.updated === undefined ? undefined : formatRelativeTimeLabel(row.updated);
  return (
    <li className="list-none">
      <Link
        to="/room/$workspace/$project/$task"
        params={{ workspace: row.workspace, project: row.project, task: row.task }}
        className="flex min-w-0 items-baseline gap-3 rounded-md px-2 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {roomTaskName(status, row)}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {[author, said].filter((part) => part !== undefined).join(" · ")}
        </span>
        <SignalCount tone="neutral" count={row.unread} label="unread" />
      </Link>
    </li>
  );
}
