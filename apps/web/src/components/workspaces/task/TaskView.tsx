import { needsByOpen } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { cn } from "../../../lib/utils";
import { formatShortTimestamp } from "../../../timestampFormat";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { agentLook, TitleInput } from "../marks";
import { PeerPageHeader, TaskKey } from "../PeerPageHeader";
import { MoveUnderDialog } from "../MoveUnderDialog";
import { NewTaskDialog } from "../NewTaskDialog";
import { TONE_BADGE } from "../signals";
import {
  canLaunch,
  kindChange,
  launchPrompt,
  progressLabel,
  servesTree,
  settleChange,
  taskItems,
} from "../taskTree.logic";
import type { PeerWebPlugin } from "../slots.types";
import { projectCheckout } from "../useOpenWorkspaceProject";
import { below, pickFromMenu, type MenuPosition, type WorkActions } from "../useWorkActions";
import { useWorkData } from "../useWorkData";
import { taskMenuItems } from "../workMenus.logic";
import { taskLabel, type WorkTaskNode, type WorkThreadNode } from "../workTree.logic";
import {
  findTask,
  taskPageModel,
  type TaskPageIds,
  type TaskPageModel,
  type TaskPerson,
} from "./task.logic";
import { TaskActivity } from "./TaskActivity";
import {
  DecisionBar,
  TaskChats,
  TaskContextSection,
  TaskDetails,
  TaskItems,
  WaitsOnYou,
} from "./TaskSections";
import { taskMenuAction } from "./taskMenu.logic";

/**
 * A task's page, which its title opens: what state it is in and what waits on the person, its
 * chats (a colleague's can only be asked about), the task context, what lately happened, and the
 * details behind a fold. The primary action follows the state. A task with items lists them, and an
 * agent started on a group (or a task worked by its parts) gets its open items; an item nobody
 * decided how to run asks that first and starts nothing.
 */
