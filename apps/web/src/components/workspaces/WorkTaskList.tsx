import { ChevronDownIcon, ChevronRightIcon, MessageCircleIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button, InlineButton } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { activeLabel } from "./marks";
import { PeopleStack, StateDot } from "./WorkBoardCards";
import { ProjectMark, TONE_SURFACE, TONE_TEXT } from "./signals";
import { progressLabel } from "./taskTree.logic";
import {
  ALL_PROJECTS,
  projectScopeKey,
  taskTarget,
  type TaskCard,
  type TaskTarget,
  type WorkTaskCard,
} from "./workBoard.logic";
import {
  COLUMN_STATE,
  LIST_TABS,
  listCounts,
  listGroups,
  listRowKey,
  listTreeRows,
  otherNeeds,
  stateText,
  taskStateTone,
  type ListGroup,
  type ListTab,
} from "./workList.logic";
import { workPrimaryTarget } from "./workNavigation.logic";

/**
 * The tasks as a compact list grouped by status: one row each with its title, area, the people on
 * it (only when someone is), chats (only when there are) and when it was last touched; the project
 * too while all projects show. Active tasks and done ones are two tabs, and a row opens its review
 * when it needs you, otherwise its task. Items of a task tree sit under the row above them that is
 * their ancestor, folded by its chevron. What waits on you besides tasks is in Needs you, and a
 * line here opens that queue.
 */
export function WorkTaskList({
  cards,
  scope,
  tab,
  onTab,
  onOpen,
  onShowNeeds,
}: {
  readonly cards: ReadonlyArray<TaskCard>;
  readonly scope: string;
  readonly tab: ListTab;
  readonly onTab: (tab: ListTab) => void;
  readonly onOpen: (target: TaskTarget) => void;
  readonly onShowNeeds: () => void;
}) {
  const groups = listGroups(cards, tab);
  const counts = listCounts(cards);
  const others = tab === "active" ? otherNeeds(cards) : 0;
  // Keys name the project, so what is folded stays per project.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div className="@container/task-list flex min-w-0 flex-col gap-3">
      <ToggleGroup
        aria-label="Which tasks"
        variant="navigation"
        value={[tab]}
        onValueChange={(next) => {
          const value = LIST_TABS.find((candidate) => candidate.id === next[0]);
          if (value !== undefined) onTab(value.id);
        }}
      >
        {LIST_TABS.map((candidate) => (
          <Toggle key={candidate.id} value={candidate.id}>
            {candidate.label}
            <span className="text-muted-foreground tabular-nums">{counts[candidate.id]}</span>
          </Toggle>
        ))}
      </ToggleGroup>

      {others === 0 ? null : (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
            TONE_SURFACE.needs,
          )}
        >
          <span className="min-w-0 flex-1">
            {others === 1 ? "1 more thing waits" : `${others} more things wait`} on you: requests,
            overlaps, inputs that changed.
          </span>
          <InlineButton onClick={onShowNeeds}>Open Needs you</InlineButton>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab === "done" ? "No done tasks." : "No open tasks."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <ListGroupView
              key={group.id}
              group={group}
              showProject={scope === ALL_PROJECTS}
              collapsed={collapsed}
              onToggle={toggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {tab === "done"
          ? "The latest first."
          : "Grouped by status: what needs you first, then running work and the backlog."}{" "}
        Reviews open at the decision; other rows open task details.
      </p>
    </div>
  );
}

