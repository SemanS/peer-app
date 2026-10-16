import * as Effect from "effect/Effect";
import * as McpToolAccess from "../../../../mcp/McpToolAccess.ts";
import * as Memory from "./PeerMemoryMcpService.ts";
import { PeerMemoryToolkit } from "./tools.ts";

// Every tool acts as the calling thread's runtime, never for an external MCP client. The tools
// annotated readonly read memory; the others write it, or record what the runtime was given.
const handlers = {
  peer_memory_search: McpToolAccess.readsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.search(input))),
  ),
  peer_memory_read: McpToolAccess.readsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.read(input))),
  ),
  peer_memory_changes: McpToolAccess.readsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.changes(input))),
  ),
  peer_memory_project: McpToolAccess.actsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.project(input))),
  ),
  peer_memory_remember: McpToolAccess.actsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.execute(input, true))),
  ),
  peer_memory_command: McpToolAccess.actsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.execute(input))),
  ),
  peer_memory_receipt: McpToolAccess.actsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.receipt(input))),
  ),
  peer_memory_context: McpToolAccess.actsAsCaller((input) =>
    Memory.PeerMemoryMcpService.pipe(Effect.flatMap((service) => service.context(input))),
  ),
} satisfies McpToolAccess.Handlers<typeof PeerMemoryToolkit.tools>;

export const PeerMemoryHandlersLive = McpToolAccess.toLayer(PeerMemoryToolkit, handlers);
