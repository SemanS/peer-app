import type { PeerMobilePlugin } from "../slotTypes";
import { PeerHeldResources } from "./PeerHeldResources";
export const resourcesMobilePlugin: PeerMobilePlugin = {
  id: "resources",
  workspaceSections: [{ place: "end", Component: PeerHeldResources }],
};