function ListGroupView({
  group,
  showProject,
  collapsed,
  onToggle,
  onOpen,
}: {
  readonly group: ListGroup;
  readonly showProject: boolean;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onOpen: (target: TaskTarget) => void;
}) {
  const [open, setOpen] = useState(true);
  const rows = listTreeRows(group.rows, collapsed);
  const nested = rows.some((row) => row.children > 0 || row.indent > 0);
  return (
    <section
      aria-label={group.title}
      className="overflow-hidden rounded-lg border border-border/70"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronDownIcon
          aria-hidden
          className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <StateDot kind={group.id === "done" ? "done" : COLUMN_STATE[group.id]} />
        {group.title}
        <span className="text-muted-foreground tabular-nums">{group.rows.length}</span>
      </button>
      {open ? (
        <ul aria-label={group.title} className="divide-y divide-border/60">
          {rows.map((row) => (
            <ListRow
              key={row.item.key}
              card={row.item}
              indent={row.indent}
              tree={
                nested
                  ? {
                      children: row.children,
                      collapsed: collapsed.has(listRowKey(row.item)),
                      underParent: row.underParent,
                      onToggle: () => onToggle(listRowKey(row.item)),
                    }
                  : undefined
              }
              showProject={showProject}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * One task in a line or two: the title first, then where it is and who is on it, then when. An item
 * whose parent shows elsewhere names it.
 */
function ListRow({
  card,
  indent,
  tree,
  showProject,
  onOpen,
}: {
  readonly card: WorkTaskCard;
  readonly indent: number;
  /** Absent while no row of its group nests. */
  readonly tree:
    | {
        readonly children: number;
        readonly collapsed: boolean;
        readonly underParent: boolean;
        readonly onToggle: () => void;
      }
    | undefined;
  readonly showProject: boolean;
  readonly onOpen: (target: TaskTarget) => void;
}) {
  const updated = activeLabel(card.updatedAt);
  const needsYou = taskStateTone(card.state.kind) === "needs";
  const progress = progressLabel(card.task);
  const parent =
    tree === undefined || tree.underParent || card.task.parent === undefined
      ? undefined
      : card.project.areas
          .flatMap((area) => area.tasks)
          .find((task) => task.id === card.task.parent)?.title;
  const deciding = card.task.unsettled === true && !card.task.done;
  return (
    <li
      className="relative flex min-w-0 items-center gap-3 px-3 py-2.5 hover:bg-muted/40"
      style={indent === 0 ? undefined : { paddingInlineStart: `${0.75 + indent * 1.25}rem` }}
    >
      {tree === undefined ? null : tree.children > 0 ? (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          className="relative z-10 -me-2 shrink-0"
          aria-label={`${tree.collapsed ? "Show" : "Hide"} the items of ${card.task.title}`}
          aria-expanded={!tree.collapsed}
          onClick={tree.onToggle}
        >
          <ChevronRightIcon className={cn("size-3", !tree.collapsed && "rotate-90")} />
        </Button>
      ) : (
        <span aria-hidden className="-me-2 w-5 shrink-0" />
      )}
      <StateDot kind={card.state.kind} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          {card.task.key === undefined ? null : (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {card.task.key}
            </span>
          )}
          <button
            type="button"
            className="min-w-0 rounded-sm text-left text-sm font-medium outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => onOpen(workPrimaryTarget(card))}
          >
            {card.task.title}
          </button>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {[
            showProject ? (
              <span key="project" className="inline-flex min-w-0 items-center gap-1">
                <ProjectMark name={card.project.name} colorKey={projectScopeKey(card.project)} />
                <span className="truncate">{card.project.name}</span>
              </span>
            ) : null,
            needsYou || card.state.kind === "working" || card.state.kind === "waiting" ? (
              <span key="state" className={TONE_TEXT[taskStateTone(card.state.kind)]}>
                {stateText(card)}
              </span>
            ) : null,
            progress === null ? null : (
              <span key="progress" className="tabular-nums">
                {progress}
              </span>
            ),
            parent === undefined ? null : (
              <span key="parent" className="min-w-0 truncate">
                in {parent}
              </span>
            ),
            card.area === null ? null : <span key="area">{card.area}</span>,
            card.chats === 0 ? null : (
              <span key="chats" className="inline-flex items-center gap-1">
                <MessageCircleIcon aria-hidden className="size-3" />
                {card.chats}
              </span>
            ),
          ]
            .filter((part) => part !== null)
            .flatMap((part, index) =>
              index === 0
                ? [part]
                : [
                    <span key={`dot-${part.key}`} aria-hidden>
                      ·
                    </span>,
                    part,
                  ],
            )}
        </span>
      </div>
      {card.action === undefined && !deciding ? null : (
        <span className="relative z-10 flex shrink-0 items-center gap-3">
          {card.action === undefined ? null : (
            <InlineButton onClick={() => onOpen(card.action!.target)}>
              {card.action.label}
            </InlineButton>
          )}
          {card.action?.target.kind === "review" ? (
            <InlineButton onClick={() => onOpen(taskTarget(card))}>Task details</InlineButton>
          ) : null}
          {deciding && card.action === undefined ? (
            <InlineButton onClick={() => onOpen(taskTarget(card))}>Decide</InlineButton>
          ) : null}
        </span>
      )}
      {card.people.length === 0 ? null : <PeopleStack people={card.people} />}
      {updated === null ? null : (
        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {updated}
        </span>
      )}
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </li>
  );
}
