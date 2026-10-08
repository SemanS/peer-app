import type { PeerMobilePlugin } from "../slotTypes";
import { PeerTeamRequests } from "./PeerTeamRequests";

/** Team requests: what teammates asked of you, and asking one of them. */
export const requestsMobilePlugin: PeerMobilePlugin = {
  id: "requests",
  workspaceSections: [{ place: "tasks", Component: PeerTeamRequests }],
};
