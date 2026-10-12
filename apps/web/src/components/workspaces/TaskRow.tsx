import type {
  EnvironmentId,
  PeerHubStatus,
  PeerProjectState,
  PeerTask,
  ProjectId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, EllipsisIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TaskChats } from "./ThreadCard";
import { TitleInput } from "./marks";
import type { PeerWebPlugin } from "./slots.types";
import { TONE_SURFACE, TONE_TEXT } from "./signals";
import { pullRequestsByThread, type ChatPullRequest } from "./taskChats.logic";
import { taskRouteKey, taskRowModel, type TaskRowTarget } from "./taskRow.logic";
import {
  below,
  type MenuPosition,
  pickFromMenu,
  type Scope,
  type WorkActions,
} from "./useWorkActions";
import { StateDot } from "./workStatus";
import { taskOverlap } from "./workGroups.logic";
import { chosenArea, taskMenuItems } from "./workMenus.logic";
import {
  contextSize,
  taskLabel,
  type AgentNeed,
  type WorkContextNode,
  type WorkTaskNode,
} from "./workTree.logic";

const NO_PULL_REQUESTS: ReadonlyMap<string, ReadonlyArray<ChatPullRequest>> = new Map();

/**
 * One task of a project, in two lines. The first is its key and title, which open it; the second
 * its state in words (the same as the board's and the task's page), the overlap it is in, and how
 * many chats it has. A chip says what to do only while the task waits on the person, and does
 * that one thing. The chevron alone shows the task's chats; a double click or F2 renames it.
 */
