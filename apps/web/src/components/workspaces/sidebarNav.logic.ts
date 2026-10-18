import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";

import type { ProjectNavRow, ProjectSignal } from "./slots.types";
import { ALL_PROJECTS, taskCards } from "./workBoard.logic";
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
  // The board's own cards (one per task, plus requests, overlaps and stale inputs), so the count
  // is what its Needs you column shows.
  return taskCards(tree, { scope, mine: false, query: "", needs }).filter(
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

/** Whether agents wrote a shared context for the project's work on no task. */
function hasProjectContext(project: WorkProjectNode): boolean {
  return project.context !== undefined && project.context.version > 0;
}

/**
 * What the navigation rows count, for the projects in scope. A count that is zero is `null`, since
 * a zero does not show; active and done tasks are counted apart and never added up.
 */
export interface SidebarNavCounts {
  /** Needs you: the board's Needs you cards. */
  readonly needs: number | null;
  /** Tasks: those not done. */
  readonly active: number | null;
  readonly done: number | null;
  /** Knowledge: findings waiting to be kept or dismissed. */
  readonly toKeep: number | null;
  /** Whether a shared context exists, which Knowledge lists as its second row. */
  readonly sharedContext: boolean;
}

export function sidebarNav(
  tree: ReadonlyArray<WorkProjectNode>,
  needs: ReadonlyArray<NeedsYouItem>,
): SidebarNavCounts {
  const shown = (count: number): number | null => (count > 0 ? count : null);
  const total = (count: (project: WorkProjectNode) => number) =>
    tree.reduce((sum, project) => sum + count(project), 0);
  return {
    needs: shown(sidebarNeedsCount(tree, needs)),
    active: shown(total(activeTaskCount)),
    done: shown(total(doneTaskCount)),
    toKeep: shown(total((project) => project.candidates)),
    sharedContext: tree.some(hasProjectContext),
  };
}

/** The navigation rows plugins add to a project, in the order of their signals. */
export function pluginNavRows(
  signals: ReadonlyArray<ProjectSignal>,
): ReadonlyArray<{ readonly id: string; readonly row: ProjectNavRow }> {
  return signals.flatMap((signal) =>
    signal.navRow === undefined ? [] : [{ id: signal.id, row: signal.navRow }],
  );
}
