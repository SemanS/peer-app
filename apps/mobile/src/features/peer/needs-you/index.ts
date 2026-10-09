import type { PeerMobilePlugin } from "../slotTypes";
import { NeedsYouWorkspace } from "./NeedsYouWorkspace";
export const needsYouMobilePlugin: PeerMobilePlugin = {
  id: "needs-you",
  workspaceSections: [{ place: "tasks", Component: NeedsYouWorkspace }],
};
