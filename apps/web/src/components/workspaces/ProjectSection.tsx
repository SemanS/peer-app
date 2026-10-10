import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { ChevronRightIcon, EllipsisIcon, HistoryIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProjectSignals } from "./ProjectSignals";
import { ProjectMark } from "./signals";
import { ContextRow, TaskRow } from "./TaskRow";
import { ThreadList } from "./ThreadCard";
import type { PeerWebPlugin } from "./slots.types";
import {
  groupOpenByDefault,
  groupTasks,
  type TaskGroup,
  type TaskGroupNode,
} from "./workGroups.logic";
import {
  projectCheckout,
  type ProjectCheckout,
  useOpenWorkspaceProject,
} from "./useOpenWorkspaceProject";
import { below, pickFromMenu, type Scope, type WorkActions } from "./useWorkActions";
import { canRemoveProject, projectMenuItems } from "./workMenus.logic";
import { reportFailure } from "./workFeedback";
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
  const [adding, setAdding] = useState(false);
  const workspace = status.workspaces.find((w) => w.slug === project.workspace);
  const state = workspace?.projects.find((p) => p.project.id === project.projectId);
  const menu = projectMenuItems({
    removable:
      workspace !== undefined &&
      state !== undefined &&
      canRemoveProject({
        project: state.project,
        workspaceRole: workspace.role,
        email: status.email,
      }),
  });
  const checkout = state === undefined ? undefined : projectCheckout(state);
  const t3ProjectId = checkout?.projectId;
  const scope = { workspace: project.workspace, projectId: project.projectId };
  const opener = useOpenWorkspaceProject({ environmentId, ...scope, name: project.name });
  const groups = groupTasks(project);
  const slot = { environmentId, status, project, activeThread };

  return (
    <section aria-label={project.name} className="flex flex-col gap-3">
      {/* What holds now: the active announcement and what waits to be kept, one row each. */}
      {plugins.map(({ id, projectRows: Rows }) =>
        Rows === undefined ? null : <Rows key={id} {...slot} />,
      )}
      <ProjectSignals status={status} project={project} plugins={plugins} />
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
            {showWorkspace ? (
              <span className="truncate font-normal text-muted-foreground normal-case">
                · {project.workspaceName}
              </span>
            ) : null}
          </button>
          {plugins.map(({ id, projectActions: Actions }) =>
            Actions === undefined ? null : (
              <Actions
                key={id}
                environmentId={environmentId}
                status={status}
                project={project}
                activeThread={activeThread}
              />
            ),
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Add a task to ${project.name}`}
                  onClick={() => {
                    setCollapsed(false);
                    setAdding(true);
                  }}
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">Add a task</TooltipPopup>
          </Tooltip>
          {menu.length === 0 ? null : (
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={`More for ${project.name}`}
              onClick={(event) =>
                void pickFromMenu(menu, below(event)).then((choice) => {
                  if (choice === "remove-project") {
                    void actions.removeProject(scope, project.name, project.workspaceName);
                  }
                })
              }
            >
              <EllipsisIcon className="size-3.5" />
            </Button>
          )}
        </div>
        {collapsed ? null : (
          <div className="flex flex-col gap-1 pl-1">
            {adding ? (
              <NewTaskForm
                environmentId={environmentId}
                scope={scope}
                areas={project.areas.flatMap((a) => (a.name === null ? [] : [a.name]))}
                onDone={() => setAdding(false)}
              />
            ) : null}
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
            {groups.length === 0 && !adding ? (
              <p className="px-2 py-0.5 text-xs text-muted-foreground">No tasks yet.</p>
            ) : null}
            {groups.map((group) => (
              <TaskGroupList
                key={group.id}
                group={group}
                initiallyOpen={groupOpenByDefault(group.id, groups)}
              >
                {group.tasks.map(({ task, area }) => (
                  <TaskRow
                    key={task.id}
                    environmentId={environmentId}
                    projectState={state}
                    status={status}
                    scope={scope}
                    task={task}
                    area={area}
                    tasks={project.tasks}
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

const GROUP_DOT: Readonly<Record<TaskGroup, string>> = {
  review: "bg-success",
  working: "bg-info",
  idle: "bg-muted-foreground/50",
  done: "bg-muted-foreground/30",
};

/** One group of a project's tasks under its name and count, folded or open. */
function TaskGroupList({
  group,
  initiallyOpen,
  children,
}: {
  readonly group: TaskGroupNode;
  readonly initiallyOpen: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-2xs font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon aria-hidden className={cn("size-3 shrink-0", open && "rotate-90")} />
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", GROUP_DOT[group.id])} />
        <span className="truncate">{group.title}</span>
        <span className="font-normal tabular-nums">{group.tasks.length}</span>
      </button>
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

function NewTaskForm({
  environmentId,
  scope,
  areas,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly scope: Scope;
  readonly areas: ReadonlyArray<string>;
  readonly onDone: () => void;
}) {
  const createTask = useAtomCommand(serverEnvironment.peerHubCreateTask, { reportFailure: false });
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [area, setArea] = useState(areas[0] ?? "");
  const [busy, setBusy] = useState(false);
  const listId = `peer-areas-${scope.workspace}-${scope.projectId}`;
  return (
    <form
      className="flex flex-col gap-1.5 rounded-md border border-sidebar-border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || title.trim() === "") return;
        setBusy(true);
        void createTask({
          environmentId,
          input: {
            ...scope,
            title: title.trim(),
            ...(key.trim() === "" ? {} : { key: key.trim() }),
            ...(area.trim() === "" ? {} : { area: area.trim() }),
          },
        })
          .then((result) => {
            if (reportFailure("Could not add the task", result)) onDone();
          })
          .finally(() => setBusy(false));
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
    >
      <Input
        size="sm"
        nativeInput
        autoFocus
        placeholder="Task, e.g. Split Payments"
        aria-label="Task title"
        value={title}
        readOnly={busy}
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
      <div className="flex gap-1.5">
        <Input
          className="w-24"
          size="sm"
          nativeInput
          placeholder="KRK-812"
          aria-label="Tracker key (optional)"
          value={key}
          readOnly={busy}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
        <Input
          className="min-w-0 flex-1"
          size="sm"
          nativeInput
          placeholder="Area"
          aria-label="Area"
          list={listId}
          value={area}
          readOnly={busy}
          onChange={(event) => setArea(event.currentTarget.value)}
        />
        <datalist id={listId}>
          {areas.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <div className="flex justify-end gap-1">
        <Button type="button" size="xs" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={busy || title.trim() === ""}>
          {busy ? "Adding…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
