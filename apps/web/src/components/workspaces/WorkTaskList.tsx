import { cn } from "../../lib/utils";
import { InlineButton } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { activeLabel } from "./marks";
import { PeopleStack, StateDot } from "./WorkBoardCards";
import { ProjectMark, TONE_SURFACE, TONE_TEXT } from "./signals";
import {
  ALL_PROJECTS,
  projectScopeKey,
  taskTarget,
  type TaskCard,
  type TaskTarget,
  type WorkTaskCard,
} from "./workBoard.logic";
import {
  LIST_TABS,
  chatsLabel,
  listColumns,
  listCounts,
  listLayout,
  listRows,
  otherNeeds,
  stateText,
  taskStateTone,
  type ListColumnId,
  type ListTab,
} from "./workList.logic";
import { workPrimaryTarget } from "./workNavigation.logic";

/**
 * The tasks as a list: the task first, with its state, area, people, chats and when it was last
 * touched; the project too while all projects show. Active tasks and done ones are two tabs, and a
 * row opens its review when it needs you, otherwise its task. What waits on you besides tasks is
 * in Needs you, and a line here opens that queue.
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
  const rows = listRows(cards, tab);
  const counts = listCounts(cards);
  const others = tab === "active" ? otherNeeds(cards) : 0;
  const columns = listColumns(scope);
  const layout = listLayout(columns);
  const grid = { gridTemplateColumns: layout.template };
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

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab === "done" ? "No done tasks." : "No active tasks."}
        </p>
      ) : (
        <>
          <ul
            aria-label="Tasks"
            className="divide-y divide-border/60 border-y border-border/60 @5xl/task-list:hidden"
          >
            {rows.map((card) => (
              <li key={card.key}>
                <button
                  type="button"
                  onClick={() => onOpen(workPrimaryTarget(card))}
                  className="flex w-full min-w-0 cursor-pointer flex-col gap-3 rounded-lg px-1 py-5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {card.task.key}
                    <span
                      className={cn(
                        "ml-auto inline-flex items-center gap-1.5",
                        TONE_TEXT[taskStateTone(card.state.kind)],
                      )}
                    >
                      <StateDot kind={card.state.kind} />
                      {stateText(card)}
                    </span>
                  </span>
                  <span className="text-base leading-snug font-semibold [overflow-wrap:anywhere]">
                    {card.task.title}
                  </span>
                  {card.people.length === 0 && card.chats === 0 ? null : (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PeopleStack people={card.people} />
                      {card.chats > 0 ? <span>{chatsLabel(card.chats)}</span> : null}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                    {scope === ALL_PROJECTS ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
                        <ProjectMark
                          name={card.project.name}
                          colorKey={projectScopeKey(card.project)}
                        />
                        {card.project.name}
                      </span>
                    ) : null}
                    {card.area === null ? null : <span>{card.area}</span>}
                    <span className="ml-auto">{activeLabel(card.updatedAt)}</span>
                  </span>
                </button>
                {card.action === undefined ? null : (
                  <div className="flex items-center gap-4 pb-4">
                    <InlineButton onClick={() => onOpen(card.action!.target)}>
                      {card.action.label}
                    </InlineButton>
                    {card.action.target.kind === "review" ? (
                      <InlineButton onClick={() => onOpen(taskTarget(card))}>
                        Task details
                      </InlineButton>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border-y border-border/60 @5xl/task-list:block">
            <div role="table" aria-label="Tasks" style={{ minWidth: layout.minWidth }}>
              <div
                role="row"
                className="grid items-center gap-x-3.5 border-b border-border/60 px-4 py-3 text-xs font-medium text-muted-foreground"
                style={grid}
              >
                {columns.map((column) => (
                  <span key={column.id} role="columnheader">
                    {column.label}
                  </span>
                ))}
              </div>
              {rows.map((card) => (
                <div
                  key={card.key}
                  role="row"
                  className="relative grid min-h-16 items-center gap-x-3.5 border-b border-border/60 px-4 py-3 text-sm last:border-b-0 hover:bg-muted/50"
                  style={grid}
                >
                  {columns.map((column) => (
                    <span key={column.id} role="cell" className="min-w-0">
                      <ListCell column={column.id} card={card} onOpen={onOpen} />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {tab === "done"
          ? "The latest first."
          : "Sorted by what needs you, then by the latest activity."}{" "}
        Reviews open at the decision; other rows open task details.
      </p>
    </div>
  );
}

function ListCell({
  column,
  card,
  onOpen,
}: {
  readonly column: ListColumnId;
  readonly card: WorkTaskCard;
  readonly onOpen: (target: TaskTarget) => void;
}) {
  switch (column) {
    case "task": {
      const target = workPrimaryTarget(card);
      return (
        <span className="flex min-w-0 items-baseline gap-2">
          {card.task.key === undefined ? null : (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {card.task.key}
            </span>
          )}
          <button
            type="button"
            className="min-w-0 rounded-sm text-left font-medium outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => onOpen(target)}
          >
            {card.task.title}
          </button>
          {card.action?.target.kind === "review" ? (
            <span className="relative z-10 shrink-0">
              <InlineButton onClick={() => onOpen(taskTarget(card))}>Task details</InlineButton>
            </span>
          ) : null}
        </span>
      );
    }
    case "project":
      return (
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <ProjectMark
            name={card.project.name}
            colorKey={projectScopeKey(card.project)}
            className="size-4.5"
          />
          <span className="truncate">{card.project.name}</span>
        </span>
      );
    case "state":
      return (
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            TONE_TEXT[taskStateTone(card.state.kind)],
          )}
        >
          <StateDot kind={card.state.kind} />
          {card.action === undefined ? (
            <span className="truncate">{stateText(card)}</span>
          ) : (
            <span className="relative z-10">
              <InlineButton onClick={() => onOpen(card.action!.target)}>
                {card.action.label}
              </InlineButton>
            </span>
          )}
        </span>
      );
    case "area":
      return <span className="block truncate text-muted-foreground">{card.area ?? "No area"}</span>;
    case "people":
      return <PeopleStack people={card.people} />;
    case "chats":
      return <span className="text-muted-foreground tabular-nums">{card.chats}</span>;
    case "updated":
      return (
        <span className="text-muted-foreground tabular-nums">
          {activeLabel(card.updatedAt) ?? ""}
        </span>
      );
  }
}
