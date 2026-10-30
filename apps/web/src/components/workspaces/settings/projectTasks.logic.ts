/**
 * A project's tasks as the Tasks page arranges them. The page changes the tree itself: a group or a
 * task moves among its siblings, under another item or out of one. Each change is the task update
 * the Work menus use, so nothing here waits for a save.
 */
import type { ContextMenuItem } from "@t3tools/contracts";

import type { TaskMove } from "../taskTree.logic";
import type { WorkTaskMenuId } from "../workMenus.logic";
import type { WorkTaskNode } from "../workTree.logic";

/** The longest task title the Hub keeps. */
export const TASK_TITLE_MAX = 120;

export type GroupTitleProblem = "empty" | "long";

/** Why `title` cannot name a group: the Hub cuts a longer one, and a group needs a name. */
export function groupTitleProblem(title: string): GroupTitleProblem | null {
  const trimmed = title.trim();
  if (trimmed === "") return "empty";
  return Array.from(trimmed).length > TASK_TITLE_MAX ? "long" : null;
}

export const groupTitleProblemText = (problem: GroupTitleProblem): string =>
  problem === "empty" ? "Give the group a name." : `Use ${TASK_TITLE_MAX} characters or fewer.`;

/** The items directly under `parent` in the tree's order; undefined asks for the roots. */
export const siblingsUnder = (
  tasks: ReadonlyArray<WorkTaskNode>,
  parent: string | undefined,
): ReadonlyArray<WorkTaskNode> => tasks.filter((task) => task.parent === parent);

/** The ids with `id` moved to where `over` is. */
export function movedOrder(
  ids: ReadonlyArray<string>,
  id: string,
  over: string,
): ReadonlyArray<string> {
  const from = ids.indexOf(id);
  const to = ids.indexOf(over);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Siblings in the order `ids` holds; one that came since stays after them, in its own order. */
export function inHeldOrder<T extends { readonly id: string }>(
  siblings: ReadonlyArray<T>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<T> {
  const place = new Map(ids.map((id, index) => [id, index]));
  const at = (item: T) => place.get(item.id) ?? ids.length;
  return siblings.toSorted((a, b) => at(a) - at(b));
}

/** One task to update: where it stands among its siblings. */
export interface TaskPlace {
  readonly taskId: string;
  readonly position: number;
}

/**
 * The positions that give siblings the order `ids` holds, only those that change. Siblings often
 * share position 0 (the Hub's default), so each gets its index rather than a swap with its neighbour.
 */
export function positionChanges(
  ids: ReadonlyArray<string>,
  positions: ReadonlyMap<string, number | undefined>,
): ReadonlyArray<TaskPlace> {
  return ids.flatMap((taskId, position) =>
    (positions.get(taskId) ?? 0) === position ? [] : [{ taskId, position }],
  );
}

/**
 * What removing an item writes first: its items go up a level and stand where it stood, in their
 * order, and the siblings after it make room. A root's items keep the area it was in, which the
 * Hub reads from each root.
 */
export function removalMoves(input: {
  readonly task: Pick<WorkTaskNode, "id" | "parent">;
  readonly area: string | undefined;
  readonly items: ReadonlyArray<string>;
  readonly siblings: ReadonlyArray<string>;
  readonly positions: ReadonlyMap<string, number | undefined>;
}): ReadonlyArray<TaskMove> {
  const { task, area, items, siblings, positions } = input;
  const order = siblings.flatMap((id) => (id === task.id ? items : [id]));
  const places = new Map(
    positionChanges(order, positions).map((place) => [place.taskId, place.position]),
  );
  const placed = (taskId: string) => {
    const position = places.get(taskId);
    return position === undefined ? {} : { position };
  };
  return [
    ...items.map((taskId) => ({
      taskId,
      // The Hub takes an empty parent as none.
      parent: task.parent ?? "",
      ...(task.parent === undefined && area !== undefined ? { area } : {}),
      ...placed(taskId),
    })),
    ...siblings.flatMap((taskId) =>
      taskId === task.id || !places.has(taskId) ? [] : [{ taskId, ...placed(taskId) }],
    ),
  ];
}

/** Where a new item goes to end up last among `positions`. */
export const positionAfter = (positions: ReadonlyArray<number | undefined>): number =>
  positions.reduce<number>((last, position) => Math.max(last, (position ?? 0) + 1), 0);

export type TaskStructureMenuId = Extract<
  WorkTaskMenuId,
  "add-under" | "move-under" | "make-group" | "make-task" | "rename" | "remove"
>;

/**
 * What a row's menu offers: its place in the tree, while the Hub keeps one, and its name. Removing
 * belongs to those who may (`removable`). Its state and chats are in the Work views.
 */
export function structureMenuItems(input: {
  readonly task: Pick<WorkTaskNode, "kind" | "removable">;
  readonly tree: boolean;
}): ReadonlyArray<ContextMenuItem<TaskStructureMenuId>> {
  return [
    ...(input.tree
      ? [
          { id: "add-under" as const, label: "Add an item under…", icon: "list-plus" },
          { id: "move-under" as const, label: "Move under…", icon: "folder-tree" },
          input.task.kind === "group"
            ? { id: "make-task" as const, label: "Make a task", icon: "check" }
            : { id: "make-group" as const, label: "Make a group", icon: "folder" },
        ]
      : []),
    { id: "rename", label: "Rename", icon: "pencil" },
    ...(input.task.removable
      ? [
          {
            id: "remove" as const,
            label: "Remove",
            icon: "trash",
            destructive: true,
            separatorBefore: true,
          },
        ]
      : []),
  ];
}
