import type {
  EnvironmentId,
  PeerHubStatus,
  PeerProjectState,
  PeerTask,
  ProjectId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, EllipsisIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadList } from "./ThreadCard";
import { PersonMark, TitleInput } from "./marks";
import type { PeerWebPlugin } from "./slots.types";
import {
  below,
  type MenuPosition,
  pickFromMenu,
  type Scope,
  type WorkActions,
} from "./useWorkActions";
import { TONE_SURFACE } from "./signals";
import { StatusGlyph } from "./workStatus";
import { taskHasOverlap } from "./workGroups.logic";
import { taskMenuItems } from "./workMenus.logic";
import {
  contextSize,
  taskLabel,
  type WorkContextNode,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./workTree.logic";

/** A person on a task: their mark, and their whole name on hover or click. */
function TaskPerson({ name, mine }: { readonly name: string; readonly mine: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next, details) => {
        // A click shows the name; it does not take it away again.
        if (!next && details.reason === "trigger-press") return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={name}
            className="flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        }
      >
        <PersonMark name={name} mine={mine} />
      </TooltipTrigger>
      <TooltipPopup side="top">{name}</TooltipPopup>
    </Tooltip>
  );
}

/** Up to three people on a task, you first. */
function TaskPeople({ threads }: { readonly threads: ReadonlyArray<WorkThreadNode> }) {
  const people = [
    ...new Map(threads.map((t) => [`${t.mine}:${t.person}`, t] as const)).values(),
  ].slice(0, 3);
  if (people.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1">
      {people.map((t) => (
        <TaskPerson key={`${t.mine}:${t.person}`} name={t.person} mine={t.mine} />
      ))}
    </span>
  );
}

export function TaskRow({
  environmentId,
  projectState,
  status,
  scope,
  task,
  tasks,
  plugins,
  t3ProjectId,
  activeThread,
  actions,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectState: PeerProjectState | undefined;
  readonly status: PeerHubStatus;
  readonly scope: Scope;
  readonly task: WorkTaskNode;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly t3ProjectId: ProjectId | undefined;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
}) {
  const navigate = useNavigate();
  // One line per task until it is opened: its context and threads are a click away.
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const label = taskLabel(task);

  const startThread = () => {
    if (t3ProjectId !== undefined) void actions.startThread(scope, task.id, t3ProjectId);
  };
  const showMenu = async (position: MenuPosition) => {
    const entries = plugins.flatMap(
      (plugin) =>
        plugin.taskMenu?.({
          environmentId,
          status,
          workspace: scope.workspace,
          project: projectState,
          task,
        }) ?? [],
    );
    const choice = await pickFromMenu(
      [
        ...taskMenuItems({
          task,
          canStartThread: t3ProjectId !== undefined,
          inReview: tasks.find((t) => t.id === task.id)?.status === "review",
        }),
        ...entries.map((entry) => entry.item),
      ],
      position,
    );
    const picked = entries.find(
      (entry) =>
        entry.item.id === choice || entry.item.children?.some((item) => item.id === choice),
    );
    if (picked && choice !== null) picked.run(choice);
    else if (choice === "new-thread") startThread();
    else if (choice === "rename") setRenaming(true);
    else if (choice === "reopen") void actions.setTaskDone(scope, task, false);
    else if (choice === "toggle-done") void actions.setTaskDone(scope, task, !task.done);
    else if (choice === "remove") void actions.removeTask(scope, task);
  };

  return (
    <li className="list-none">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={label}
        className={cn(
          "group/task relative flex min-w-0 cursor-pointer items-start gap-1.5 rounded-lg py-1.5 pr-1 pl-1 outline-none select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          expanded && task.threads.some((thread) => thread.mine) && "bg-sidebar-row-hover/60",
        )}
        onClick={() => {
          if (!renaming) setExpanded((value) => !value);
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest("button, input")) return;
          event.preventDefault();
          setRenaming(true);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((value) => !value);
          } else if (event.key === "F2") {
            event.preventDefault();
            setRenaming(true);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void showMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <ChevronRightIcon
          className={cn(
            "mt-1 size-3 shrink-0 text-muted-foreground",
            expanded && "rotate-90",
            !task.threads.some((thread) => thread.mine) &&
              task.context === undefined &&
              "invisible",
          )}
        />
        <span className="mt-0.5">
          <StatusGlyph status={task.status} />
        </span>
        {/* Two lines: the task, then its key, people and signals, so nothing is squeezed. */}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {renaming ? (
            <TitleInput
              value={task.title}
              label="Task title"
              onDone={(title) => {
                setRenaming(false);
                if (title !== null) void actions.renameTask(scope, task, title);
              }}
            />
          ) : (
            <span
              className={cn(
                "min-w-0 truncate text-sm font-medium",
                task.done ? "text-muted-foreground line-through" : "text-sidebar-foreground",
              )}
            >
              {task.title}
            </span>
          )}
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground empty:hidden">
            {task.key ? (
              <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-2xs text-muted-foreground">
                {task.key}
              </span>
            ) : null}
            <TaskPeople threads={task.threads} />
            {task.threads.length > 1 ? (
              <span className="shrink-0 rounded-sm bg-muted px-1 text-2xs tabular-nums">
                {task.threads.length} threads
              </span>
            ) : null}
            {taskHasOverlap(status, scope, task.id) ? (
              <Badge variant="coordination" size="sm">
                Overlap
              </Badge>
            ) : null}
            {tasks.find((t) => t.id === task.id)?.status === "review" ? (
              <Badge
                variant="success"
                size="sm"
                render={
                  <button
                    type="button"
                    aria-label={`Open the review of ${label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void navigate({
                        to: "/review/$workspace/$project/$task",
                        params: {
                          workspace: scope.workspace,
                          project: scope.projectId,
                          task: task.id,
                        },
                      });
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  />
                }
              >
                Review
              </Badge>
            ) : null}
            {task.context !== undefined && task.context.reports.length > 0 ? (
              <Badge variant="knowledge" size="sm">
                {task.context.reports.length} new
              </Badge>
            ) : null}
            {plugins.map(({ id, taskBadges: Badges }) =>
              Badges === undefined ? null : (
                <Badges
                  key={id}
                  environmentId={environmentId}
                  status={status}
                  workspace={scope.workspace}
                  project={projectState}
                  task={task}
                />
              ),
            )}
          </span>
        </span>
        {/* The task's actions, on hover or keyboard focus. */}
        {/* Out of the way until the row is hovered or focused, so the title keeps its width. */}
        <span className="pointer-events-none absolute top-1.5 right-1 flex h-5 shrink-0 items-center opacity-0 group-hover/task:pointer-events-auto group-hover/task:static group-hover/task:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 max-md:pointer-events-auto max-md:static max-md:opacity-100">
          {plugins.map(({ id, taskActions: Actions }) =>
            Actions === undefined ? null : (
              <Actions
                key={id}
                environmentId={environmentId}
                status={status}
                workspace={scope.workspace}
                project={projectState}
                task={task}
              />
            ),
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`New thread on ${label}`}
                  disabled={t3ProjectId === undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    startThread();
                  }}
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {t3ProjectId === undefined ? "Clone the project first" : "New thread on this task"}
            </TooltipPopup>
          </Tooltip>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`More for ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              void showMenu(below(event));
            }}
          >
            <EllipsisIcon className="size-3.5" />
          </Button>
        </span>
      </div>
      {expanded && (task.context !== undefined || task.threads.some((thread) => thread.mine)) ? (
        <ul className="mt-px mb-1 ml-3 flex flex-col border-l border-sidebar-border pl-1">
          {task.context === undefined ? null : (
            <ContextRow context={task.context} label="Task context" activeThread={activeThread} />
          )}
          <ThreadList
            scope={scope}
            threads={task.threads}
            taskId={task.id}
            tasks={tasks}
            plugins={plugins}
            activeThread={activeThread}
            actions={actions}
          />
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The shared context of a task, or of the project's work on no task: where the
 * work stands, as the agent keeping it put it, and how much waits for that
 * agent to fold in. It opens the page that shows it; the team's threads are
 * there too, not in the tree.
 */
export function ContextRow({
  context,
  label,
  activeThread,
}: {
  readonly context: WorkContextNode;
  readonly label: string;
  readonly activeThread: string | null;
}) {
  const navigate = useNavigate();
  const active =
    activeThread === `context:${context.workspace}:${context.project}:${context.scope}`;
  const keeper =
    context.keeper === undefined
      ? "Nobody keeps it now"
      : context.keeper.mine
        ? "Your agent keeps it"
        : `${context.keeper.person}’s agent keeps it`;
  const written =
    context.version === 0
      ? "nothing written yet"
      : `version ${context.version}, ${formatRelativeTimeLabel(context.updatedAt)}`;
  return (
    <li className="list-none">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              className={cn(
                "my-0.5 flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-left text-xs text-muted-foreground",
                TONE_SURFACE.knowledge,
                active ? "ring-1 ring-peer-knowledge/50" : "hover:brightness-110",
              )}
              onClick={() =>
                void navigate({
                  to: "/context/$workspace/$project/$scope",
                  params: {
                    workspace: context.workspace,
                    project: context.project,
                    scope: context.scope,
                  },
                })
              }
            />
          }
        >
          <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-peer-knowledge-foreground" />
          <span className="shrink-0 font-medium text-peer-knowledge-foreground">{label}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">v{context.version}</span>
          <span className="min-w-0 flex-1 truncate">
            {context.gist ?? (context.version === 0 ? "nothing written yet" : "")}
          </span>
          {context.reports.length > 0 ? (
            <Badge variant="knowledge" size="sm">
              {context.reports.length} new
            </Badge>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">
          {keeper} · {written}
          {context.tokens > 0 ? ` · ${contextSize(context.tokens)}` : ""}
        </TooltipPopup>
      </Tooltip>
    </li>
  );
}
