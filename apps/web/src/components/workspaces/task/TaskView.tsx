import { needsByOpen } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { cn } from "../../../lib/utils";
import { formatShortTimestamp } from "../../../timestampFormat";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { agentLook, TitleInput } from "../marks";
import { PeerPageHeader, TaskKey } from "../PeerPageHeader";
import { TONE_BADGE } from "../signals";
import type { PeerWebPlugin } from "../slots.types";
import { projectCheckout } from "../useOpenWorkspaceProject";
import { below, pickFromMenu, type MenuPosition, type WorkActions } from "../useWorkActions";
import { useWorkData } from "../useWorkData";
import { taskMenuItems } from "../workMenus.logic";
import { taskLabel, type WorkThreadNode } from "../workTree.logic";
import {
  findTask,
  taskPageModel,
  type TaskPageIds,
  type TaskPageModel,
  type TaskPerson,
} from "./task.logic";
import { TaskActivity } from "./TaskActivity";
import { TaskChats, TaskContextSection, TaskDetails, WaitsOnYou } from "./TaskSections";
import { taskMenuAction } from "./taskMenu.logic";

/**
 * A task's page, which its title opens: what state it is in and what waits on the person, its
 * chats (a colleague's can only be asked about), the task context, what lately happened, and the
 * details behind a fold. The primary action follows the state.
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
  const ids = useMemo<TaskPageIds>(
    () => ({ workspace, project, task }),
    [workspace, project, task],
  );
  const waiting = useMemo(() => needsByOpen(needs), [needs]);
  // This computer's provider instances name an agent better than the harness a Peer thread reports.
  const agentName = useCallback(
    (thread: WorkThreadNode) =>
      thread.agent !== undefined && "instanceId" in thread.agent
        ? agentLook(thread.agent, here.providers)?.displayName
        : undefined,
    [here.providers],
  );
  const clock = useCallback(
    (at: string) => formatShortTimestamp(at, timestampFormat),
    [timestampFormat],
  );
  const found = findTask(tree, ids);
  const model = useMemo(
    () =>
      status === null
        ? null
        : taskPageModel({ tree, ids, needs: waiting, status, now, agentName, clock }),
    [agentName, clock, ids, now, status, tree, waiting],
  );
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
              environmentId={environmentId}
              status={status}
              plugins={plugins}
              actions={actions}
              ids={ids}
              found={found}
              model={model}
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
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly actions: WorkActions;
  readonly ids: TaskPageIds;
  readonly found: NonNullable<ReturnType<typeof findTask>>;
  readonly model: TaskPageModel;
  readonly now: number;
}) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
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

  const startChat = () => {
    if (t3ProjectId !== undefined) void actions.startThread(scope, taskNode.id, t3ProjectId);
  };
  const openReview = () =>
    void navigate({
      to: "/review/$workspace/$project/$task",
      params: { workspace, project, task: taskId },
    });
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
      variant={model.offerStart ? "outline" : "default"}
      disabled={t3ProjectId === undefined}
      onClick={startChat}
    >
      Start a chat
    </Button>
  );

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-7">
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
              <Badge variant="outline" size="control">
                {model.area}
              </Badge>
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
            <h1 className="text-2xl font-semibold tracking-tight break-words text-foreground">
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
          {primary.kind === "start" || model.offerStart ? startButton : null}
          {plugins.map(({ id, taskActions: Actions }) =>
            Actions === undefined ? null : <Actions key={id} {...slot} />,
          )}
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
      {t3ProjectId === undefined ? (
        <p className="text-sm text-muted-foreground">
          This project is not open on this computer yet, so a chat cannot start from here. Clone and
          open it first.
        </p>
      ) : null}

      <WaitsOnYou waits={model.waits} onOpenReview={openReview} onOpenChat={actions.open} />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_32rem] flex-col gap-6">
          <TaskChats
            rows={model.chats}
            onOpen={actions.open}
            onAsk={
              RequestDialog !== undefined ? (row) => setAsking({ recipient: row.email }) : undefined
            }
          />
          <TaskContextSection card={model.context} onOpen={openContext} />
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