export function TaskView({
  workspace,
  project,
  task,
}: {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}) {
  const { environmentId, status, plugins, tree, here, needs, actions } = useWorkData();
  const now = useRelativeTimeTick(30_000);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const ids: TaskPageIds = { workspace, project, task };
  const waiting = needsByOpen(needs);
  // This computer's provider instances name an agent better than the harness a Peer thread reports.
  const agentName = (thread: WorkThreadNode) =>
    thread.agent !== undefined && "instanceId" in thread.agent
      ? agentLook(thread.agent, here.providers)?.displayName
      : undefined;
  const clock = (at: string) => formatShortTimestamp(at, timestampFormat);
  const found = findTask(tree, ids);
  const model =
    status === null
      ? null
      : taskPageModel({ tree, ids, needs: waiting, status, now, agentName, clock });
  const projectName =
    found?.project.name ??
    status?.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.projects.find((candidate) => candidate.project.id === project)?.project.name ??
    project;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          page={model?.key ?? model?.title ?? "Task"}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === null || environmentId === null ? (
            <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
              Connecting…
            </p>
          ) : model === null || found === undefined ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              This task is no longer on the project.
            </p>
          ) : (
            <TaskBody
              key={`${environmentId}:${workspace}:${project}:${task}`}
              environmentId={environmentId}
              status={status}
              plugins={plugins}
              actions={actions}
              ids={ids}
              found={found}
              model={model}
              needs={waiting}
              now={now}
            />
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function TaskBody({
  environmentId,
  status,
  plugins,
  actions,
  ids,
  found,
  model,
  needs,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly actions: WorkActions;
  readonly ids: TaskPageIds;
  readonly found: NonNullable<ReturnType<typeof findTask>>;
  readonly model: TaskPageModel;
  readonly needs: ReturnType<typeof needsByOpen>;
  readonly now: number;
}) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [treeDialog, setTreeDialog] = useState<"add-under" | "move-under" | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [asking, setAsking] = useState<{ readonly recipient: string | undefined } | null>(null);
  // The requests plugin lends its dialog through a slot, so this page imports nothing of it.
  const RequestDialog = plugins.find(
    (plugin) => plugin.requestTeammate !== undefined,
  )?.requestTeammate;
  const { workspace, project, task: taskId } = ids;
  const taskNode = found.task;
  const projectState = status.workspaces
    .find((candidate) => candidate.slug === workspace)
    ?.projects.find((candidate) => candidate.project.id === project);
  const t3ProjectId =
    projectState === undefined ? undefined : projectCheckout(projectState).projectId;
  const scope = { workspace, projectId: project };
  const hubTask = found.project.tasks.find((candidate) => candidate.id === taskId);
  const slot = { environmentId, status, workspace, project: projectState, task: taskNode };
  const label = taskLabel(taskNode);
  const primary = model.primary;
  const Preparation = plugins.find(
    (plugin) => plugin.taskPreparation !== undefined,
  )?.taskPreparation;
  const Launcher = plugins.find((plugin) => plugin.taskLauncher !== undefined)?.taskLauncher;
  const tree = servesTree(found.project);
  const unsettled = tree && taskNode.unsettled === true && !taskNode.done;
  const launchable = canLaunch(taskNode) || !tree;
  // A leaf that runs as one keeps the brief's prompt; a group gets its open items.
  const initialPrompt = launchPrompt(found.project, taskNode);
  const items = taskItems(found.project, taskNode, needs);
  const progress = progressLabel(taskNode);
  const preparing =
    launchable &&
    !taskNode.done &&
    taskNode.threads.length === 0 &&
    Launcher !== undefined &&
    projectState !== undefined;

  const startChat = () => {
    if (t3ProjectId !== undefined) void actions.startThread(scope, taskNode.id, t3ProjectId);
  };
  const openReview = () =>
    void navigate({
      to: "/review/$workspace/$project/$task",
      params: { workspace, project, task: taskId },
    });
  const openTask = (task: WorkTaskNode) =>
    void navigate({
      to: "/task/$workspace/$project/$task",
      params: { workspace, project, task: task.id },
    });
  const decide = async (asOne: boolean) => {
    setDeciding(true);
    await actions.changeTaskTree(scope, taskNode, settleChange(asOne));
    setDeciding(false);
  };
  const openContext = () =>
    void navigate({
      to: "/context/$workspace/$project/$scope",
      params: { workspace, project, scope: `task:${taskId}` },
    });

  // The row's menu, with the same plugin entries, and the same things done with each choice.
  const showMenu = async (position: MenuPosition) => {
    const entries = plugins.flatMap((plugin) => plugin.taskMenu?.(slot) ?? []);
    const choice = await pickFromMenu(
      [
        ...taskMenuItems({
          task: taskNode,
          canStartThread: t3ProjectId !== undefined,
          inReview: taskNode.inReview === true,
          areas: found.project.areas.flatMap((area) => (area.name === null ? [] : [area.name])),
          area: hubTask?.area,
          tree,
        }),
        ...entries.map((entry) => entry.item),
      ],
      position,
    );
    const action = taskMenuAction(choice, entries);
    switch (action.kind) {
      case "plugin":
        if (choice !== null) action.entry.run(choice);
        break;
      case "move-area":
        if ((action.area ?? undefined) !== hubTask?.area) {
          void actions.moveTaskToArea(scope, taskNode, action.area);
        }
        break;
      case "new-chat":
        startChat();
        break;
      case "add-under":
      case "move-under":
        setTreeDialog(action.kind);
        break;
      case "set-kind":
        void actions.changeTaskTree(scope, taskNode, kindChange(action.to));
        break;
      case "rename":
        setRenaming(true);
        break;
      case "reopen":
        void actions.setTaskDone(scope, taskNode, false);
        break;
      case "toggle-done":
        void actions.setTaskDone(scope, taskNode, !taskNode.done);
        break;
      case "remove":
        void actions.removeTask(scope, taskNode);
        break;
      case "none":
        break;
    }
  };

  const startButton = (
    <Button
      variant={model.chats.length > 0 || model.offerStart ? "outline" : "default"}
      disabled={t3ProjectId === undefined}
      onClick={startChat}
    >
      {model.chats.length > 0 ? "Start new chat" : "Start a chat"}
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-(--workspace-page-gutter) py-8 sm:py-10">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_26rem] flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {model.key === undefined ? null : <TaskKey>{model.key}</TaskKey>}
            <Badge variant={TONE_BADGE[model.tone]} size="control">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  model.hollow ? "border border-current" : "bg-current",
                )}
              />
              {model.state.label}
            </Badge>
            {model.area === null ? null : (
              <span className="text-sm text-muted-foreground">{model.area}</span>
            )}
            {progress === null ? null : (
              <span className="text-sm text-muted-foreground tabular-nums">{progress} done</span>
            )}
            {plugins.map(({ id, taskBadges: Badges }) =>
              // The handoff badge says "Handoff #n", which the primary action already says.
              Badges === undefined || id === "handoff" ? null : <Badges key={id} {...slot} />,
            )}
          </div>
          {renaming ? (
            <div className="flex max-w-xl">
              <TitleInput
                value={model.title}
                label="Task title"
                onDone={(title) => {
                  setRenaming(false);
                  if (title !== null) void actions.renameTask(scope, taskNode, title);
                }}
              />
            </div>
          ) : (
            <h1 className="max-w-prose text-page-title font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
              {model.title}
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
            <People people={model.people} />
            <span>{model.meta}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {primary.kind === "review" ? (
            <Button onClick={openReview}>{primary.label}</Button>
          ) : primary.kind === "chat" ? (
            <Button onClick={() => actions.open(primary.open)}>{primary.label}</Button>
          ) : null}
          {!preparing &&
          !unsettled &&
          model.chats.length === 0 &&
          (primary.kind === "start" || model.offerStart)
            ? startButton
            : null}
          {plugins.map(({ id, taskActions: Actions, taskLauncher }) =>
            Actions === undefined ||
            (taskLauncher !== undefined &&
              (preparing || !launchable || initialPrompt !== undefined)) ? null : (
              <Actions key={id} {...slot} />
            ),
          )}
          {/* The launcher's own row action starts on the brief, so a group's carries its items. */}
          {Launcher !== undefined &&
          projectState !== undefined &&
          !preparing &&
          launchable &&
          !taskNode.done &&
          initialPrompt !== undefined ? (
            <Launcher
              environmentId={environmentId}
              status={status}
              workspace={workspace}
              project={projectState}
              taskId={taskId}
              taskLabel={label}
              initialPrompt={initialPrompt}
            />
          ) : null}
          <Button
            variant="outline"
            size="icon"
            aria-label={`More for ${label}`}
            onClick={(event) => void showMenu(below(event))}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </div>
      </div>
      {!preparing && t3ProjectId === undefined ? (
        <p className="text-sm text-muted-foreground">
          This project is not open on this computer yet, so a chat cannot start from here. Clone and
          open it first.
        </p>
      ) : null}

      {unsettled ? <DecisionBar busy={deciding} onDecide={(asOne) => void decide(asOne)} /> : null}

      {projectState === undefined ? null : preparing ? (
        <Launcher
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          project={projectState}
          taskId={taskId}
          taskLabel={label}
          preparation={Preparation}
          {...withPrompt(initialPrompt)}
          inline
        />
      ) : Preparation === undefined ? null : (
        <Preparation
          key={`${environmentId}:${status.email}:${workspace}:${project}:${taskId}`}
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          project={projectState}
          taskId={taskId}
        />
      )}

      <WaitsOnYou
        waits={model.waits}
        onOpenReview={primary.kind === "review" ? undefined : openReview}
        onOpenChat={actions.open}
      />

      <div className="flex flex-wrap items-start gap-10">
        <div className="flex min-w-0 flex-[999_1_32rem] flex-col gap-8">
          {preparing && model.chats.length === 0 ? null : (
            <TaskChats
              rows={model.chats}
              onOpen={actions.open}
              onAsk={
                RequestDialog !== undefined
                  ? (row) => setAsking({ recipient: row.email })
                  : undefined
              }
            >
              {model.chats.length > 0 ? startButton : null}
            </TaskChats>
          )}
          <TaskItems
            rows={items}
            onOpen={openTask}
            launcher={
              Launcher === undefined || projectState === undefined
                ? undefined
                : {
                    Launcher,
                    props: { environmentId, status, workspace, project: projectState },
                  }
            }
          />
          <TaskContextSection card={model.context} onOpen={openContext} />
          {plugins.map(({ id, taskSections: Section }) =>
            Section === undefined ? null : <Section key={id} {...slot} />,
          )}
          <TaskActivity
            environmentId={environmentId}
            status={status}
            workspace={workspace}
            project={project}
            task={taskId}
            area={model.area}
            created={model.created}
            now={now}
          />
        </div>
        <aside aria-label="Details" className="flex min-w-0 flex-[1_1_16rem] flex-col">
          <TaskDetails rows={model.details} />
        </aside>
      </div>

      {treeDialog === "add-under" ? (
        <NewTaskDialog
          environmentId={environmentId}
          project={found.project}
          t3ProjectId={t3ProjectId}
          parent={taskId}
          onClose={() => setTreeDialog(null)}
        />
      ) : treeDialog === "move-under" ? (
        <MoveUnderDialog
          project={found.project}
          task={taskNode}
          onMove={(parent) => void actions.moveTaskUnder(scope, taskNode, parent)}
          onClose={() => setTreeDialog(null)}
        />
      ) : null}

      {RequestDialog === undefined ? null : (
        <RequestDialog
          open={asking !== null}
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          environmentId={environmentId}
          status={status}
          project={found.project}
          task={{ id: found.task.id, label: found.task.key ?? found.task.title }}
          prefill={asking ?? undefined}
        />
      )}
    </div>
  );
}

const withPrompt = (initialPrompt: string | undefined) =>
  initialPrompt === undefined ? {} : { initialPrompt };

/** Marks for the people on the task, the person's own in the accent, overlapping. */
function People({ people }: { readonly people: ReadonlyArray<TaskPerson> }) {
  if (people.length === 0) return null;
  return (
    <span className="flex -space-x-1.5">
      {people.slice(0, 5).map((person) => (
        <span
          key={`${person.mine}:${person.name}`}
          aria-hidden
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2 border-background text-2xs font-semibold",
            person.mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {person.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      ))}
    </span>
  );
}
