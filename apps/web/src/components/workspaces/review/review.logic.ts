import type { EnvironmentId, PeerTask, ThreadId } from "@t3tools/contracts";

import type { SignalTone } from "../signals";
import type { WorkOpen, WorkTaskNode, WorkThreadNode } from "../workTree.logic";

/** Who hears the note a task is reopened with: the person's own agent on it, here. */
export type ReopenTarget =
  | {
      readonly kind: "thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly title: string;
    }
  | { readonly kind: "herdr"; readonly agentId: string; readonly title: string }
  | { readonly kind: "none" };

/**
 * The person's own agent on a task on this computer: their Peer thread that was active last, else
 * their herdr agent. A colleague's thread, one on another computer and one whose runtime is gone
 * are never it.
 */
function ownAgent(task: Pick<WorkTaskNode, "threads">): WorkThreadNode | undefined {
  const mine = task.threads
    .filter((thread) => thread.mine && thread.localEnvironment === true && !thread.stale)
    .sort((a, b) => Date.parse(b.activeAt ?? "0") - Date.parse(a.activeAt ?? "0"));
  return (
    mine.find((thread) => thread.open?.kind === "thread") ??
    mine.find((thread) => thread.open?.kind === "herdr")
  );
}

/** The agent to send a reopening note to. */
export function reopenTarget(task: Pick<WorkTaskNode, "threads">): ReopenTarget {
  const thread = ownAgent(task);
  const open = thread?.open;
  if (thread === undefined || open === undefined) return { kind: "none" };
  if (open.kind === "thread") {
    return {
      kind: "thread",
      environmentId: open.environmentId,
      threadId: open.threadId,
      title: thread.title,
    };
  }
  return open.kind === "herdr"
    ? { kind: "herdr", agentId: open.agentId, title: thread.title }
    : { kind: "none" };
}

/**
 * The chat a handoff came from, to open from the review: the person's own agent on the task, the
 * one that hears a reopening note. A colleague's handoff comes from a chat only they can open.
 */
export function handoffChat(
  task: Pick<WorkTaskNode, "threads">,
): { readonly title: string; readonly open: WorkOpen } | null {
  const thread = ownAgent(task);
  return thread?.open === undefined ? null : { title: thread.title, open: thread.open };
}

/** A task's state as the review page's pill says it. */
export function reviewState(status: PeerTask["status"] | undefined): {
  readonly label: string;
  readonly tone: SignalTone;
} {
  switch (status) {
    case "review":
      return { label: "Needs review", tone: "delivery" };
    case "done":
      return { label: "Done", tone: "neutral" };
    default:
      return { label: "Open", tone: "working" };
  }
}
