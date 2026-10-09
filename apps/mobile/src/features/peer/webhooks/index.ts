import type { PeerMobilePlugin } from "../slotTypes";
import { PeerWebhooks } from "./PeerWebhooks";
export const webhooksMobilePlugin: PeerMobilePlugin = {
  id: "webhooks",
  workspaceSections: [{ place: "end", Component: PeerWebhooks }],
};
