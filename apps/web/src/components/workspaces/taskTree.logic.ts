import {
  taskOwnership,
  taskState,
  type AgentNeed,
  type TaskState,
} from "@t3tools/client-runtime/peer/work";
import type { PeerHubUpdateTaskInput, PeerTask } from "@t3tools/contracts";

import {
  scopeOfTask,
  scopePrompt,
  subtreeOf,
  type WorkProjectNode,
  type WorkTaskNode,
} from "./workTree.logic";

/**
 * Whether the project's Hub keeps a task tree. A Hub that does sends `executable` on every task; an
 * older one sends none, and the views stay flat with nothing offered that only a tree can do.
 */
export function servesTree(project: Pick<WorkProjectNode, "tasks">): boolean {
  return project.tasks.some((task: PeerTask) => task.executable !== undefined);
}

/** "3/8" over the item's executable descendants; null for an item without any. */
export function progressLabel(task: Pick<WorkTaskNode, "progress">): string | null {
  const progress = task.progress;
  return progress === undefined || progress.total === 0
    ? null
    : `${progress.done}/${progress.total}`;
}

/** One row of a list that keeps a tree's shape among the rows it shows. */
export interface NestedRow<T> {
  readonly item: T;
  /** How many of its ancestors the list shows above it. */
  readonly indent: number;
  /** How many shown rows sit directly under it: a row with any folds them. */
  readonly children: number;
  /** Whether its own parent is the row it sits under; false for a root and for an orphan here. */
  readonly underParent: boolean;
}

/**
 * Nests the rows a list shows (a status's tasks, an area's open ones) the way the tree has them: a
 * row sits under its nearest ancestor among the rows, its siblings in the tree's order, and a row
 * whose ancestors all show elsewhere stays where the list put it. A collapsed row hides what sits
 * under it. `ancestorsOf` names a row's ancestors, the nearest first, by the same ids as `idOf`.
 */
export function nestRows<T>(input: {
  readonly items: ReadonlyArray<T>;
  readonly idOf: (item: T) => string;
  readonly ancestorsOf: (item: T) => ReadonlyArray<string>;
  /** Where the item stands in the tree's order. */
  readonly treeIndex: (item: T) => number;
  readonly collapsed?: ReadonlySet<string>;
}): ReadonlyArray<NestedRow<T>> {
  const { items, idOf, ancestorsOf, treeIndex } = input;
  const shown = new Set(items.map(idOf));
  const children = new Map<string, Array<T>>();
  const roots: Array<T> = [];
  const nearest = new Map<T, string | undefined>();
  for (const item of items) {
    const ancestors = ancestorsOf(item);
    const under = ancestors.find((id) => shown.has(id));
    nearest.set(item, under);
    if (under === undefined) roots.push(item);
    else children.set(under, [...(children.get(under) ?? []), item]);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => treeIndex(a) - treeIndex(b));
  const rows: Array<NestedRow<T>> = [];
  const visit = (item: T, indent: number) => {
    const id = idOf(item);
    const below = children.get(id) ?? [];
    const under = nearest.get(item);
    rows.push({
      item,
      indent,
      children: below.length,
      underParent: under !== undefined && ancestorsOf(item)[0] === under,
    });
    if (input.collapsed?.has(id) === true) return;
    for (const child of below) visit(child, indent + 1);
  };
  for (const root of roots) visit(root, 0);
  return rows;
}

/** A project's tasks by id, with where each stands in the tree's order. */
export function treeIndexOf(
  project: Pick<WorkProjectNode, "areas">,
): ReadonlyMap<string, { readonly task: WorkTaskNode; readonly index: number }> {
  const index = new Map<string, { readonly task: WorkTaskNode; readonly index: number }>();
  for (const task of project.areas.flatMap((area) => area.tasks)) {
    index.set(task.id, { task, index: index.size });
  }
  return index;
}

/** A task's ancestors, the nearest first. */
export function ancestorIds(
  index: ReadonlyMap<string, { readonly task: WorkTaskNode }>,
  task: Pick<WorkTaskNode, "id" | "parent">,
): ReadonlyArray<string> {
  const out: Array<string> = [];
  const seen = new Set([task.id]);
  for (let at = task.parent; at !== undefined && !seen.has(at); at = index.get(at)?.task.parent) {
    seen.add(at);
    out.push(at);
  }
  return out;
}

