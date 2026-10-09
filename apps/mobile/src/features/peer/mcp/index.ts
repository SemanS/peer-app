import type { PeerMobilePlugin } from "../slotTypes";
import { PeerMcpSettings } from "./PeerMcpSettings";
export const mcpMobilePlugin: PeerMobilePlugin = {
  id: "mcp",
  workspaceSections: [{ place: "end", Component: PeerMcpSettings }],
};
