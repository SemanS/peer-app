import type { SignalTone } from "./signals";
import {
  ALL_PROJECTS,
  TASK_COLUMNS,
  type TaskCard,
  type TaskColumn,
  type TaskStateKind,
  type WorkTaskCard,
} from "./workBoard.logic";

/** Which tasks the list shows: the ones still to do, or the done ones. */
export type ListTab = "active" | "done";

export const LIST_TABS: ReadonlyArray<{ readonly id: ListTab; readonly label: string }> = [
  { id: "active", label: "Active" },
  { id: "done", label: "Done" },
];

export type ListColumnId = "task" | "project" | "state" | "area" | "people" | "chats" | "updated";

export interface ListColumn {
  readonly id: ListColumnId;
  readonly label: string;
  /** Its width in rem; the flexible column takes the rest of the row and this is its least. */
  readonly rem: number;
  readonly flexible: boolean;
}

const COLUMNS: Readonly<Record<ListColumnId, ListColumn>> = {
  task: { id: "task", label: "Task", rem: 16, flexible: true },
  project: { id: "project", label: "Project", rem: 9.5, flexible: false },
  state: { id: "state", label: "State", rem: 11.5, flexible: false },
  area: { id: "area", label: "Area", rem: 6.5, flexible: false },
  people: { id: "people", label: "People", rem: 5, flexible: false },
  chats: { id: "chats", label: "Chats", rem: 3.5, flexible: false },
  updated: { id: "updated", label: "Updated", rem: 5, flexible: false },
};

/**
 * The list's columns: the task first, flexible, then its state and who and what is on it. The
 * project is a column only while all projects show; with one project it would repeat itself.
 */
export function listColumns(scope: string): ReadonlyArray<ListColumn> {
  return [
    COLUMNS.task,
    ...(scope === ALL_PROJECTS ? [COLUMNS.project] : []),
    COLUMNS.state,
    COLUMNS.area,
    COLUMNS.people,
    COLUMNS.chats,
    COLUMNS.updated,
  ];
}

/** The gap between columns (`gap-3.5`) and a row's padding on both sides (`px-4`), in rem. */
const GAP_REM = 0.875;
const PADDING_REM = 2;

/** The grid every row of the list shares, and the least width it needs before it scrolls. */
export function listLayout(columns: ReadonlyArray<ListColumn>): {
  readonly template: string;
  readonly minWidth: string;
} {
  const width =
    columns.reduce((sum, column) => sum + column.rem, 0) +
    GAP_REM * (columns.length - 1) +
    PADDING_REM;
  return {
    template: columns
      .map((column) => (column.flexible ? `minmax(${column.rem}rem,1fr)` : `${column.rem}rem`))
      .join(" "),
    minWidth: `${width}rem`,
  };
}

const COLUMN_ORDER = TASK_COLUMNS.map((column) => column.id);

function isTask(card: TaskCard): card is WorkTaskCard {
  return card.kind === "task";
}

/**
 * The tasks the list shows under a tab. Active: in the order of the board's columns, each in the
 * order of the cards (what needs you first, then the latest activity). Done: the latest first.
 */
export function listRows(
  cards: ReadonlyArray<TaskCard>,
  tab: ListTab,
): ReadonlyArray<WorkTaskCard> {
  const tasks = cards.filter(isTask);
  if (tab === "done") {
    const at = (card: WorkTaskCard) => Date.parse(card.updatedAt ?? "") || 0;
    return tasks.filter((card) => card.column === null).sort((a, b) => at(b) - at(a));
  }
  const rank = (column: TaskColumn | null) => (column === null ? -1 : COLUMN_ORDER.indexOf(column));
  return tasks
    .filter((card) => card.column !== null)
    .sort((a, b) => rank(a.column) - rank(b.column));
}

/** How many active and done tasks the tabs count. */
export function listCounts(cards: ReadonlyArray<TaskCard>): {
  readonly active: number;
  readonly done: number;
} {
  const tasks = cards.filter(isTask);
  const done = tasks.filter((card) => card.column === null).length;
  return { active: tasks.length - done, done };
}

/** What waits on the person besides tasks (requests, overlaps, inputs that changed): the board's. */
export function otherNeeds(cards: ReadonlyArray<TaskCard>): number {
  return cards.filter((card) => !isTask(card)).length;
}

/**
 * A task's state as the list writes it. A task done because every pull request on it was merged or
 * closed says so; one marked done on the Hub just reads Done.
 */
export function stateText(card: Pick<WorkTaskCard, "task" | "state">): string {
  const { task, state } = card;
  if (state.kind !== "done" || task.done) return state.label;
  return task.threads.some((thread) => thread.delivery === "merged")
    ? `${state.label} · PR merged`
    : `${state.label} · PR closed`;
}

/** How many chats a task has, in words: "no chats", "1 chat", "3 chats". */
export function chatsLabel(count: number): string {
  return count === 0 ? "no chats" : count === 1 ? "1 chat" : `${count} chats`;
}

/** The hue of a state, as every Work view draws it: what waits on you in amber, work in blue. */
export function taskStateTone(kind: TaskStateKind): SignalTone {
  switch (kind) {
    case "review":
    case "approval":
    case "input":
      return "needs";
    case "working":
    case "waiting":
      return "working";
    case "done":
      return "delivery";
    case "paused":
    case "new":
      return "neutral";
  }
}

/** The state each column of the board stands for, for its header's dot. */
export const COLUMN_STATE: Readonly<Record<TaskColumn, TaskStateKind>> = {
  needs: "input",
  working: "working",
  paused: "paused",
  new: "new",
};
