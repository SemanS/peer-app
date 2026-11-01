import type { ReviewRoute } from "@t3tools/client-runtime/peer/ownership";
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
  accepted: { tone: "delivery", hollow: true },
  review: { tone: "needs", hollow: false },
  approval: { tone: "needs", hollow: false },
  input: { tone: "needs", hollow: false },
  agent_action: { tone: "working", hollow: false },
  coordination: { tone: "working", hollow: true },
  working: { tone: "working", hollow: false },
  waiting: { tone: "working", hollow: true },
  paused: { tone: "neutral", hollow: false },
  new: { tone: "neutral", hollow: true },
};

/** Amber for what waits on you, blue for work, green when done, grey when quiet. */
export function taskStateLook(kind: TaskStateKind): TaskStateLook {
  return LOOK[kind];
}

/**
 * The state's words on a row: "Blocked" for work its dependencies hold back, and nothing for a task
 * that has simply not begun or finished, whose dot already says so.
 */
export function rowStateLabel(state: TaskState, blocked: boolean): string | undefined {
  if (state.kind === "done") return undefined;
  if (blocked && (state.kind === "new" || state.kind === "paused")) return "Blocked";
  return state.kind === "new" ? undefined : state.label;
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
  /**
   * Whom the task's review asks (`taskOwnership`), for a task in review: a review that asks someone
   * else is not the person's to do. Without it a review asks everyone, as before ownership.
   */
  readonly review?: ReviewRoute | undefined;
}): TaskRowModel {
  const state = taskState(input.task, input.needOf ?? new Map<string, AgentNeed>(), input.review);
  return { state, look: taskStateLook(state.kind) };
}
