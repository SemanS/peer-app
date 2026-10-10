import type { PeerMobilePlugin } from "../slotTypes";
import { PeerAnnouncements } from "./PeerAnnouncements";
import { AnnouncementPreferences } from "./AnnouncementPreferences";
export const announcementsMobilePlugin: PeerMobilePlugin = {
  id: "announcements",
  workspaceSections: [
    { place: "tasks", Component: PeerAnnouncements },
    { place: "end", Component: AnnouncementPreferences },
  ],
  projectSignals: (status, { workspace, projectId }) => {
    const active =
      status.announcements?.projects.find(
        (state) => state.workspace === workspace && state.project === projectId,
      )?.active ?? 0;
    return [
      {
        id: "announcements",
        label: "Announcements",
        icon: "bell.badge",
        count: active,
        detail: active === 0 ? "None active" : "Every live agent gets them once",
        tone: "team",
      },
    ];
  },
};
