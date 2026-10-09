import type { PeerMobilePlugin } from "../slotTypes";
import { PeerHandoff, HandoffTarget } from "./PeerHandoff";
export const handoffMobilePlugin: PeerMobilePlugin = {
  id: "handoff",
  taskSections: PeerHandoff,
  workspaceSections: [{ place: "end", Component: HandoffTarget }],
};
