import { MegaphoneIcon } from "lucide-react";

import type { PeerWebPlugin } from "../slots.types";
import { NotifyAgentsDialog } from "./NotifyAgentsDialog";
import { ProjectAnnouncements } from "./AnnouncementList";
import { AnnouncementSettings, AnnouncementCredentials } from "./AnnouncementSettings";
export const announcementsWebPlugin: PeerWebPlugin = {
  id: "announcements",
  projectActions: NotifyAgentsDialog,
  projectRows: ProjectAnnouncements,
  projectSignals: (status, { workspace, projectId }) => {
    const active =
      status.announcements?.projects.find(
        (s) => s.workspace === workspace && s.project === projectId,
      )?.active ?? 0;
    return [
      {
        id: "announcements",
        label: "Announcements",
        icon: MegaphoneIcon,
        count: active,
        detail: active === 0 ? "None active" : "Every live agent gets them once",
        tone: "team",
      },
    ];
  },
  settings: AnnouncementSettings,
  projectSettings: AnnouncementCredentials,
};
