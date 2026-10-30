import type { PeerMobilePlugin } from "../slotTypes";
import { RoomTaskBadge, RoomTaskRow } from "./RoomTaskRow";

/**
 * A task's room on the phone: its row and count on the task, a Room screen and items in Needs you.
 * The composer writes to the team or the person's own agent. There is no diff here, so an anchored
 * message shows `path:line` as text, and a run's reach is set on a computer.
 */
export const roomsMobilePlugin: PeerMobilePlugin = {
  id: "rooms",
  taskBadges: RoomTaskBadge,
  taskSections: RoomTaskRow,
};
