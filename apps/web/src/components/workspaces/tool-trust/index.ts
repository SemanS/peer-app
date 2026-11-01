import type { PeerWebPlugin } from "../slots.types";
import { ToolTrustNeedsYou } from "./ToolTrustNeedsYou";
import { ToolTrustSettings } from "./ToolTrustSettings";
export const toolTrustWebPlugin: PeerWebPlugin = {
  id: "tool-trust",
  settings: ToolTrustSettings,
  needsYou: ToolTrustNeedsYou,
};
