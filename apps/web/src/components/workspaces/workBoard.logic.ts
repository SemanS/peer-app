/**
 * The Work board: every thread of the team's projects as a card, in one column per state, the
 * way the sidebar's tree places it. A project scope (one project, or all of them) is shared with
 * the sidebar so both show the same work.
 */
import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";

import {
  openKey,
  type WorkProjectNode,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./workTree.logic";

export const ALL_PROJECTS = "all";

/** The scope key of one project: its workspace and id. */
export function projectScopeKey(project: Pick<WorkProjectNode, "workspace" | "projectId">): string {
  return `${project.workspace}/${project.projectId}`;
}

/** The scope to show: the chosen project while the tree still has it, else all projects. */
export function resolveScope(scope: string, tree: ReadonlyArray<WorkProjectNode>): string {
  return scope !== ALL_PROJECTS && tree.some((project) => projectScopeKey(project) === scope)
    ? scope
    : ALL_PROJECTS;
}

export function inScope(scope: string, project: WorkProjectNode): boolean {
  return scope === ALL_PROJECTS || projectScopeKey(project) === scope;
}

export type BoardColumn = "needs" | "working" | "review" | "idle";

export const BOARD_COLUMNS: ReadonlyArray<{ readonly id: BoardColumn; readonly title: string }> = [
  { id: "needs", title: "Needs input" },
  { id: "working", title: "Working" },
  { id: "review", title: "Needs review" },
  { id: "idle", title: "Idle" },
];

/**
 * Where a thread sits on the board: waiting for an answer or an approval, working, finished or in
 * review, or idle. Merged and closed work leaves the board; a colleague's thread nobody reports
 * any more is idle, marked away.
 */
export function boardColumn(thread: WorkThreadNode): BoardColumn | null {
  if (thread.delivery === "merged" || thread.delivery === "closed") return null;
  if (thread.stale) return "idle";
  if (thread.status === "blocked") return "needs";
  if (thread.status === "working") return "working";
  if (thread.delivery === "review" || thread.status === "done") return "review";
  return "idle";
}

export interface BoardCard {
  readonly key: string;
  readonly column: BoardColumn;
  readonly thread: WorkThreadNode;
  readonly project: WorkProjectNode;
  /** The task it is on; undefined for work on no task. */
  readonly task: WorkTaskNode | undefined;
}

function projectCards(project: WorkProjectNode): ReadonlyArray<BoardCard> {
  const card = (thread: WorkThreadNode, task: WorkTaskNode | undefined): BoardCard[] => {
    const column = boardColumn(thread);
    return column === null
      ? []
      : [{ key: `${projectScopeKey(project)}:${thread.key}`, column, thread, project, task }];
  };
  return [
    ...project.areas.flatMap((area) =>
      area.tasks.flatMap((task) => task.threads.flatMap((thread) => card(thread, task))),
    ),
    ...project.unsorted.flatMap((thread) => card(thread, undefined)),
  ];
}

function matches(card: BoardCard, query: string): boolean {
  if (query === "") return true;
  return [
    card.thread.title,
    card.thread.branch,
    card.thread.person,
    card.task?.key,
    card.task?.title,
    card.project.name,
  ].some((text) => text !== undefined && text.toLowerCase().includes(query));
}

/** Your own work first, then what was active last, then by title. */
function byRelevance(a: BoardCard, b: BoardCard): number {
  return (
    Number(b.thread.mine) - Number(a.thread.mine) ||
    Date.parse(b.thread.activeAt ?? "0") - Date.parse(a.thread.activeAt ?? "0") ||
    a.thread.title.localeCompare(b.thread.title)
  );
}

/** The board's cards in scope, only yours when `mine`, matching the search. */
export function boardCards(
  tree: ReadonlyArray<WorkProjectNode>,
  input: { readonly scope: string; readonly mine: boolean; readonly query: string },
): ReadonlyArray<BoardCard> {
  const query = input.query.trim().toLowerCase();
  return tree
    .filter((project) => inScope(input.scope, project))
    .flatMap(projectCards)
    .filter((card) => (!input.mine || card.thread.mine) && matches(card, query))
    .toSorted(byRelevance);
}

export type ColumnCounts = Readonly<Record<BoardColumn, number>>;

/** How many of a project's threads (all of them, or only yours) sit in each column. */
export function projectCounts(project: WorkProjectNode, mine = false): ColumnCounts {
  const counts = { needs: 0, working: 0, review: 0, idle: 0 };
  for (const card of projectCards(project)) {
    if (!mine || card.thread.mine) counts[card.column] += 1;
  }
  return counts;
}

/** All of a project's tasks, in the order the tree lists them. */
export function projectTaskCount(project: WorkProjectNode): number {
  return project.areas.reduce((total, area) => total + area.tasks.length, 0);
}

/** What each thread opens (`openKey`), mapped to the project the tree placed it in. */
export function projectsByOpen(tree: ReadonlyArray<WorkProjectNode>): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const project of tree) {
    const key = projectScopeKey(project);
    const threads = [
      ...project.areas.flatMap((area) => area.tasks.flatMap((task) => task.threads)),
      ...project.unsorted,
    ];
    for (const thread of threads) {
      if (thread.open !== undefined) map.set(openKey(thread.open), key);
    }
  }
  return map;
}

/**
 * The project a Needs you item concerns, as a scope key: a request's or an overlap's project, or
 * the project the tree placed the waiting thread in. Undefined when it names none, so it shows
 * whatever project is in scope.
 */
export function needProject(
  item: NeedsYouItem,
  byOpen: ReadonlyMap<string, string>,
): string | undefined {
  switch (item.kind) {
    case "request":
      return `${item.workspace}/${item.request.project}`;
    case "overlap":
      return `${item.overlap.workspace}/${item.overlap.project}`;
    case "thread":
    case "agent":
      return byOpen.get(openKey(item.open));
    case "stale":
      return item.open === undefined ? undefined : byOpen.get(openKey(item.open));
  }
}
