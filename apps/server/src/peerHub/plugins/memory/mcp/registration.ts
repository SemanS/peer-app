/**
 * Memory's MCP toolkit as the plugin contributes it. T3's MCP server registers toolkits once, when
 * it starts, so the tools are listed only when memory was turned on then: turning memory on lists
 * them after a restart, and turning it off makes them refuse calls until then.
 *
 * @module peerHub/plugins/memory/mcp/registration
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/unstable/ai";

import type * as PeerPlugins from "../../../core/plugins/PeerPlugins.ts";
import * as MemoryRuntime from "../MemoryRuntime.ts";
import * as MemoryService from "../MemoryService.ts";
import { PeerMemoryHandlersLive } from "./handlers.ts";
import * as PeerMemoryMcpService from "./PeerMemoryMcpService.ts";
import { PeerMemoryToolkit } from "./tools.ts";

export const memoryToolkit = (services: {
  readonly runtime: MemoryRuntime.MemoryRuntime["Service"];
  readonly memory: MemoryService.MemoryService["Service"];
  readonly plugins: PeerPlugins.PeerPlugins["Service"];
}) => {
  const toolkit = McpServer.toolkit(PeerMemoryToolkit).pipe(
    Layer.provide(PeerMemoryHandlersLive),
    Layer.provide(PeerMemoryMcpService.layer(services.plugins.requireActive("memory"))),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MemoryRuntime.MemoryRuntime, services.runtime),
        Layer.succeed(MemoryService.MemoryService, services.memory),
      ),
    ),
  );
  return Layer.unwrap(
    services.plugins.states.pipe(
      Effect.map((states) =>
        states.some((plugin) => plugin.id === "memory" && plugin.enabled) ? toolkit : Layer.empty,
      ),
    ),
  );
};
