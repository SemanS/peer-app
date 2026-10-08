import type { ContextMenuItem } from "@t3tools/contracts";

import type { WorkThreadNode } from "../workTree.logic";

/** The item that brings a herdr agent's pane forward in herdr; other threads have no pane. */
export function herdrMenuItem(
  thread: Pick<WorkThreadNode, "open">,
): ContextMenuItem<string> | null {
  return thread.open?.kind === "herdr" ? { id: "show-in-herdr", label: "Show in herdr" } : null;
}
