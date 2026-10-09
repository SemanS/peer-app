import type { PeerWebPlugin } from "../slots.types";
import { NotifyAgentsDialog } from "./NotifyAgentsDialog";
import { ProjectAnnouncements } from "./AnnouncementList";
import { AnnouncementSettings, AnnouncementCredentials } from "./AnnouncementSettings";
export const announcementsWebPlugin: PeerWebPlugin = {
  id: "announcements",
  projectActions: NotifyAgentsDialog,
  projectRows: ProjectAnnouncements,
  settings: AnnouncementSettings,
  projectSettings: AnnouncementCredentials,
};
