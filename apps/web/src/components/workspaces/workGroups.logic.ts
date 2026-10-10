import type { PeerHubStatus, PeerTask } from "@t3tools/contracts";

import type { WorkProjectNode, WorkTaskNode } from "./workTree.logic";

/**
 * How the sidebar lists a project's tasks: by area in the project's order, each task's state on its
 * row, and what is done folded into one group at the end.
 */
export interface TaskGroupNode {
  /** `area:<name>`, `area:` for tasks in no area, or `done`. */
  readonly id: string;
  /** The area's name; undefined while the project names no area, so no heading shows. */
  readonly title: string | undefined;
  readonly done: boolean;
  readonly tasks: ReadonlyArray<WorkTaskNode>;
}

/** A task is done once it is closed, the hub says so or all its work finished. */
export function taskIsDone(task: WorkTaskNode, hubStatus: PeerTask["status"] | undefined): boolean {
  return task.done || hubStatus === "done" || task.status === "done";
}

/** The project's areas with open tasks, then its done tasks; each task shows once. */
export function groupTasks(project: WorkProjectNode): ReadonlyArray<TaskGroupNode> {
  const hubStatus = new Map(project.tasks.map((task) => [task.id, task.status]));
  const named = project.areas.some((area) => area.name !== null);
  const done: WorkTaskNode[] = [];
  const groups: TaskGroupNode[] = [];
  for (const area of project.areas) {
    const open: WorkTaskNode[] = [];
    for (const task of area.tasks)
      (taskIsDone(task, hubStatus.get(task.id)) ? done : open).push(task);
    if (open.length > 0)
      groups.push({
        id: `area:${area.name ?? ""}`,
        title: area.name ?? (named ? "Other" : undefined),
        done: false,
        tasks: open,
      });
  }
  if (done.length > 0) groups.push({ id: "done", title: "Done", done: true, tasks: done });
  return groups;
}

/**
 * Whether agents on the task overlap with another agent: an open overlap one of whose sessions
 * works on it. The row marks it like the board and the overlap page do.
 */
export function taskHasOverlap(
  status: PeerHubStatus,
  project: Pick<WorkProjectNode, "workspace" | "projectId">,
  taskId: string,
): boolean {
  if (!status.coordination.enabled) return false;
  const onTask = new Set(
    status.coordination.sessions
      .filter(
        (session) =>
          session.workspace === project.workspace &&
          session.project === project.projectId &&
          session.task === taskId,
      )
      .map((session) => session.id),
  );
  return status.coordination.overlaps.some(
    (overlap) =>
      overlap.state === "open" &&
      overlap.workspace === project.workspace &&
      overlap.project === project.projectId &&
      overlap.sessions.some((session) => onTask.has(session)),
  );
}
