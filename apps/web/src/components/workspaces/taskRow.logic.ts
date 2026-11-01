import { taskState, type TaskState, type TaskStateKind } from "@t3tools/client-runtime/peer/work";

import type { StateTone } from "./taskChats.logic";
import type { AgentNeed, WorkTaskNode } from "./workTree.logic";

interface RowScope {
  readonly workspace: string;
  readonly projectId: string;
}

/**
 * The route key a task's room highlights its row by, the way `useWorkData` names the routes the
 * sidebar highlights.
 */
export function taskRouteKey(scope: RowScope, taskId: string): string {
  return `task:${scope.workspace}:${scope.projectId}:${taskId}`;
}

/** The tone of a state's words and whether its dot is filled or hollow. */
export interface TaskStateLook {
  readonly tone: StateTone;
  readonly hollow: boolean;
}

const LOOK: Readonly<Record<TaskStateKind, TaskStateLook>> = {
  done: { tone: "delivery", hollow: false },
  review: { tone: "needs", hollow: false },
  approval: { tone: "needs", hollow: false },
  input: { tone: "needs", hollow: false },
  working: { tone: "working", hollow: false },
  waiting: { tone: "working", hollow: true },
  paused: { tone: "neutral", hollow: false },
  new: { tone: "neutral", hollow: true },
};

/** Amber for what waits on you, blue for work, green when done, grey when quiet. */
export function taskStateLook(kind: TaskStateKind): TaskStateLook {
  return LOOK[kind];
}

/** The state's words on a row: nothing for a task that has not begun or finished, as its dot says. */
export function rowStateLabel(state: TaskState): string | undefined {
  return state.kind === "done" || state.kind === "new" ? undefined : state.label;
}

/** What a task row says: its state in words, and how its dot looks. */
export interface TaskRowModel {
  readonly state: TaskState;
  readonly look: TaskStateLook;
}

/** The row of a task: line one is its key and title, line two its state (`taskState`). */
export function taskRowModel(input: {
  readonly task: WorkTaskNode;
  /** What each of the person's waiting chats waits for. */
  readonly needOf?: ReadonlyMap<string, AgentNeed> | undefined;
}): TaskRowModel {
  const state = taskState(input.task, input.needOf ?? new Map<string, AgentNeed>());
  return { state, look: taskStateLook(state.kind) };
}
