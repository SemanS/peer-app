import type { EnvironmentId, PeerTask, ThreadId } from "@t3tools/contracts";

import type { SignalTone } from "../signals";
import type { WorkTaskNode } from "../workTree.logic";

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
 * The person's own agent on a task on this computer, to send a reopening note to: their Peer thread
 * that was active last, else their herdr agent. A colleague's thread, one on another computer and
 * one whose runtime is gone never get it.
 */
export function reopenTarget(task: Pick<WorkTaskNode, "threads">): ReopenTarget {
  const mine = task.threads
    .filter((thread) => thread.mine && thread.localEnvironment === true && !thread.stale)
    .sort((a, b) => Date.parse(b.activeAt ?? "0") - Date.parse(a.activeAt ?? "0"));
  for (const thread of mine) {
    if (thread.open?.kind === "thread") {
      return {
        kind: "thread",
        environmentId: thread.open.environmentId,
        threadId: thread.open.threadId,
        title: thread.title,
      };
    }
  }
  for (const thread of mine) {
    if (thread.open?.kind === "herdr") {
      return { kind: "herdr", agentId: thread.open.agentId, title: thread.title };
    }
  }
  return { kind: "none" };
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
