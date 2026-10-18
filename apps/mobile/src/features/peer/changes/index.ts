import type { PeerMobilePlugin } from "../slotTypes";
import { PeerChangesSection } from "./PeerChangesSection";
import { PeerTaskChanges } from "./PeerTaskChanges";

/**
 * Changes on the phone, read-only: each project's Changes section below the tasks (what waits for
 * the person, then the changes in flight) and the selected task's stack. Undo and resolve run on
 * the computer that holds the change. With the plugin off or the Hub too old the registry leaves
 * both out.
 */
export const changesMobilePlugin: PeerMobilePlugin = {
  id: "changes",
  workspaceSections: [{ place: "tasks", Component: PeerChangesSection }],
  taskSections: PeerTaskChanges,
};
