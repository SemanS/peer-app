import type { PeerMcpServer, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";

/**
 * The MCP servers a workspace adds to a thread's agent, by server name (stdio ones are started by
 * the agent). The host provides the resolver; without one an agent gets none.
 */
export class PluginMcpServers extends Context.Reference<
  (threadId: ThreadId, driver: string) => Readonly<Record<string, PeerMcpServer>>
>("@t3tools/provider-core/server/PluginMcpServers", { defaultValue: () => () => ({}) }) {}
