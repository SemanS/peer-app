import type { PeerWebPlugin } from "../slots.types";
import { ProjectChats } from "./ProjectChats";
import { RoomSharingSettings } from "./RoomSharingSettings";
import { RoomsInbox } from "./RoomsInbox";
import { roomPalette } from "./roomSlots.logic";

/**
 * Task rooms: a task's conversation between people and their agents, with its diff beside it. The
 * page is `room.$workspace.$project.$task`; Needs you and the palette lead there. Off, or not served
 * by the Hub, it adds nothing.
 */
export const roomsWebPlugin: PeerWebPlugin = {
  id: "rooms",
  needsYou: RoomsInbox,
  palette: roomPalette,
  projectRows: ProjectChats,
  settings: RoomSharingSettings,
};
