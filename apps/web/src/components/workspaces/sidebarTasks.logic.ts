import type { WorkProjectNode, WorkTaskNode } from "./workTree.logic";
import { taskIsDone } from "./workGroups.logic";
import { ancestorIds, nestProjectTasks, treeIndexOf, type NestedRow } from "./taskTree.logic";

/** One area of the Tasks tab: its open tasks, and its done ones behind one row. */
export interface SidebarArea {
  /** `group:<task id>`, `area:<name>`, or `area:` for tasks in no area. */
  readonly id: string;
  /** Undefined while the project names no area, so no heading shows. */
  readonly title: string | undefined;
  readonly done: number;
  readonly total: number;
  readonly open: ReadonlyArray<NestedRow<WorkTaskNode>>;
  readonly finished: ReadonlyArray<NestedRow<WorkTaskNode>>;
}

export interface SidebarTasks {
  /** The one change the project's open work belongs to; the header's subtitle. */
  readonly change: string | undefined;
  readonly total: number;
  readonly areas: ReadonlyArray<SidebarArea>;
}

/**
 * The project as the Tasks tab shows it, Area → Task, in the tree's order. A root group with groups
 * under it is a change (an OpenSpec change imports as one) and those groups are its areas; any
 * other root group is an area itself; tasks in no group keep the area the project gave them.
 */
export function sidebarTasks(project: WorkProjectNode): SidebarTasks {
  const index = treeIndexOf(project);
  const hub = new Map(project.tasks.map((task) => [task.id, task]));
  const tasks = project.areas.flatMap((area) =>
    area.tasks.map((task) => ({ task, area: area.name })),
  );
  const named = project.areas.some((area) => area.name !== null);
  const hasGroupUnder = new Set(
    tasks.flatMap(({ task }) =>
      task.kind === "group" && task.parent !== undefined ? [task.parent] : [],
    ),
  );
  const isChange = (task: WorkTaskNode | undefined) =>
    task !== undefined && task.parent === undefined && hasGroupUnder.has(task.id);
  const byArea = new Map<
    string,
    { readonly title: string | undefined; readonly tasks: Array<WorkTaskNode> }
  >();
  for (const { task, area } of tasks) {
    if (task.kind === "group") continue;
    const ancestors = ancestorIds(index, task).map((id) => index.get(id)?.task);
    const root = ancestors.at(-1);
    const head = isChange(root) ? (ancestors.at(-2) ?? root) : root;
    const id = head === undefined ? `area:${area ?? ""}` : `group:${head.id}`;
    const title = head?.title ?? area ?? (named ? "No area" : undefined);
    const known = byArea.get(id) ?? { title, tasks: [] };
    known.tasks.push(task);
    byArea.set(id, known);
  }
  const isDone = (task: WorkTaskNode) => taskIsDone(task, hub.get(task.id)?.status);
  const changes = tasks.filter(({ task }) => isChange(task) && !isDone(task));
  const areas = [...byArea].map(([id, area]) => ({
    id,
    title: area.title,
    done: area.tasks.filter(isDone).length,
    total: area.tasks.length,
    open: nestProjectTasks(
      project,
      area.tasks.filter((task) => !isDone(task)),
    ),
    finished: nestProjectTasks(project, area.tasks.filter(isDone)),
  }));
  return {
    change: changes.length === 1 ? changes[0]?.task.title : undefined,
    total: areas.reduce((total, area) => total + area.total, 0),
    areas,
  };
}

/**
 * The areas that start unfolded: the first with open work, and the one holding the open task, so
 * the row the main area shows is never hidden.
 */
export function openAreasByDefault(
  areas: ReadonlyArray<SidebarArea>,
  activeTask: string | undefined,
): ReadonlySet<string> {
  const first = areas.find((area) => area.open.length > 0);
  const active = areas.find((area) =>
    [...area.open, ...area.finished].some((row) => row.item.id === activeTask),
  );
  return new Set([first?.id, active?.id].filter((id) => id !== undefined));
}

/** "1 task", "24 tasks". */
export function tasksCountLabel(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}
