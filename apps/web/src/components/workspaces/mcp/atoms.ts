import { createMcpEnvironmentAtoms } from "@t3tools/client-runtime/peer/mcp";
import { connectionAtomRuntime } from "../../../connection/runtime";
export const mcpAtoms = createMcpEnvironmentAtoms(connectionAtomRuntime);
