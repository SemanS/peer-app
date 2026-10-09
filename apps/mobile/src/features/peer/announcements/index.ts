import type { PeerMobilePlugin } from "../slotTypes";
import { PeerAnnouncements } from "./PeerAnnouncements";
import { AnnouncementPreferences } from "./AnnouncementPreferences";
export const announcementsMobilePlugin: PeerMobilePlugin = {
  id: "announcements",
  workspaceSections: [
    { place: "tasks", Component: PeerAnnouncements },
    { place: "end", Component: AnnouncementPreferences },
  ],
};
