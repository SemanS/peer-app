import { MegaphoneIcon } from "lucide-react";

import type { PeerWebPlugin } from "../slots.types";
import { NotifyAgentsDialog } from "./NotifyAgentsDialog";
import { ProjectAnnouncements } from "./AnnouncementList";
import { AnnouncementSettings, AnnouncementCredentials } from "./AnnouncementSettings";
export const announcementsWebPlugin: PeerWebPlugin = {
  id: "announcements",
  projectActions: [
    {
      id: "notify-agents",
      label: "Notify agents…",
      hint: "Every live agent in the project hears it once",
      icon: MegaphoneIcon,
      // A Hub from before announcements has nothing to post to.
      available: ({ status, project }) =>
        status.announcements?.unsupported.includes(project.workspace) !== true,
      Dialog: NotifyAgentsDialog,
    },
  ],
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
        chip: (count) => (count === 1 ? "1 announcement" : `${count} announcements`),
      },
    ];
  },
  settings: AnnouncementSettings,
  projectSettings: AnnouncementCredentials,
};
