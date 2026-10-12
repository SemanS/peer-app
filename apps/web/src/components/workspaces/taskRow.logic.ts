import {
  TASK_STATES_NEEDING_YOU,
  taskState,
  type TaskState,
  type TaskStateKind,
} from "@t3tools/client-runtime/peer/work";

import type { StateTone } from "./taskChats.logic";
import type { TaskOverlap } from "./workGroups.logic";
import { openKey, type AgentNeed, type WorkOpen, type WorkTaskNode } from "./workTree.logic";

/** Where a task row sends the person: a review, or one of their chats. */
export type TaskRowTarget =
  | {
      readonly kind: "review";
      readonly workspace: string;
      readonly project: string;
      readonly task: string;
    }
  | { readonly kind: "chat"; readonly open: WorkOpen };

interface RowScope {
  readonly workspace: string;
  readonly projectId: string;
}

/**
 * Where the task's title leads, in one place so every row and the "Open task" line agree. The
 * task's own page (`/task/$workspace/$project/$task`) is where it will lead once that page lands:
 * until then the review when the task is in review, else the person's first chat on it, else
 * nowhere (the title is plain text).
 */
export function taskRowTarget(task: WorkTaskNode, scope: RowScope): TaskRowTarget | undefined {
  if (task.inReview === true) {
    return { kind: "review", workspace: scope.workspace, project: scope.projectId, task: task.id };
  }
  const chat = task.threads.find((thread) => thread.mine && thread.open !== undefined);
  return chat?.open === undefined ? undefined : { kind: "chat", open: chat.open };
}

/**
 * The route key a task's page highlights its row by, the way `useWorkData` names the routes the
 * sidebar highlights (`knowledge:…`, `context:…`).
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

/** The chip that does a waiting task's one thing: review it, or answer or approve in its chat. */
export interface TaskRowChip {
  readonly label: "Review" | "Answer" | "Approve";
  readonly target: TaskRowTarget;
}

/** "no chats yet", "1 chat", "3 chats": everyone's, also those the person cannot open. */
function chatsLabel(count: number): string {
  return count === 0 ? "no chats yet" : count === 1 ? "1 chat" : `${count} chats`;
}

/**
 * The person's chat that waits, for an approval the one that needs approving, else the first. Only a
 * chat on this computer counts: one the person can merely watch cannot be answered.
 */
function waitingChat(
  task: WorkTaskNode,
  needOf: ReadonlyMap<string, AgentNeed>,
  kind: "approval" | "input",
): WorkOpen | undefined {
  const waiting = task.threads.flatMap((thread) =>
    thread.mine &&
    !thread.stale &&
    thread.status === "blocked" &&
    (thread.open?.kind === "thread" || thread.open?.kind === "herdr")
      ? [thread.open]
      : [],
  );
  return kind === "approval"
    ? waiting.find((open) => needOf.get(openKey(open)) === "approval")
    : waiting[0];
}

function chipOf(
  state: TaskState,
  task: WorkTaskNode,
  scope: RowScope,
  needOf: ReadonlyMap<string, AgentNeed>,
): TaskRowChip | undefined {
  if (!TASK_STATES_NEEDING_YOU.has(state.kind)) return undefined;
  if (state.kind === "review") {
    return {
      label: "Review",
      target: {
        kind: "review",
        workspace: scope.workspace,
        project: scope.projectId,
        task: task.id,
      },
    };
  }
  if (state.kind !== "approval" && state.kind !== "input") return undefined;
  // A waiting chat the person cannot open from here (on another computer) leaves nothing for the
  // chip to do, so the state's words stand alone.
  const open = waitingChat(task, needOf, state.kind);
  if (open === undefined) return undefined;
  return {
    label: state.kind === "approval" ? "Approve" : "Answer",
    target: { kind: "chat", open },
  };
}

/** What a task row says: its state in words, how many chats it has, and what, if anything, it asks. */
export interface TaskRowModel {
  readonly state: TaskState;
  readonly look: TaskStateLook;
  /** "2 chats". */
  readonly chats: string;
  /** Only while the task waits on the person. */
  readonly chip: TaskRowChip | undefined;
  /** An open overlap of the task, as its orange suffix. */
  readonly overlap: TaskOverlap | undefined;
  /** What the title opens. */
  readonly target: TaskRowTarget | undefined;
}

/**
 * The row of a task: line one is its key and title, line two its state (`taskState`, the same words
 * as the board and the task's page), the overlap it is in, and how many chats it has. The chip
 * exists only for the states that wait on the person.
 */
export function taskRowModel(input: {
  readonly task: WorkTaskNode;
  readonly scope: RowScope;
  /** What each of the person's waiting chats waits for (`needsByOpen`). */
  readonly needOf?: ReadonlyMap<string, AgentNeed> | undefined;
  readonly overlap?: TaskOverlap | undefined;
}): TaskRowModel {
  const { task, scope } = input;
  const needOf = input.needOf ?? new Map<string, AgentNeed>();
  const state = taskState(task, needOf);
  return {
    state,
    look: taskStateLook(state.kind),
    chats: chatsLabel(task.threads.length),
    chip: chipOf(state, task, scope, needOf),
    overlap: input.overlap,
    target: taskRowTarget(task, scope),
  };
}
