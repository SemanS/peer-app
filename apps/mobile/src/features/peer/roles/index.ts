import type { PeerMobilePlugin } from "../slotTypes";
import { TaskRoles } from "./RoleMark";

/**
 * Session roles on the phone, read-only: the selected task lists its review sessions, and an
 * agent's card on the Work board carries its role (`RoleMark`, drawn by the board, which is not a
 * plugin slot). Starting a review and changing a role happen on a computer.
 */
export const rolesMobilePlugin: PeerMobilePlugin = {
  id: "roles",
  taskSections: TaskRoles,
};
