import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { ChevronRightIcon, HistoryIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { SignalTiles } from "./ProjectSignals";
import { ProjectMark } from "./signals";
import { ContextRow, TaskRow } from "./TaskRow";
import { ThreadList } from "./ThreadCard";
import type { PeerWebPlugin } from "./slots.types";
import { groupTasks, type TaskGroupNode } from "./workGroups.logic";
import {
  projectCheckout,
  type ProjectCheckout,
  useOpenWorkspaceProject,
} from "./useOpenWorkspaceProject";
import type { WorkActions } from "./useWorkActions";
import { projectScopeKey } from "./workBoard.logic";
import type { WorkProjectNode } from "./workTree.logic";

export function ProjectSection({
  environmentId,
  status,
  project,
  plugins,
  showWorkspace,
  activeThread,
  actions,
  onHistory,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly showWorkspace: boolean;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
  /** Opens the project's History; absent while no plugin keeps one. */
  readonly onHistory: (() => void) | undefined;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const workspace = status.workspaces.find((w) => w.slug === project.workspace);
  const state = workspace?.projects.find((p) => p.project.id === project.projectId);
  const checkout = state === undefined ? undefined : projectCheckout(state);
  const t3ProjectId = checkout?.projectId;
  const scope = { workspace: project.workspace, projectId: project.projectId };
  const opener = useOpenWorkspaceProject({ environmentId, ...scope, name: project.name });
  const groups = groupTasks(project);
  const areaNames = project.areas.flatMap((area) => (area.name === null ? [] : [area.name]));
  const openTasks = groups.reduce(
    (total, group) => total + (group.done ? 0 : group.tasks.length),
    0,
  );
  const slot = { environmentId, status, project, activeThread };

  return (
    <section aria-label={project.name} className="flex flex-col gap-3">
      {/* What holds now: the signals that open a page as tiles, then what plugins show in place. */}
      <SignalTiles status={status} project={project} plugins={plugins} />
      {plugins.map(({ id, projectRows: Rows }) =>
        Rows === undefined ? null : <Rows key={id} {...slot} />,
      )}
      <div>
        <div className="group/project flex items-center gap-1 pr-1">
          <button
            type="button"
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase hover:bg-sidebar-row-hover"
            aria-expanded={!collapsed}
            aria-label={`Tasks of ${project.name}`}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronRightIcon
              className={cn("size-3.5 shrink-0 text-muted-foreground", !collapsed && "rotate-90")}
            />
            <ProjectMark name={project.name} colorKey={projectScopeKey(project)} />
            <span className="truncate">Tasks</span>
            <span className="font-normal tabular-nums">{openTasks}</span>
            {showWorkspace ? (
              <span className="truncate font-normal text-muted-foreground normal-case">
                · {project.workspaceName}
              </span>
            ) : null}
          </button>
        </div>
        {collapsed ? null : (
          <div className="flex flex-col gap-1 pl-1">
            {checkout !== undefined && checkout.projectId === undefined ? (
              <NotOpenHere
                environmentId={environmentId}
                status={status}
                plugins={plugins}
                checkout={checkout}
                opening={opener.opening}
                onOpen={() => void opener.open()}
              />
            ) : null}
            {groups.length === 0 ? (
              <p className="px-2 py-0.5 text-xs text-muted-foreground">No tasks yet.</p>
            ) : null}
            {groups.map((group) => (
              <TaskGroupList key={group.id} group={group}>
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    environmentId={environmentId}
                    projectState={state}
                    status={status}
                    scope={scope}
                    task={task}
                    tasks={project.tasks}
                    areas={areaNames}
                    plugins={plugins}
                    t3ProjectId={t3ProjectId}
                    activeThread={activeThread}
                    actions={actions}
                  />
                ))}
              </TaskGroupList>
            ))}
            {project.unsorted.some((thread) => thread.mine) || hasContext(project) ? (
              <div>
                <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                  <span className="truncate text-xs font-semibold text-secondary-label">
                    Not on a task
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-sidebar-border" />
                </div>
                <ul className="flex flex-col">
                  {project.context === undefined || !hasContext(project) ? null : (
                    <ContextRow
                      context={project.context}
                      label="Shared context"
                      activeThread={activeThread}
                    />
                  )}
                  <ThreadList
                    scope={scope}
                    threads={project.unsorted}
                    taskId={null}
                    tasks={project.tasks}
                    plugins={plugins}
                    activeThread={activeThread}
                    actions={actions}
                  />
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {onHistory === undefined ? null : (
        <button
          type="button"
          className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onHistory}
        >
          <HistoryIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">History</span>
          {plugins.map(({ id, historyBadge: Mark }) =>
            Mark === undefined ? null : <Mark key={id} {...slot} />,
          )}
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}
    </section>
  );
}

/** A project's shared context for work on no task, once an agent wrote one. */
function hasContext(project: WorkProjectNode): boolean {
  return project.context !== undefined && project.context.version > 0;
}

/**
 * One group of a project's tasks: an area under its name and count, open, or the done tasks,
 * folded until opened.
 */
function TaskGroupList({
  group,
  children,
}: {
  readonly group: TaskGroupNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(!group.done);
  const heading = (
    <>
      <span className="truncate">{group.title}</span>
      <span className="font-normal text-muted-foreground tabular-nums">{group.tasks.length}</span>
      <span aria-hidden className="h-px flex-1 bg-sidebar-border" />
    </>
  );
  return (
    <div>
      {group.title === undefined ? null : group.done ? (
        <button
          type="button"
          aria-expanded={open}
          className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-xs font-semibold text-secondary-label outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRightIcon aria-hidden className={cn("size-3 shrink-0", open && "rotate-90")} />
          {heading}
        </button>
      ) : (
        <div className="flex h-7 min-w-0 items-center gap-1.5 px-1 text-xs font-semibold text-secondary-label">
          {heading}
        </div>
      )}
      {open ? <ul className="flex flex-col gap-0.5">{children}</ul> : null}
    </div>
  );
}

/**
 * A workspace project not open on this computer: clone and open it, or say
 * why that failed, with GitHub to connect when the account was the reason.
 */
function NotOpenHere({
  environmentId,
  status,
  plugins,
  checkout,
  opening,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly checkout: ProjectCheckout;
  readonly opening: boolean;
  readonly onOpen: () => void;
}) {
  const busy = opening || checkout.cloning;
  const failed = !busy && checkout.errors.length > 0;
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <span className={cn("min-w-0 flex-1", failed && "text-destructive")}>
          {failed
            ? checkout.errors.join(" ")
            : checkout.missing
              ? "Not on this computer yet."
              : "On this computer, not open yet."}
        </span>
        <Button size="xs" variant="outline" disabled={busy} onClick={onOpen}>
          {busy
            ? checkout.missing
              ? "Cloning…"
              : "Opening…"
            : failed
              ? "Try again"
              : checkout.missing
                ? "Clone & open"
                : "Open"}
        </Button>
      </div>
      {plugins.map(({ id, notOpenHere: Fix }) =>
        Fix === undefined ? null : (
          <Fix
            key={id}
            environmentId={environmentId}
            status={status}
            checkout={checkout}
            failed={failed}
            onRetry={onOpen}
          />
        ),
      )}
    </div>
  );
}
