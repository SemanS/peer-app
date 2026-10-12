import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";

import { ALL_PROJECTS, boardCards } from "./workBoard.logic";
import { groupTasks } from "./workGroups.logic";
import type { WorkProjectNode } from "./workTree.logic";

/**
 * How many cards wait on the person in these projects: the Needs you column of the Work board, the
 * same list, so the sidebar's count and the board agree. It is the one place the sidebar reads the
 * board's cards for a count.
 */
export function sidebarNeedsCount(
  tree: ReadonlyArray<WorkProjectNode>,
  needs: ReadonlyArray<NeedsYouItem>,
  scope: string = ALL_PROJECTS,
): number {
  return boardCards(tree, { scope, mine: false, query: "", needs }).filter(
    (card) => card.column === "needs",
  ).length;
}

/** A project's tasks that are not done: what "7 active" counts. Done tasks are counted apart. */
export function activeTaskCount(project: WorkProjectNode): number {
  return groupTasks(project).reduce(
    (total, group) => total + (group.done ? 0 : group.tasks.length),
    0,
  );
}

/** A project's tasks that are done. */
export function doneTaskCount(project: WorkProjectNode): number {
  return groupTasks(project).reduce(
    (total, group) => total + (group.done ? group.tasks.length : 0),
    0,
  );
}

/** "7 active"; nothing for none, since a zero count does not show. */
export function activeTasksText(count: number): string | undefined {
  return count > 0 ? `${count} active` : undefined;
}

/** "1 needs you", "4 need you"; nothing for none. */
export function needsYouText(count: number): string | undefined {
  return count > 0 ? `${count} ${count === 1 ? "needs" : "need"} you` : undefined;
}