/** The project's tasks nested as `nestRows` does, for rows that are the project's own tasks. */
export function nestProjectTasks(
  project: Pick<WorkProjectNode, "areas">,
  tasks: ReadonlyArray<WorkTaskNode>,
  collapsed?: ReadonlySet<string>,
): ReadonlyArray<NestedRow<WorkTaskNode>> {
  const index = treeIndexOf(project);
  return nestRows({
    items: tasks,
    idOf: (task) => task.id,
    ancestorsOf: (task) => ancestorIds(index, task),
    treeIndex: (task) => index.get(task.id)?.index ?? Number.MAX_SAFE_INTEGER,
    ...(collapsed === undefined ? {} : { collapsed }),
  });
}

/** An item a new task can sit under, or an existing one move under. */
export interface ParentChoice {
  readonly id: string;
  readonly title: string;
  readonly key: string | undefined;
  readonly depth: number;
  readonly group: boolean;
}

/**
 * What the Under picker lists for what was typed: the project's groups and tasks in the tree's
 * order, matched by title or key. Moving a task leaves out the task and everything under it, which
 * it cannot sit under.
 */
export function parentChoices(
  project: Pick<WorkProjectNode, "areas">,
  query: string,
  moving?: string,
): ReadonlyArray<ParentChoice> {
  const needle = query.trim().toLowerCase();
  const excluded = new Set<string>();
  if (moving !== undefined) {
    excluded.add(moving);
    for (const area of project.areas) {
      for (const task of subtreeOf(area, moving)) excluded.add(task.id);
    }
  }
  return project.areas
    .flatMap((area) => area.tasks)
    .filter(
      (task) =>
        !excluded.has(task.id) &&
        (needle === "" ||
          task.title.toLowerCase().includes(needle) ||
          (task.key?.toLowerCase().includes(needle) ?? false)),
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      key: task.key,
      depth: task.depth ?? 0,
      group: task.kind === "group",
    }));
}

/** The task-tree part of a task's change: settling it, or making it a group or a task. */
export type TreeChange = Pick<PeerHubUpdateTaskInput, "kind" | "executable" | "unsettled">;

/** `One task` runs it as one; `Its parts` makes its items the work. Either way someone decided. */
export const settleChange = (asOne: boolean): TreeChange => ({
  executable: asOne,
  unsettled: false,
});

/** A group is structure and never runs as one; a task is work. */
export const kindChange = (kind: "group" | "task"): TreeChange => ({
  kind,
  executable: kind === "task",
  unsettled: false,
});

/**
 * The first prompt an agent started on the task page gets, or undefined to keep today's (the
 * brief's, or the task's label). A task that runs as one keeps it; a group or a task worked by its
 * parts gets its open items, the same words every launcher uses.
 */
export function launchPrompt(project: WorkProjectNode, task: WorkTaskNode): string | undefined {
  if (task.executable !== false && (task.childCount ?? 0) === 0) return undefined;
  return scopePrompt(scopeOfTask(project, task));
}

/**
 * Whether the task page may start an agent on it: never on an unsettled item, which someone
 * settles first. On a Hub without a tree nothing is unsettled.
 */
export const canLaunch = (task: Pick<WorkTaskNode, "unsettled">): boolean =>
  task.unsettled !== true;

/** An item under a task on its page: where it sits, its state and what it offers. */
export interface TaskItemRow {
  readonly task: WorkTaskNode;
  /** 0 for an item directly under the page's task. */
  readonly indent: number;
  readonly state: TaskState;
  readonly progress: string | null;
  /** An open item that runs as one, which an agent can start on from the row. */
  readonly canStart: boolean;
  /** The first prompt of an agent started on it (`launchPrompt`). */
  readonly prompt: string | undefined;
}

/** The items under a task, in the tree's order, as its page's Items section lists them. */
export function taskItems(
  project: WorkProjectNode,
  task: Pick<WorkTaskNode, "id" | "depth">,
  needs?: ReadonlyMap<string, AgentNeed>,
): ReadonlyArray<TaskItemRow> {
  const area = project.areas.find((candidate) => candidate.tasks.some((t) => t.id === task.id));
  if (area === undefined) return [];
  const base = (task.depth ?? 0) + 1;
  return subtreeOf(area, task.id).map((item) => ({
    task: item,
    indent: Math.max(0, (item.depth ?? 0) - base),
    state: taskState(item, needs, taskOwnership(project, item, area.name).review),
    progress: progressLabel(item),
    canStart:
      item.executable !== false && !item.done && item.inReview !== true && item.unsettled !== true,
    prompt: launchPrompt(project, item),
  }));
}
