import type { PeerMobilePlugin } from "../slotTypes";
import { AcceptanceSection } from "./AcceptanceSection";
import { AcceptedBadge } from "./AcceptedBadge";

/**
 * Acceptance on the phone, read-only: "Accepted" under a task's row, and on the selected task who
 * accepted it, when, the note and the history. Accepting and withdrawing happen on a computer.
 */
export const acceptanceMobilePlugin: PeerMobilePlugin = {
  id: "acceptance",
  taskBadges: AcceptedBadge,
  taskSections: AcceptanceSection,
};
