import { taskOwnership, taskState, type TaskStateKind } from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus, PeerTask } from "@t3tools/contracts";

import { personName, type WorkProjectNode, type WorkTaskNode } from "./workTree.logic";

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

/** What waits first inside an area: you, then work in progress, then what is paused or not begun. */
const STATE_RANK: Readonly<Record<TaskStateKind, number>> = {
  review: 0,
  approval: 0,
  input: 0,
  working: 1,
  waiting: 1,
  accepted: 1,
  paused: 2,
  new: 3,
  done: 4,
};

/** When the task last moved: the hub's update, or the latest turn of one of its chats here. */
function activityAt(task: WorkTaskNode, hub: PeerTask | undefined): number {
  const times = [hub?.updatedAt, ...task.threads.map((thread) => thread.activeAt)]
    .map((at) => (at === undefined ? Number.NaN : Date.parse(at)))
    .filter((at) => Number.isFinite(at));
  return times.length === 0 ? 0 : Math.max(...times);
}

/**
 * Tasks in the order a person works through them: what needs you, what is in progress or waits on
 * a colleague, what is paused, what has not begun; each by its latest activity, the newest first,
 * and tasks alike in both keep the project's order. `rank` says where a task's state puts it; none
 * leaves them in activity order (the done tasks).
 */
function ordered(
  tasks: ReadonlyArray<WorkTaskNode>,
  hub: ReadonlyMap<string, PeerTask>,
  rank: ((task: WorkTaskNode) => number) | undefined,
): ReadonlyArray<WorkTaskNode> {
  return tasks
    .map((task, index) => ({
      task,
      index,
      rank: rank === undefined ? 0 : rank(task),
      at: activityAt(task, hub.get(task.id)),
    }))
    .toSorted((a, b) => a.rank - b.rank || b.at - a.at || a.index - b.index)
    .map(({ task }) => task);
}

/** The project's areas with open tasks, then its done tasks; each task shows once. */
export function groupTasks(project: WorkProjectNode): ReadonlyArray<TaskGroupNode> {
  const hub = new Map(project.tasks.map((task) => [task.id, task]));
  const named = project.areas.some((area) => area.name !== null);
  const done: WorkTaskNode[] = [];
  const groups: TaskGroupNode[] = [];
  for (const area of project.areas) {
    const open: WorkTaskNode[] = [];
    for (const task of area.tasks)
      (taskIsDone(task, hub.get(task.id)?.status) ? done : open).push(task);
    if (open.length > 0)
      groups.push({
        id: `area:${area.name ?? ""}`,
        title: area.name ?? (named ? "No area" : undefined),
        done: false,
        // A review that asks someone else is that person's to do: the task waits on them.
        tasks: ordered(
          open,
          hub,
          (task) =>
            STATE_RANK[
              taskState(task, undefined, taskOwnership(project, task, area.name).review).kind
            ],
        ),
      });
  }
  if (done.length > 0)
    groups.push({ id: "done", title: "Done", done: true, tasks: ordered(done, hub, undefined) });
  return groups;
}

/** The open overlaps one of whose agents works on the task, in the project they are in. */
function overlapsOnTask(
  status: PeerHubStatus,
  project: Pick<WorkProjectNode, "workspace" | "projectId">,
  taskId: string,
) {
  if (!status.coordination.enabled) return { onTask: new Set<string>(), overlaps: [] };
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
  return {
    onTask,
    overlaps: status.coordination.overlaps.filter(
      (overlap) =>
        overlap.state === "open" &&
        overlap.workspace === project.workspace &&
        overlap.project === project.projectId &&
        overlap.sessions.some((session) => onTask.has(session)),
    ),
  };
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
  return overlapsOnTask(status, project, taskId).overlaps.length > 0;
}

/** An overlap on a task as its row names it: the overlap to open, and what it is with. */
export interface TaskOverlap {
  readonly id: string;
  /** "overlaps ORD-6", "overlaps Ana’s agent", with "+1" when the task has another one. */
  readonly label: string;
}

/**
 * The overlap a task row points at, the first open one, named by what the other agent works on:
 * its task's key (or title), else whose agent it is.
 */
export function taskOverlap(
  status: PeerHubStatus,
  project: Pick<WorkProjectNode, "workspace" | "projectId" | "tasks">,
  taskId: string,
): TaskOverlap | undefined {
  const { onTask, overlaps } = overlapsOnTask(status, project, taskId);
  const first = overlaps[0];
  if (first === undefined) return undefined;
  const sessions = new Map(
    status.coordination.sessions.map((session) => [session.id, session] as const),
  );
  const whom = (overlap: (typeof overlaps)[number]): string => {
    // The agent on the other side; when both work on this task, the one that is not yours.
    const others = overlap.sessions.filter((id) => !onTask.has(id));
    const other = (others.length > 0 ? others : overlap.sessions)
      .map((id) => sessions.get(id))
      .find(
        (session) => session !== undefined && (others.length > 0 || session.email !== status.email),
      );
    if (other === undefined) return "another agent";
    const task =
      other.task === undefined ? undefined : project.tasks.find((t) => t.id === other.task);
    if (task !== undefined && task.id !== taskId) return task.key ?? task.title;
    return other.email === status.email
      ? "your other agent"
      : `${personName(status, project.workspace, other.email)}’s agent`;
  };
  const names = [...new Set(overlaps.map(whom))];
  const more = names.length - 1;
  return { id: first.id, label: `overlaps ${names[0]}${more > 0 ? ` +${more}` : ""}` };
}
