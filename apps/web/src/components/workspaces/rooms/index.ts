import type { PeerWebPlugin } from "../slots.types";
import { RoomBadge, RoomReviewSection, RoomTaskSection } from "./RoomCard";
import { RoomsInbox } from "./RoomsInbox";
import { roomNeedsCount, roomPalette } from "./roomSlots.logic";

/**
 * Task rooms: a task's conversation between people and their agents, with its diff beside it. The
 * page is `room.$workspace.$project.$task`; a card on the task and its review, a badge, Needs you
 * and the palette lead there. Off, or not served by the Hub, it adds nothing.
 */
export const roomsWebPlugin: PeerWebPlugin = {
  id: "rooms",
  needsYou: { count: roomNeedsCount, Component: RoomsInbox },
  taskSections: RoomTaskSection,
  taskReview: RoomReviewSection,
  taskBadges: RoomBadge,
  palette: roomPalette,
};
