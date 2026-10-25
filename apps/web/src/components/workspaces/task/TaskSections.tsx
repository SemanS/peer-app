/**
 * The sections of a task's page that only show what the model says: what waits on the person, the
 * chats, the task context card and the folded details. They hold no data of their own; what a
 * button does is the page's to say.
 */
import {
  ChevronRightIcon,
  FileTextIcon,
  MessageCircleQuestionIcon,
  PackageCheckIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { PeerSectionLabel } from "../PeerPageHeader";
import { TONE_SURFACE, TONE_TEXT } from "../signals";
import type { WorkOpen } from "../workTree.logic";
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
 * Everyone's chats on the task: the person's own to open, a colleague's as a status row that says
 * why it cannot be opened here and offers to ask them (`onAsk`, absent while asking is off).
 */
export function TaskChats({
  rows,
  onOpen,
  onAsk,
  children,
}: {
  readonly rows: ReadonlyArray<TaskChatRow>;
  readonly onOpen: (open: WorkOpen) => void;
  readonly onAsk: ((row: TaskChatRow) => void) | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <section aria-label="Chats" className="flex flex-col gap-2.5">
      <PeerSectionLabel
        after={
          <span className="font-normal text-muted-foreground tabular-nums">{rows.length}</span>
        }
      >
        Chats
      </PeerSectionLabel>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No chat is on this task yet. Start one to put an agent on it.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
          {rows.map((row) => (
            <li key={row.key} className="flex min-h-16 flex-wrap items-center gap-3 py-4">
              <span
                aria-hidden
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  row.mine
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {initialOf(row.person)}
              </span>
              <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-foreground">{row.title}</span>
                <span className="text-sm text-muted-foreground">{row.subtitle}</span>
                {row.concerns === undefined ? null : (
                  <span className="text-xs text-warning-foreground">{row.concerns}</span>
                )}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm",
                  TONE_TEXT[row.state.tone],
                )}
              >
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
                {row.state.label}
              </span>
              <ChatAction row={row} onOpen={onOpen} onAsk={onAsk} />
            </li>
          ))}
        </ul>
      )}
      {children === undefined ? null : <div className="flex flex-wrap gap-2">{children}</div>}
    </section>
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
