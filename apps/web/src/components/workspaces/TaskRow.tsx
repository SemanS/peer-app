import type {
  EnvironmentId,
  PeerHubStatus,
  PeerProjectState,
  PeerTask,
  ProjectId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, PlusIcon } from "lucide-react";
import { taskOwnership } from "@t3tools/client-runtime/peer/work";
import { taskShortTitle } from "@t3tools/client-runtime/peer/taskTitle";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TitleInput } from "./marks";
import { MoveUnderDialog } from "./MoveUnderDialog";
import { NewTaskDialog } from "./NewTaskDialog";
import type { PeerWebPlugin } from "./slots.types";
import { TONE_TEXT } from "./signals";
import {
  rowStateLabel,
  taskRouteKey,
  taskRowModel,
  taskRowTarget,
  type TaskRowTarget,
} from "./taskRow.logic";
import { kindChange, servesTree } from "./taskTree.logic";
import {
  below,
  type MenuPosition,
  pickFromMenu,
  type Scope,
  type WorkActions,
} from "./useWorkActions";
import { StateDot } from "./workStatus";
import { taskBlocked } from "./dependencies/dependencies.logic";
import { chosenArea, taskMenuItems } from "./workMenus.logic";
import {
  taskLabel,
  type AgentNeed,
  type WorkProjectNode,
  type WorkTaskNode,
} from "./workTree.logic";

/**
 * One task of a project: its state's dot, its key and short name, which open it, and under them its
 * state in words once there is one to say. Runs, chats and what the task asks are on its page and in
 * Needs your attention. A double click or F2 renames it. An item of a task tree is indented under
 * the row of its parent.
 */
export function TaskRow({
  environmentId,
  projectState,
  project,
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
  indent = 0,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectState: PeerProjectState | undefined;
  /** The task's project in the work tree: its tasks and areas, for the request dialog. */
  readonly project: WorkProjectNode;
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
  /** How many of its ancestors the list shows above it. */
  readonly indent?: number;
}) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [treeDialog, setTreeDialog] = useState<"add-under" | "move-under" | null>(null);
  const tree = servesTree(project);
  const label = taskLabel(task);
  const taskArea = tasks.find((t) => t.id === task.id)?.area;
  const model = taskRowModel({
    task,
    scope,
    needOf,
    review: taskOwnership(project, task, taskArea ?? null).review,
  });
  const { target } = model;
  const blocked = taskBlocked(status, scope.workspace, projectState, task.id);
  const stateLabel = rowStateLabel(model.state, blocked);
  const active = activeThread === taskRouteKey(scope, task.id);
  const RequestDialog = plugins.find(
    (plugin) => plugin.requestTeammate !== undefined,
  )?.requestTeammate;
  const canRequest = RequestDialog !== undefined && projectState !== undefined;

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
          showTaskDetails: target?.kind === "review",
          areas,
          area: taskArea,
          tree,
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
    } else if (choice === "task-details") go(taskRowTarget(task, scope));
    else if (choice === "new-thread") startThread();
    else if (choice === "request-teammate") setRequesting(true);
    else if (choice === "add-under" || choice === "move-under") setTreeDialog(choice);
    else if (choice === "make-group" || choice === "make-task")
      void actions.changeTaskTree(
        scope,
        task,
        kindChange(choice === "make-group" ? "group" : "task"),
      );
    else if (choice === "rename") setRenaming(true);
    else if (choice === "reopen") void actions.setTaskDone(scope, task, false);
    else if (choice === "toggle-done") void actions.setTaskDone(scope, task, !task.done);
    else if (choice === "remove") void actions.removeTask(scope, task);
  };

  const title = (
    <>
      {task.key ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{task.key}</span>
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          task.done ? "text-muted-foreground" : "text-sidebar-foreground",
        )}
      >
        {taskShortTitle(task.title)}
      </span>
    </>
  );

  return (
    <li
      className="list-none"
      style={indent === 0 ? undefined : { paddingInlineStart: `${indent * 0.75}rem` }}
    >
      <div
        className={cn(
          "group/task relative flex min-w-0 items-center gap-2 rounded-lg pr-1 pl-2",
          active ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
        )}
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          if (event.key === "F2") {
            event.preventDefault();
            setRenaming(true);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void showMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <StateDot tone={model.look.tone} hollow={model.look.hollow} />
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    className="flex min-w-0 items-baseline gap-1.5 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => go(target)}
                  />
                }
              >
                {title}
              </TooltipTrigger>
              <TooltipPopup side="right">{task.title}</TooltipPopup>
            </Tooltip>
          )}
          {stateLabel === undefined ? null : (
            <span className={cn("truncate text-xs", TONE_TEXT[model.look.tone])}>{stateLabel}</span>
          )}
        </div>
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
      {treeDialog === "add-under" ? (
        <NewTaskDialog
          environmentId={environmentId}
          project={project}
          t3ProjectId={t3ProjectId}
          parent={task.id}
          onClose={() => setTreeDialog(null)}
        />
      ) : treeDialog === "move-under" ? (
        <MoveUnderDialog
          project={project}
          task={task}
          onMove={(parent) => void actions.moveTaskUnder(scope, task, parent)}
          onClose={() => setTreeDialog(null)}
        />
      ) : null}
      {requesting && canRequest ? (
        <RequestDialog
          environmentId={environmentId}
          status={status}
          project={project}
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
