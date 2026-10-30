/**
 * The sections of a task's page that only show what the model says: what waits on the person, the
 * chats no run covers, the task context card and the folded details. They hold no data of their
 * own; what a button does is the page's to say.
 */
import {
  ChevronRightIcon,
  CircleHelpIcon,
  PlayIcon,
  FileTextIcon,
  MessageCircleQuestionIcon,
  PackageCheckIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { useState, type ComponentType } from "react";

import { cn } from "../../../lib/utils";
import { useThreadProjection } from "../../../state/entities";
import { Button, InlineButton } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { PeerSectionLabel } from "../PeerPageHeader";
import { TONE_SURFACE, TONE_TEXT } from "../signals";
import { taskStateLook } from "../taskRow.logic";
import {
  emptySelection,
  liveSelection,
  selectableTask,
  selectionMark,
  selectionPrompt,
  selectionRoots,
  selectRange,
  toggleSelected,
  treeIndexOf,
  unsettledIn,
  type TaskItemRow,
} from "../taskTree.logic";
import { StateDot } from "../workStatus";
import type { TaskLauncherProps } from "../slots.types";
import {
  taskLabel,
  type WorkOpen,
  type WorkProjectNode,
  type WorkTaskNode,
} from "../workTree.logic";
import type { TaskWait } from "./task.logic";
import type { TaskChatRow } from "./taskChats.logic";
import type { TaskContextCard, TaskDetail } from "./taskDetails.logic";

const WAIT_ICON = {
  review: PackageCheckIcon,
  approval: ShieldCheckIcon,
  input: MessageCircleQuestionIcon,
} as const;

/** What waits on the person, in the amber of Needs you, each with the one thing that does it. */
export function WaitsOnYou({
  waits,
  onOpenReview,
  onOpenChat,
}: {
  readonly waits: ReadonlyArray<TaskWait>;
  readonly onOpenReview?: (() => void) | undefined;
  readonly onOpenChat: (open: WorkOpen) => void;
}) {
  if (waits.length === 0) return null;
  return (
    <section
      aria-label="What waits on you"
      className={cn("flex flex-col rounded-xl border", TONE_SURFACE.needs)}
    >
      {waits.map((wait, index) => {
        const Icon = WAIT_ICON[wait.kind];
        return (
          <div
            key={wait.key}
            className={cn(
              "flex flex-wrap items-center gap-3.5 px-4 py-3.5",
              index > 0 && "border-t border-warning/30",
            )}
          >
            <Icon aria-hidden className={cn("size-5 shrink-0", TONE_TEXT.needs)} />
            <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">{wait.title}</span>
              <span className="text-sm text-muted-foreground">{wait.detail}</span>
              {wait.kind === "input" && wait.question !== undefined ? (
                <p className="max-w-prose text-sm text-foreground">{wait.question}</p>
              ) : wait.kind === "input" && wait.open?.kind === "thread" ? (
                <PendingQuestion open={wait.open} />
              ) : null}
            </div>
            {wait.kind === "review" ? (
              onOpenReview === undefined ? null : (
                <Button variant="warning-outline" size="sm" onClick={onOpenReview}>
                  Open review
                </Button>
              )
            ) : wait.open === undefined ? null : (
              <Button
                variant="warning-outline"
                size="sm"
                onClick={() => {
                  if (wait.open !== undefined) onOpenChat(wait.open);
                }}
              >
                Open chat
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The question a chat of this computer waits on, so the person decides from the task page whether
 * to open it: the first pending question's heading and text, from the thread's projection. A chat
 * whose projection is not loaded, or a herdr agent's, shows only that it asks.
 */
function PendingQuestion({ open }: { readonly open: Extract<WorkOpen, { kind: "thread" }> }) {
  const thread = useThreadProjection({
    environmentId: open.environmentId,
    threadId: open.threadId,
  });
  const question =
    thread === null
      ? undefined
      : derivePendingThreadRequests(thread.projection).userInputs[0]?.questions[0];
  if (question === undefined) return null;
  return (
    <p className="max-w-prose text-sm text-foreground">
      <span className="text-muted-foreground">{question.header} · </span>
      {question.question}
    </p>
  );
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function ChatAction({
  row,
  onOpen,
  onAsk,
}: {
  readonly row: TaskChatRow;
  readonly onOpen: (open: WorkOpen) => void;
  readonly onAsk: ((row: TaskChatRow) => void) | undefined;
}) {
  const open = row.open;
  const opener =
    open === undefined ? null : (
      <Button variant="ghost" size="sm" onClick={() => onOpen(open)}>
        {open.kind === "observe" ? "Watch" : "Open chat"}
      </Button>
    );
  // A colleague's chat is theirs to open; what a person can do about it is to ask them.
  if (row.mine || onAsk === undefined) return opener;
  return (
    <>
      {opener}
      <Button variant="ghost" size="sm" onClick={() => onAsk(row)}>
        Ask {row.person}
      </Button>
    </>
  );
}

/**
 * A chat on the task that no run covers yet: the person's own to open, a colleague's as a status
 * row that says why it cannot be opened here and offers to ask them (`onAsk`, absent while asking
 * is off).
 */
export function TaskChatItem({
  row,
  onOpen,
  onAsk,
}: {
  readonly row: TaskChatRow;
  readonly onOpen: (open: WorkOpen) => void;
  readonly onAsk: ((row: TaskChatRow) => void) | undefined;
}) {
  return (
    <li className="flex min-h-16 flex-wrap items-center gap-3 py-4">
      <PersonMark name={row.person} mine={row.mine} />
      <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-foreground">{row.title}</span>
        <span className="text-sm text-muted-foreground">{row.subtitle}</span>
        {row.concerns === undefined ? null : (
          <span className="text-xs text-warning-foreground">{row.concerns}</span>
        )}
      </span>
      <span className={cn("inline-flex items-center gap-1.5 text-sm", TONE_TEXT[row.state.tone])}>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
        {row.state.label}
      </span>
      <ChatAction row={row} onOpen={onOpen} onAsk={onAsk} />
    </li>
  );
}

/** Whose row it is, by initial: the person's own in the accent. */
export function PersonMark({ name, mine }: { readonly name: string; readonly mine: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {initialOf(name)}
    </span>
  );
}

/** The task context in a line or two, against the newest handoff, and the way to its page. */
export function TaskContextSection({
  card,
  onOpen,
}: {
  readonly card: TaskContextCard | undefined;
  readonly onOpen: () => void;
}) {
  return (
    <section aria-label="Task context" className="flex flex-col gap-2.5">
      <PeerSectionLabel>Task context</PeerSectionLabel>
      {card === undefined ? (
        <p className="text-sm text-muted-foreground">
          Nobody has written the task context yet. The first agent on this task starts it and keeps
          it.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4 border-y border-border/60 py-5">
          <FileTextIcon aria-hidden className={cn("size-4.5 shrink-0", TONE_TEXT.knowledge)} />
          <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
            <span className="text-sm text-foreground">{card.headline}</span>
            <span className="text-sm text-muted-foreground">{card.note}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onOpen}>
            Open task context
          </Button>
        </div>
      )}
    </section>
  );
}

/** Branch, runtime, handoffs and the rest: folded until the person wants them. */
export function TaskDetails({ rows }: { readonly rows: ReadonlyArray<TaskDetail> }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <h2>
        <CollapsibleTrigger className="flex h-9 items-center gap-2 rounded-md text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          Details
        </CollapsibleTrigger>
      </h2>
      <CollapsiblePanel>
        <dl className="mt-3 flex flex-col divide-y divide-border/60 border-t border-border/60">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1 py-3">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd
                className={cn(
                  "text-sm break-words text-foreground",
                  row.mono && "font-mono text-xs",
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * An item an importer could not tell how to run: one agent on all of it, or its parts as the work.
 * Nothing starts on it until someone says.
 */
export function DecisionBar({
  busy,
  onDecide,
}: {
  readonly busy: boolean;
  readonly onDecide: (asOne: boolean) => void;
}) {
  return (
    <section
      aria-label="Decide how it runs"
      className={cn(
        "flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3.5",
        TONE_SURFACE.needs,
      )}
    >
      <CircleHelpIcon aria-hidden className={cn("size-5 shrink-0", TONE_TEXT.needs)} />
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">
          Does an agent do this as one task, or by its parts?
        </span>
        <span className="text-sm text-muted-foreground">
          It has items of its own. Decide before an agent starts on it.
        </span>
      </div>
      <Button variant="warning-outline" size="sm" disabled={busy} onClick={() => onDecide(true)}>
        One task
      </Button>
      <Button variant="warning-outline" size="sm" disabled={busy} onClick={() => onDecide(false)}>
        Its parts
      </Button>
    </section>
  );
}

/**
 * The items under the task, in the tree's order: each opens its page, an open one starts an agent.
 * Open items can be picked by their boxes (an item brings what sits under it, Shift picks a range)
 * to start one agent on all of them.
 */
export function TaskItems({
  project,
  taskId,
  rows,
  onOpen,
  launcher,
}: {
  readonly project: WorkProjectNode;
  /** The page's task: another page starts with nothing picked. */
  readonly taskId: string;
  readonly rows: ReadonlyArray<TaskItemRow>;
  readonly onOpen: (task: WorkTaskNode) => void;
  /** The task launcher and what it needs besides the item; absent where no agent can start here. */
  readonly launcher:
    | {
        readonly Launcher: ComponentType<TaskLauncherProps>;
        readonly props: Omit<TaskLauncherProps, "taskId" | "taskLabel">;
      }
    | undefined;
}) {
  const [stored, setSelection] = useState(() => emptySelection(taskId));
  const [launching, setLaunching] = useState<{
    readonly task: WorkTaskNode;
    readonly prompt: string | undefined;
  } | null>(null);
  if (rows.length === 0) return null;
  const index = treeIndexOf(project);
  const open = rows.filter((row) => !row.task.done);
  const selectable = open.map((row) => selectableTask(index, project.projectId, row.task));
  const selection = liveSelection(stored, taskId, selectable);
  const shown = rows.map((row) => row.task.id);
  const selected = open.filter((row) => selection.keys.has(row.task.id)).map((row) => row.task);
  const roots = selectionRoots(selection, selectable).flatMap((id) =>
    selected.filter((task) => task.id === id),
  );
  const unsettled = unsettledIn(selected);
  const pick = (id: string, range: boolean) =>
    setSelection(
      range
        ? selectRange(selection, selectable, shown, id)
        : toggleSelected(selection, selectable, id),
    );
  return (
    <section aria-label="Items" className="flex flex-col gap-2.5">
      <PeerSectionLabel
        after={
          <span className="font-normal text-muted-foreground tabular-nums">{rows.length}</span>
        }
      >
        Items
      </PeerSectionLabel>
      {selected.length === 0 ? null : (
        <div
          role="toolbar"
          aria-label="Selected items"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
        >
          {launcher === undefined ? (
            <span className="font-medium tabular-nums">{selected.length} selected</span>
          ) : (
            <Button
              size="xs"
              disabled={unsettled !== undefined || roots.length === 0}
              onClick={() => {
                const first = roots[0];
                if (first !== undefined) {
                  setLaunching({ task: first, prompt: selectionPrompt(project, roots) });
                }
              }}
            >
              <PlayIcon aria-hidden />
              Start agent on {selected.length} {selected.length === 1 ? "item" : "items"}
            </Button>
          )}
          {unsettled === undefined ? null : (
            <InlineButton tone="muted" onClick={() => onOpen(unsettled)}>
              Decide {unsettled.title} first
            </InlineButton>
          )}
          <InlineButton tone="muted" onClick={() => setSelection(emptySelection(taskId))}>
            Clear
          </InlineButton>
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
        {rows.map((row) => {
          const look = taskStateLook(row.state.kind);
          return (
            <li
              key={row.task.id}
              className="group/item flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
              style={
                row.indent === 0 ? undefined : { paddingInlineStart: `${row.indent * 1.25}rem` }
              }
            >
              {row.task.done ? (
                <span aria-hidden className="w-4 shrink-0" />
              ) : (
                <span
                  className={cn(
                    "flex shrink-0",
                    selected.length === 0 &&
                      "opacity-0 group-hover/item:opacity-100 focus-within:opacity-100",
                  )}
                >
                  <Checkbox
                    aria-label={`Select ${row.task.title}`}
                    checked={selectionMark(selection, selectable, row.task.id) === "checked"}
                    indeterminate={selectionMark(selection, selectable, row.task.id) === "partial"}
                    onCheckedChange={(_checked, details) =>
                      pick(
                        row.task.id,
                        "shiftKey" in details.event && details.event.shiftKey === true,
                      )
                    }
                  />
                </span>
              )}
              <StateDot tone={look.tone} hollow={look.hollow} />
              <button
                type="button"
                className="flex min-w-0 flex-[1_1_14rem] items-baseline gap-1.5 rounded-sm text-left text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => onOpen(row.task)}
              >
                {row.task.key === undefined ? null : (
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                    {row.task.key}
                  </span>
                )}
                <span className="min-w-0 [overflow-wrap:anywhere]">{row.task.title}</span>
              </button>
              <span className={cn("text-sm", TONE_TEXT[look.tone])}>{row.state.label}</span>
              {row.progress === null ? null : (
                <span className="text-sm text-muted-foreground tabular-nums">{row.progress}</span>
              )}
              {row.task.unsettled === true && !row.task.done ? (
                <Button size="xs" variant="warning-outline" onClick={() => onOpen(row.task)}>
                  Decide
                </Button>
              ) : null}
              {row.canStart && launcher !== undefined ? (
                <launcher.Launcher
                  {...launcher.props}
                  taskId={row.task.id}
                  taskLabel={taskLabel(row.task)}
                  {...(row.prompt === undefined ? {} : { initialPrompt: row.prompt })}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {launching === null || launcher === undefined ? null : (
        <launcher.Launcher
          {...launcher.props}
          taskId={launching.task.id}
          taskLabel={taskLabel(launching.task)}
          {...(launching.prompt === undefined ? {} : { initialPrompt: launching.prompt })}
          initialOpen
          onClose={() => setLaunching(null)}
        />
      )}
    </section>
  );
}
