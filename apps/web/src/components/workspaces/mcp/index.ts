import type { PeerWebPlugin } from "../slots.types";
import { McpSettings } from "./McpSettings";
export const mcpWebPlugin: PeerWebPlugin = { id: "mcp", settings: McpSettings };
