import type { PeerHubStatus } from "@t3tools/contracts";

import { groupTasks } from "./workGroups.logic";
import type { WorkProjectNode } from "./workTree.logic";

/** How many messages wait on the person in these projects' rooms, mentions included. */
export function sidebarNeedsCount(
  status: Pick<PeerHubStatus, "rooms">,
  projects: ReadonlyArray<Pick<WorkProjectNode, "workspace" | "projectId">>,
): number {
  const held = (need: { readonly workspace: string; readonly project: string }) =>
    projects.some(
      (project) => project.workspace === need.workspace && project.projectId === need.project,
    );
  const { waiting = [], mentions = [] } = status.rooms ?? {};
  return waiting.filter(held).length + mentions.filter(held).length;
}

/** A project's tasks that are not done: what "7 open" counts. Done tasks are counted apart. */
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

/** "7 open"; nothing for none, since a zero count does not show. */
export function activeTasksText(count: number): string | undefined {
  return count > 0 ? `${count} open` : undefined;
}

/** "1 needs you", "4 need you"; nothing for none. */
export function needsYouText(count: number): string | undefined {
  return count > 0 ? `${count} ${count === 1 ? "needs" : "need"} you` : undefined;
}
