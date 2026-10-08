import type { ContextMenuItem } from "@t3tools/contracts";

import type { WorkThreadNode } from "../workTree.logic";

/**
 * The item in the menu of one of your threads that lets the team watch it live, or stops that. A
 * thread its computer no longer reports has nothing to share.
 */
export function observeMenuItem(
  thread: Pick<WorkThreadNode, "stale" | "observable">,
): ContextMenuItem<string> | null {
  if (thread.stale) return null;
  return thread.observable
    ? { id: "unshare", label: "Stop letting the team watch" }
    : { id: "share", label: "Let the team watch" };
}
