import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import type { PeerTask } from "@t3tools/contracts";
import { EllipsisIcon, FileTextIcon, GitBranchIcon } from "lucide-react";
import { useContext, useState } from "react";

import { cn } from "../../lib/utils";
import { readThreadShell } from "../../state/entities";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Button } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import {
  activeLabel,
  agentLook,
  AgentMark,
  PersonMark,
  TitleInput,
  WorkHereContext,
} from "./marks";
import type { PeerWebPlugin } from "./slots";
import {
  below,
  type MenuPosition,
  pickFromMenu,
  type Scope,
  type WorkActions,
} from "./useWorkActions";
import { STATUS_LABEL, STATUS_TONE, StatusIcon } from "./workStatus";
import { threadMenuItems } from "./workMenus.logic";
import { openKey, type WorkThreadNode } from "./workTree.logic";

/** A task's threads in the tree: yours. The team's are on the task's context page. */
export function ThreadList({
  scope,
  threads,
  taskId,
  tasks,
  plugins,
  activeThread,
  actions,
}: {
  readonly scope: Scope;
  readonly threads: ReadonlyArray<WorkThreadNode>;
  readonly taskId: string | null;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
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
          />
        ))}
    </>
  );
}

/**
 * One thread as the Threads list shows it: who and how it is doing, the
 * title, then branch and agent. Your own carry the accent and, on this
 * computer, open on click and rename, move, archive or delete from their
 * menu; a colleague's are read-only and quieter.
 */
function ThreadCard({
  scope,
  thread,
  taskId,
  tasks,
  plugins,
  activeThread,
  actions,
}: {
  readonly scope: Scope;
  readonly thread: WorkThreadNode;
  /** The task it sits under here, null under "Not on a task". */
  readonly taskId: string | null;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const open = thread.open;
  const local = open?.kind === "thread" ? open : undefined;
  const actionable = thread.mine && thread.placeable;
  const active = open !== undefined && activeThread === openKey(open);
  const here = useContext(WorkHereContext);
  const look = agentLook(thread.agent, here.providers);
  const elsewhere = !actionable && thread.localEnvironment !== true;
  const who = thread.mine ? (elsewhere ? "You · other computer" : "You") : thread.person;
  const machine = !thread.mine
    ? `${thread.person}’s computer`
    : elsewhere
      ? "Your other computer"
      : (here.label ?? "This computer");
  const details = [
    thread.mine
      ? elsewhere
        ? thread.observable
          ? "Yours on another computer: open it to watch it"
          : "Yours on another computer: open it there"
        : thread.observable
          ? "The team can watch it"
          : null
      : thread.observable
        ? `${thread.person} shares it: open it to watch it live`
        : `${thread.person}’s thread: only they change it`,
    thread.stale ? "Agent unavailable; its work and saved context remain here" : null,
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

  const runtimeLabel = thread.status === "done" ? "Turn finished" : STATUS_LABEL[thread.status];
  const statusLabel = thread.stale ? (
    <span className="text-muted-foreground">Agent offline</span>
  ) : thread.status === "idle" || thread.status === "unknown" ? (
    <span className="text-secondary-label tabular-nums">{activeLabel(thread.activeAt)}</span>
  ) : (
    <span className={cn("inline-flex items-center gap-1 font-medium", STATUS_TONE[thread.status])}>
      <StatusIcon status={thread.status} />
      {runtimeLabel}
    </span>
  );

  return (
    <li className="list-none py-px">
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role={open === undefined ? undefined : "button"}
              tabIndex={open === undefined ? undefined : 0}
              aria-label={`${thread.title}, ${who}, ${runtimeLabel}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group/work-thread relative w-full overflow-hidden rounded-md px-2.5 py-1.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
          {thread.mine ? (
            <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
          ) : null}
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            <PersonMark name={thread.person} mine={thread.mine} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                thread.mine ? "font-medium text-sidebar-foreground" : "text-secondary-label",
              )}
            >
              {who}
            </span>
            {thread.keepsContext ? (
              <FileTextIcon
                aria-label="Keeps the task's shared context"
                className="size-3 shrink-0 text-muted-foreground"
              />
            ) : null}
            {plugins.map(({ id, threadBadges: Badges }) =>
              Badges === undefined ? null : <Badges key={id} thread={thread} />,
            )}
            {/* The state at rest; the thread's menu takes the slot on hover or keyboard focus. */}
            <span className="group/thread-slot relative flex h-5 min-w-5 shrink-0 items-center justify-end text-xs">
              <span
                className={cn(
                  "flex items-center",
                  actionable &&
                    "group-hover/work-thread:pointer-events-none group-hover/work-thread:absolute group-hover/work-thread:right-0 group-hover/work-thread:opacity-0 group-has-[:focus-visible]/thread-slot:pointer-events-none group-has-[:focus-visible]/thread-slot:absolute group-has-[:focus-visible]/thread-slot:right-0 group-has-[:focus-visible]/thread-slot:opacity-0",
                )}
              >
                {statusLabel}
                {thread.delivery === undefined ? null : (
                  <span className="text-muted-foreground">
                    ·{" "}
                    {
                      {
                        open: "In progress",
                        review: "Awaiting merge",
                        merged: "Merged",
                        closed: "Closed",
                      }[thread.delivery]
                    }
                  </span>
                )}
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
          <div className="mt-0.5 flex min-w-0">
            {renaming && local !== undefined ? (
              <TitleInput
                value={thread.title}
                label="Thread title"
                onDone={(title) => {
                  setRenaming(false);
                  if (title !== null) void actions.renameThread(local, title, thread.title);
                }}
              />
            ) : (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  thread.mine ? "font-medium text-foreground" : "text-secondary-label",
                )}
              >
                {thread.title}
              </span>
            )}
          </div>
          {thread.concerns === undefined ? null : (
            <p className="mt-0.5 truncate text-xs text-warning-foreground">{thread.concerns}</p>
          )}
          {thread.branch !== undefined || look !== null || thread.source === "herdr" ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-secondary-label">
              {thread.branch !== undefined ? (
                <>
                  <GitBranchIcon aria-hidden className="size-3 shrink-0 opacity-50" />
                  <span className="flex min-w-0 flex-1 text-muted-foreground/60">
                    <MiddleTruncate value={thread.branch} showTitle={false} />
                  </span>
                </>
              ) : (
                <span className="flex-1" />
              )}
              <span aria-hidden className="ml-auto inline-flex shrink-0 items-center gap-1.5">
                {thread.source === "herdr" ? (
                  <span className="text-2xs text-muted-foreground/70">herdr</span>
                ) : null}
                <AgentMark look={look} />
              </span>
            </div>
          ) : null}
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
