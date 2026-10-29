import type { ReviewRoute } from "@t3tools/client-runtime/peer/ownership";
import {
  TASK_STATES_NEEDING_YOU,
  taskState,
  type TaskState,
  type TaskStateKind,
} from "@t3tools/client-runtime/peer/work";

import type { StateTone } from "./taskChats.logic";
import type { TaskOverlap } from "./workGroups.logic";
import { openKey, type AgentNeed, type WorkOpen, type WorkTaskNode } from "./workTree.logic";

/** Where a task row sends the person: the task's page, its review, or one of their chats. */
export type TaskRowTarget =
  | {
      readonly kind: "task" | "review";
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
 * The explicit task-details destination, also used for a title when no review asks the person.
 */
export function taskRowTarget(task: WorkTaskNode, scope: RowScope): TaskRowTarget {
  return { kind: "task", workspace: scope.workspace, project: scope.projectId, task: task.id };
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

/**
 * The chip that does a waiting task's one thing: review it, answer or approve in its chat, or, for
 * an item nobody decided how to run yet, open it to decide.
 */
export interface TaskRowChip {
  readonly label: "Review" | "Answer" | "Approve" | "Decide";
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
  /**
   * Whom the task's review asks (`taskOwnership`), for a task in review: a review that asks someone
   * else is not the person's to do, so the row says whose it is and offers no Review chip. Without
   * it a review asks everyone, as before ownership.
   */
  readonly review?: ReviewRoute | undefined;
}): TaskRowModel {
  const { task, scope } = input;
  const needOf = input.needOf ?? new Map<string, AgentNeed>();
  const state = taskState(task, needOf, input.review);
  const chip =
    chipOf(state, task, scope, needOf) ??
    (task.unsettled === true && !task.done
      ? { label: "Decide" as const, target: taskRowTarget(task, scope) }
      : undefined);
  return {
    state,
    look: taskStateLook(state.kind),
    chats: chatsLabel(task.threads.length),
    chip,
    overlap: input.overlap,
    target: chip?.target.kind === "review" ? chip.target : taskRowTarget(task, scope),
  };
}
