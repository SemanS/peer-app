import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import type { PeerTask } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  EllipsisIcon,
  GitBranchIcon,
  LockIcon,
  MessageCircleIcon,
} from "lucide-react";
import { useContext, useState } from "react";

import { cn } from "../../lib/utils";
import { readThreadShell } from "../../state/entities";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Button, InlineButton } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { activeLabel, agentLook, AgentMark, TitleInput, WorkHereContext } from "./marks";
import { TONE_TEXT } from "./signals";
import type { PeerWebPlugin } from "./slots.types";
import {
  agentName,
  chatStateLabel,
  othersLine,
  pullRequestLabel,
  type ChatPullRequest,
} from "./taskChats.logic";
import {
  below,
  type MenuPosition,
  pickFromMenu,
  type Scope,
  type WorkActions,
} from "./useWorkActions";
import { StateDot } from "./workStatus";
import { threadMenuItems } from "./workMenus.logic";
import { openKey, type AgentNeed, type WorkTaskNode, type WorkThreadNode } from "./workTree.logic";

const NO_NEEDS: ReadonlyMap<string, AgentNeed> = new Map();
const NO_PULL_REQUESTS: ReadonlyMap<string, ReadonlyArray<ChatPullRequest>> = new Map();

/** A task's threads in the tree: yours. The team's are counted in a line, not listed. */
function ThreadList({
  scope,
  threads,
  taskId,
  tasks,
  plugins,
  activeThread,
  actions,
  needOf = NO_NEEDS,
  pullRequests = NO_PULL_REQUESTS,
}: {
  readonly scope: Scope;
  readonly threads: ReadonlyArray<WorkThreadNode>;
  readonly taskId: string | null;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
  /** What each of your waiting chats waits for, which tells an approval from an answer. */
  readonly needOf?: ReadonlyMap<string, AgentNeed>;
  /** Each chat's pull requests by its key; a chat with none says nothing of them. */
  readonly pullRequests?: ReadonlyMap<string, ReadonlyArray<ChatPullRequest>>;
}) {
  return (
    <>
      {threads
        .filter((thread) => thread.mine)
        .map((thread) => (
          <ThreadCard
            key={thread.key}
            scope={scope}
            thread={thread}
            taskId={taskId}
            tasks={tasks}
            plugins={plugins}
            activeThread={activeThread}
            actions={actions}
            needOf={needOf}
            pullRequests={pullRequests}
          />
        ))}
    </>
  );
}

/**
 * What a task row shows once its chevron is opened: the person's own chats with their agents'
 * states, one line for the colleagues' chats and why they are not here, and the way to the task.
 */
export function TaskChats({
  id,
  scope,
  task,
  tasks,
  plugins,
  activeThread,
  actions,
  needOf,
  pullRequests,
  onOpenTask,
}: {
  /** The element id the chevron controls. */
  readonly id: string;
  readonly scope: Scope;
  readonly task: WorkTaskNode;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
  readonly needOf: ReadonlyMap<string, AgentNeed>;
  readonly pullRequests: ReadonlyMap<string, ReadonlyArray<ChatPullRequest>>;
  /** Opens the task; undefined while there is nowhere to open it. */
  readonly onOpenTask: (() => void) | undefined;
}) {
  const others = othersLine(task.threads);
  return (
    <div id={id} className="flex flex-col gap-1 pr-1 pb-2 pl-6">
      {task.threads.some((thread) => thread.mine) ? (
        <ul className="flex flex-col">
          <ThreadList
            scope={scope}
            threads={task.threads}
            taskId={task.id}
            tasks={tasks}
            plugins={plugins}
            activeThread={activeThread}
            actions={actions}
            needOf={needOf}
            pullRequests={pullRequests}
          />
        </ul>
      ) : null}
      {others === undefined ? null : (
        <div className="flex gap-2 rounded-md bg-sidebar-control-surface px-2 py-1.5">
          <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-sidebar-foreground">{others.headline}</span>
            <span className="text-2xs text-muted-foreground">{others.note}</span>
          </div>
        </div>
      )}
      {onOpenTask === undefined ? null : (
        <div className="flex pl-1.5 text-xs">
          <InlineButton tone="muted" onClick={onOpenTask}>
            Open task
            <ArrowRightIcon aria-hidden className="size-3" />
          </InlineButton>
        </div>
      )}
    </div>
  );
}

/**
 * One of your chats on a task: its title, and its agent's state on the right ("Claude · working
 * 3m"). On this computer it opens on click and renames, moves, archives or deletes from its menu;
 * one on another computer opens only where the team can watch it.
 */
