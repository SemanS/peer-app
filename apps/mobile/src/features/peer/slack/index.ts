import type { PeerMobilePlugin } from "../slotTypes";
import { PeerSlack } from "./PeerSlack";

/** Slack: a member's link and options, and for owners and admins the connection, read only. */
export const slackMobilePlugin: PeerMobilePlugin = {
  id: "slack",
  workspaceSections: [{ place: "end", Component: PeerSlack }],
};
