import type { SignalTone } from "./signals";
import {
  TASK_COLUMNS,
  type TaskCard,
  type TaskColumn,
  type TaskStateKind,
  type WorkTaskCard,
} from "./workBoard.logic";

/** Which tasks the list shows: the ones still to do, or the done ones. */
export type ListTab = "active" | "done";

export const LIST_TABS: ReadonlyArray<{ readonly id: ListTab; readonly label: string }> = [
  { id: "active", label: "Open" },
  { id: "done", label: "Done" },
];

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
    .sort((a, b) => rank(a.column) - rank(b.column) || a.task.title.localeCompare(b.task.title));
}

/** One status's tasks in the list, under a header that folds them away. */
export interface ListGroup {
  readonly id: TaskColumn | "done";
  readonly title: string;
  readonly rows: ReadonlyArray<WorkTaskCard>;
}

/**
 * The list's rows under their status, in the board's order (Needs you, In progress, Waiting to
 * continue, Not started); a status with no task has no group. Done is one group, the latest first.
 */
export function listGroups(cards: ReadonlyArray<TaskCard>, tab: ListTab): ReadonlyArray<ListGroup> {
  const rows = listRows(cards, tab);
  if (tab === "done") return rows.length === 0 ? [] : [{ id: "done", title: "Done", rows }];
  return TASK_COLUMNS.map((column) => ({
    id: column.id,
    title: column.title,
    rows: rows.filter((row) => row.column === column.id),
  })).filter((group) => group.rows.length > 0);
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
