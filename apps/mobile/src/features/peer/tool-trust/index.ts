import type { PeerMobilePlugin } from "../slotTypes";
import { ToolTrustSection } from "./ToolTrustSection";
export const toolTrustMobilePlugin: PeerMobilePlugin = {
  id: "tool-trust",
  workspaceSections: [{ place: "end", Component: ToolTrustSection }],
};
