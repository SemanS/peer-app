import type { PeerWebPlugin } from "../slots.types";
import { SettingsNoProjects } from "../no-projects/SettingsNoProjects";

/**
 * Settings: workspace and project settings changed in the app. Its contribution to Work is what a
 * workspace without a project for the person says (the pages themselves are reached through the
 * settings routes, which core owns).
 */
export const settingsWebPlugin: PeerWebPlugin = {
  id: "settings",
  noProjects: SettingsNoProjects,
};