function ThreadCard({
  scope,
  thread,
  taskId,
  tasks,
  plugins,
  activeThread,
  actions,
  needOf,
  pullRequests,
}: {
  readonly scope: Scope;
  readonly thread: WorkThreadNode;
  /** The task it sits under here, null under "Not on a task". */
  readonly taskId: string | null;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
  readonly needOf: ReadonlyMap<string, AgentNeed>;
  readonly pullRequests: ReadonlyMap<string, ReadonlyArray<ChatPullRequest>>;
}) {
  const [renaming, setRenaming] = useState(false);
  const open = thread.open;
  const local = open?.kind === "thread" ? open : undefined;
  const actionable = thread.mine && thread.placeable;
  const active = open !== undefined && activeThread === openKey(open);
  const here = useContext(WorkHereContext);
  const look = agentLook(thread.agent, here.providers);
  const elsewhere = !actionable && thread.localEnvironment !== true;
  const machine = elsewhere ? "Your other computer" : (here.label ?? "This computer");
  const state = chatStateLabel(thread, {
    agent: agentName(look?.displayName),
    needOf,
    since: activeLabel(thread.activeAt),
  });
  const pullRequest = pullRequestLabel(pullRequests.get(thread.key) ?? []);
  const details = [
    elsewhere
      ? thread.observable
        ? "Yours on another computer: open it to watch it"
        : "Yours on another computer: open it there"
      : thread.observable
        ? "The team can watch it"
        : null,
    thread.stale ? "Agent unavailable; its work and saved context remain here" : null,
    thread.keepsContext ? "Keeps the task’s shared context" : null,
    thread.delivery === "review" ? "Waiting for every linked pull request to merge" : null,
  ].filter((line) => line !== null);

  const showMenu = async (position: MenuPosition) => {
    const shell =
      local === undefined
        ? null
        : readThreadShell(scopeThreadRef(local.environmentId, local.threadId));
    const entries = plugins.flatMap(
      (plugin) => plugin.threadMenu?.(thread, actions.environmentId) ?? [],
    );
    const choice = await pickFromMenu(
      threadMenuItems({
        thread,
        tasks,
        taskId,
        running: shell !== null && !threadRuntimeCanArchive(shell.runtime),
        entries,
      }),
      position,
    );
    if (choice === null || choice === "move") return;
    if (choice === "rename") setRenaming(true);
    else if (choice === "archive") {
      if (local !== undefined) void actions.archiveThread(local, thread.title);
    } else if (choice === "delete") {
      if (local !== undefined) void actions.deleteThread(local);
    } else if (choice === "unassign") void actions.placeThread(scope, thread.key, null);
    else if (choice.startsWith("task:")) {
      void actions.placeThread(scope, thread.key, choice.slice("task:".length));
    } else entries.find((entry) => entry.item.id === choice)?.run();
  };

  return (
    <li className="list-none py-px">
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role={open === undefined ? undefined : "button"}
              tabIndex={open === undefined ? undefined : 0}
              aria-label={[thread.title, state.label, pullRequest]
                .filter((part) => part !== undefined)
                .join(", ")}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group/work-thread relative flex min-h-7 w-full min-w-0 flex-col justify-center rounded-md px-1.5 py-1 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active
                  ? "bg-sidebar-row-active"
                  : open === undefined
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-sidebar-row-hover",
                thread.stale && "opacity-60",
              )}
              onClick={() => {
                if (open !== undefined && !renaming) actions.open(open);
              }}
              onDoubleClick={(event) => {
                if (!actionable || local === undefined) return;
                if ((event.target as HTMLElement).closest("button, input")) return;
                event.preventDefault();
                setRenaming(true);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || open === undefined) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  actions.open(open);
                } else if (event.key === "F2" && actionable && local !== undefined) {
                  event.preventDefault();
                  setRenaming(true);
                }
              }}
              onContextMenu={(event) => {
                if (!actionable) return;
                event.preventDefault();
                void showMenu({ x: event.clientX, y: event.clientY });
              }}
            />
          }
        >
          <div className="flex min-w-0 items-center gap-2">
            <MessageCircleIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {renaming && local !== undefined ? (
              <TitleInput
                value={thread.title}
                label="Chat title"
                onDone={(title) => {
                  setRenaming(false);
                  if (title !== null) void actions.renameThread(local, title, thread.title);
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground">
                {thread.title}
              </span>
            )}
            {plugins.map(({ id, threadBadges: Badges }) =>
              Badges === undefined ? null : <Badges key={id} thread={thread} />,
            )}
            {/* The agent's state at rest; the chat's menu takes the slot on hover or keyboard focus. */}
            <span className="group/thread-slot relative flex h-5 min-w-5 shrink-0 items-center justify-end text-xs">
              <span
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap",
                  TONE_TEXT[state.tone],
                  actionable &&
                    "group-hover/work-thread:pointer-events-none group-hover/work-thread:absolute group-hover/work-thread:right-0 group-hover/work-thread:opacity-0 group-has-[:focus-visible]/thread-slot:pointer-events-none group-has-[:focus-visible]/thread-slot:absolute group-has-[:focus-visible]/thread-slot:right-0 group-has-[:focus-visible]/thread-slot:opacity-0",
                )}
              >
                <StateDot tone={state.tone} small />
                {state.label}
              </span>
              {actionable ? (
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0 group-hover/work-thread:pointer-events-auto group-hover/work-thread:static group-hover/work-thread:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100">
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`More for ${thread.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void showMenu(below(event));
                    }}
                  >
                    <EllipsisIcon className="size-3.5" />
                  </Button>
                </span>
              ) : null}
            </span>
          </div>
          {pullRequest === undefined ? null : (
            <span className="truncate pl-5.5 text-2xs text-muted-foreground">{pullRequest}</span>
          )}
        </TooltipTrigger>
        <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
          <ThreadHoverCard title={thread.title}>
            <div className="flex min-w-0 items-center gap-2">
              <EnvironmentMachineIcon
                kind={elsewhere ? "laptop" : here.machine}
                className="size-3 shrink-0 stroke-muted-foreground"
              />
              <div className="min-w-0 truncate text-foreground/75">{machine}</div>
            </div>
            {thread.branch === undefined ? null : (
              <div className="flex min-w-0 items-center gap-2">
                <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
                <MiddleTruncate value={thread.branch} className="flex" />
              </div>
            )}
            {look === null ? null : (
              <div className="flex min-w-0 items-center gap-2">
                <AgentMark look={look} />
                <div className="min-w-0 truncate text-foreground/75">
                  {look.model ?? look.displayName}
                  {thread.source === "herdr" ? " in herdr" : ""}
                </div>
              </div>
            )}
            {details.map((line) => (
              <div key={line} className="min-w-0 text-foreground/75">
                {line}
              </div>
            ))}
          </ThreadHoverCard>
        </ThreadHoverCardPopup>
      </Tooltip>
    </li>
  );
}
