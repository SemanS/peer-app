import {
  scopeOfTask,
  scopePrompt,
  type WorkProjectNode,
  type WorkTaskNode,
} from "@t3tools/client-runtime/peer/work";
import type { PeerHubUpdateTaskInput, PeerTask } from "@t3tools/contracts";

/** One row of a project's task list on the Peer screen. */
export interface TaskListRow {
  readonly task: PeerTask;
  /** 0 for a root; each level indents the row a step. */
  readonly depth: number;
  /** `3/8` after a parent's title: its executable items done of all; null without any. */
  readonly progress: string | null;
  /** Nobody decided yet whether it runs as one task or by its parts. */
  readonly unsettled: boolean;
}

/** The left inset of a row, in points: the row's own padding and a step per level. */
export const rowInset = (depth: number) => 16 + Math.min(depth, 6) * 16;

const progressLabel = (node: WorkTaskNode) =>
  node.progress === undefined || node.progress.total === 0
    ? null
    : `${node.progress.done}/${node.progress.total}`;

/**
 * A project's open tasks in tree order (each under its parent, area by area). A done item stays
 * while an open one sits under it, so nothing hangs under a parent the list leaves out.
 */
export function taskListRows(project: WorkProjectNode): ReadonlyArray<TaskListRow> {
  const byId = new Map(project.tasks.map((task) => [task.id, task]));
  const nodes = project.areas.flatMap((area) => area.tasks);
  return nodes.flatMap((node, at): ReadonlyArray<TaskListRow> => {
    const task = byId.get(node.id);
    if (task === undefined) return [];
    const depth = node.depth ?? 0;
    if (node.done) {
      let openBelow = false;
      for (let next = at + 1; next < nodes.length && (nodes[next]!.depth ?? 0) > depth; next++) {
        if (!nodes[next]!.done) {
          openBelow = true;
          break;
        }
      }
      if (!openBelow) return [];
    }
    return [{ task, depth, progress: progressLabel(node), unsettled: node.unsettled === true }];
  });
}

/**
 * The first prompt of an agent started on a task: an executable leaf keeps its key and title, a
 * group or an item that does not run as one gets the scope prompt that lists its open items.
 */
export function taskLaunchPrompt(
  project: WorkProjectNode | undefined,
  task: Pick<PeerTask, "id" | "key" | "title">,
): string {
  const plain = [task.key, task.title].filter(Boolean).join(": ");
  const node = project?.areas.flatMap((area) => area.tasks).find((row) => row.id === task.id);
  if (project === undefined || node === undefined) return plain;
  const group = node.kind === "group" || node.executable === false || (node.childCount ?? 0) > 0;
  return group ? scopePrompt(scopeOfTask(project, node)) : plain;
}

/** How the person settles an unsettled item: run it as one task, or by its parts. */
export type TaskSettlement = "one" | "parts";

export function settleTaskInput(
  target: Pick<PeerHubUpdateTaskInput, "workspace" | "projectId" | "taskId">,
  choice: TaskSettlement,
): PeerHubUpdateTaskInput {
  return { ...target, executable: choice === "one", unsettled: false };
}
