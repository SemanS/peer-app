import type { PeerTask } from "@t3tools/contracts";

import { boardColumn } from "./workBoard.logic";
import type { WorkProjectNode, WorkTaskNode } from "./workTree.logic";

/**
 * How the sidebar lists a project's tasks: what waits for a person's review, what agents work on
 * now, the rest, and what is done. Each task shows once, in the first group it fits.
 */
export type TaskGroup = "review" | "working" | "idle" | "done";

export const TASK_GROUPS: ReadonlyArray<{ readonly id: TaskGroup; readonly title: string }> = [
  { id: "review", title: "In review" },
  { id: "working", title: "Working" },
  { id: "idle", title: "Idle" },
  { id: "done", title: "Done" },
];

export function taskGroup(
  task: WorkTaskNode,
  hubStatus: PeerTask["status"] | undefined,
): TaskGroup {
  if (task.done || hubStatus === "done" || task.status === "done") return "done";
  // An agent that waits for an answer is still at work; Needs you shows what it waits for.
  if (task.status === "working" || task.status === "blocked") return "working";
  if (hubStatus === "review" || task.threads.some((thread) => boardColumn(thread) === "review"))
    return "review";
  return "idle";
}

export interface GroupedTask {
  readonly task: WorkTaskNode;
  /** Its area, when the project sorts tasks into more than one. */
  readonly area: string | undefined;
}

export interface TaskGroupNode {
  readonly id: TaskGroup;
  readonly title: string;
  readonly tasks: ReadonlyArray<GroupedTask>;
}

/** The project's non-empty groups, each task in its area's order. */
export function groupTasks(project: WorkProjectNode): ReadonlyArray<TaskGroupNode> {
  const hubStatus = new Map(project.tasks.map((task) => [task.id, task.status]));
  const named = project.areas.filter((area) => area.name !== null).length;
  const showArea = named > 1 || (named === 1 && project.areas.length > 1);
  const byGroup = new Map<TaskGroup, GroupedTask[]>(TASK_GROUPS.map((group) => [group.id, []]));
  for (const area of project.areas)
    for (const task of area.tasks)
      byGroup.get(taskGroup(task, hubStatus.get(task.id)))!.push({
        task,
        area: showArea ? (area.name ?? undefined) : undefined,
      });
  return TASK_GROUPS.map((group) => ({ ...group, tasks: byGroup.get(group.id)! })).filter(
    (group) => group.tasks.length > 0,
  );
}

/**
 * Review and work in progress are open; idle tasks open on their own only while nothing is in
 * review or at work, so a new project still shows its tasks; done ones stay folded.
 */
export function groupOpenByDefault(
  group: TaskGroup,
  groups: ReadonlyArray<TaskGroupNode>,
): boolean {
  if (group === "done") return false;
  if (group === "idle") return !groups.some((g) => g.id === "review" || g.id === "working");
  return true;
}