export function TaskRow({
  environmentId,
  projectState,
  status,
  scope,
  task,
  tasks,
  areas,
  plugins,
  t3ProjectId,
  activeThread,
  actions,
  needOf,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectState: PeerProjectState | undefined;
  readonly status: PeerHubStatus;
  readonly scope: Scope;
  readonly task: WorkTaskNode;
  readonly tasks: ReadonlyArray<PeerTask>;
  /** The project's areas in its order, which the task's menu moves it between. */
  readonly areas: ReadonlyArray<string>;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly t3ProjectId: ProjectId | undefined;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
  /** What each of the person's waiting chats waits for, which tells an approval from an answer. */
  readonly needOf: ReadonlyMap<string, AgentNeed>;
}) {
  const navigate = useNavigate();
  // One two-line row per task until its chevron is opened: its chats are a click away.
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const chatsId = useId();
  const label = taskLabel(task);
  const taskArea = tasks.find((t) => t.id === task.id)?.area;
  const model = taskRowModel({
    task,
    scope,
    needOf,
    overlap: taskOverlap(
      status,
      { workspace: scope.workspace, projectId: scope.projectId, tasks },
      task.id,
    ),
  });
  const { chip, overlap, target } = model;
  const hasChats = task.threads.length > 0;
  const active = activeThread === taskRouteKey(scope, task.id);
  const RequestDialog = plugins.find(
    (plugin) => plugin.requestTeammate !== undefined,
  )?.requestTeammate;
  const canRequest = RequestDialog !== undefined && projectState !== undefined;
  const pullRequests = useMemo(
    () => (expanded ? pullRequestsByThread(projectState?.work.threads ?? []) : NO_PULL_REQUESTS),
    [expanded, projectState],
  );

  const go = (to: TaskRowTarget) => {
    if (to.kind === "chat") actions.open(to.open);
    else {
      void navigate({
        to:
          to.kind === "task"
            ? "/task/$workspace/$project/$task"
            : "/review/$workspace/$project/$task",
        params: { workspace: to.workspace, project: to.project, task: to.task },
      });
    }
  };
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
          canRequestTeammate: canRequest,
          inReview: task.inReview === true,
          areas,
          area: taskArea,
        }),
        ...entries.map((entry) => entry.item),
      ],
      position,
    );
    const picked = entries.find(
      (entry) =>
        entry.item.id === choice || entry.item.children?.some((item) => item.id === choice),
    );
    const moved = choice === null ? undefined : chosenArea(choice);
    if (picked && choice !== null) picked.run(choice);
    else if (moved !== undefined) {
      if ((moved.area ?? undefined) !== taskArea)
        void actions.moveTaskToArea(scope, task, moved.area);
    } else if (choice === "new-thread") startThread();
    else if (choice === "request-teammate") setRequesting(true);
    else if (choice === "rename") setRenaming(true);
    else if (choice === "reopen") void actions.setTaskDone(scope, task, false);
    else if (choice === "toggle-done") void actions.setTaskDone(scope, task, !task.done);
    else if (choice === "remove") void actions.removeTask(scope, task);
  };

  const title = (
    <>
      {task.key ? (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">{task.key}</span>
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate text-sm font-medium",
          task.done ? "text-muted-foreground" : "text-sidebar-foreground",
        )}
      >
        {task.title}
      </span>
    </>
  );

  return (
    <li className="list-none">
      <div
        className={cn(
          "group/task relative flex min-w-0 items-start gap-0.5 rounded-lg pr-1",
          active ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
        )}
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          if (event.key === "F2") {
            event.preventDefault();
            setRenaming(true);
          } else if (event.key === "ArrowRight" && hasChats && !expanded) {
            event.preventDefault();
            setExpanded(true);
          } else if (event.key === "ArrowLeft" && expanded) {
            event.preventDefault();
            setExpanded(false);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void showMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {hasChats ? (
          <Button
            size="icon-micro"
            variant="ghost-muted"
            className="mt-1.5 ml-1 shrink-0"
            aria-label={`${expanded ? "Hide" : "Show"} chats of ${task.key ?? task.title}`}
            aria-expanded={expanded}
            aria-controls={expanded ? chatsId : undefined}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRightIcon className={cn("size-3", expanded && "rotate-90")} />
          </Button>
        ) : (
          <span aria-hidden className="ml-1 w-5 shrink-0" />
        )}
        <div
          className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5"
          onDoubleClick={(event) => {
            event.preventDefault();
            setRenaming(true);
          }}
        >
          {renaming ? (
            <TitleInput
              value={task.title}
              label="Task title"
              onDone={(next) => {
                setRenaming(false);
                if (next !== null) void actions.renameTask(scope, task, next);
              }}
            />
          ) : target === undefined ? (
            <div className="flex min-w-0 items-baseline gap-1.5">{title}</div>
          ) : (
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 items-baseline gap-1.5 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => go(target)}
            >
              {title}
            </button>
          )}
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap">
            <StateDot tone={model.look.tone} hollow={model.look.hollow} />
            <span className={cn("shrink-0", TONE_TEXT[model.look.tone])}>{model.state.label}</span>
            {overlap === undefined ? null : (
              <>
                <span aria-hidden className="shrink-0 text-muted-foreground">
                  ·
                </span>
                <button
                  type="button"
                  className={cn(
                    "min-w-0 truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    TONE_TEXT.coordination,
                  )}
                  onClick={() =>
                    void navigate({
                      to: "/overlap/$workspace/$project/$overlap",
                      params: {
                        workspace: scope.workspace,
                        project: scope.projectId,
                        overlap: overlap.id,
                      },
                    })
                  }
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {overlap.label}
                </button>
              </>
            )}
            <span aria-hidden className="shrink-0 text-muted-foreground">
              ·
            </span>
            <span className="shrink-0 text-muted-foreground">{model.chats}</span>
          </span>
        </div>
        {chip === undefined ? null : (
          <Button
            size="xs"
            variant="warning-outline"
            className="my-auto shrink-0"
            aria-label={`${chip.label} ${label}`}
            onClick={() => go(chip.target)}
          >
            {chip.label}
          </Button>
        )}
        {/* Out of the way until the row is hovered or focused, so the title keeps its width. */}
        <span className="pointer-events-none absolute top-0 right-1 mt-1.5 flex h-5 shrink-0 items-center opacity-0 group-hover/task:pointer-events-auto group-hover/task:static group-hover/task:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 max-md:pointer-events-auto max-md:static max-md:opacity-100">
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
                  aria-label={`New chat on ${label}`}
                  disabled={t3ProjectId === undefined}
                  onClick={startThread}
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {t3ProjectId === undefined ? "Clone the project first" : "New chat on this task"}
            </TooltipPopup>
          </Tooltip>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`More for ${label}`}
            onClick={(event) => void showMenu(below(event))}
          >
            <EllipsisIcon className="size-3.5" />
          </Button>
        </span>
      </div>
      {expanded && hasChats ? (
        <TaskChats
          id={chatsId}
          scope={scope}
          task={task}
          tasks={tasks}
          plugins={plugins}
          activeThread={activeThread}
          actions={actions}
          needOf={needOf}
          pullRequests={pullRequests}
          onOpenTask={target === undefined ? undefined : () => go(target)}
        />
      ) : null}
      {requesting && canRequest ? (
        <RequestDialog
          environmentId={environmentId}
          status={status}
          project={{
            workspace: scope.workspace,
            projectId: scope.projectId,
            name: projectState.project.name,
          }}
          task={{ id: task.id, label }}
          open
          onOpenChange={(open) => {
            if (!open) setRequesting(false);
          }}
        />
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
