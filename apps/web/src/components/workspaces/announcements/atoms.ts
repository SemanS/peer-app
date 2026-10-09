import { createAnnouncementsEnvironmentAtoms } from "@t3tools/client-runtime/peer/announcements";
import { connectionAtomRuntime } from "../../../connection/runtime";
export const announcementAtoms = createAnnouncementsEnvironmentAtoms(connectionAtomRuntime);
