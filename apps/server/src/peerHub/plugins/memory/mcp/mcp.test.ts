import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
  resolveT3McpToolSummaryAction,
} from "@t3tools/shared/t3McpToolPresentation";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer, Tool } from "effect/unstable/ai";

import * as McpInvocationContext from "../../../../mcp/McpInvocationContext.ts";
import * as ThreadManagement from "../../../../orchestration-v2/ThreadManagementService.ts";
import * as PeerPlugins from "../../../core/plugins/PeerPlugins.ts";
import { coreLayer, seedState } from "../../../core/testkit.ts";
import * as PeerHub from "../../../PeerHub.ts";
import { makeMemoryPlugin } from "../index.ts";
import { PeerMemoryToolkit } from "./tools.ts";

const invocation: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-mcp-test"),
  threadId: ThreadId.make("thread-mcp-test"),
  providerSessionId: "provider-session-mcp-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview", "orchestration"]),
  issuedAt: 1,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "mcp-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

/**
 * Peer's MCP toolkits as T3's MCP server registers them when it starts, for core with memory in
 * the build when `available`, turned on then when `on`. `read` counts what the tools read of T3.
 */
const startedServer = (options: { readonly available: boolean; readonly on: boolean }) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(), { plugins: [makeMemoryPlugin(options)] }),
    );
    const plugins = yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      const plugins = yield* PeerPlugins.PeerPlugins;
      if (options.on) yield* plugins.setPlugin({ id: "memory", enabled: true });
      return plugins;
    }).pipe(Effect.provide(core));
    const read = { threads: 0 };
    const server = yield* McpServer.McpServer.pipe(
      Effect.provide(
        PeerHub.mcpLayer.pipe(
          Layer.provideMerge(McpServer.McpServer.layer),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(PeerPlugins.PeerPlugins, plugins),
              Layer.mock(ThreadManagement.ThreadManagementService)({
                getThreadShell: () => {
                  read.threads += 1;
                  return Effect.die("not read in these cases");
                },
              }),
            ),
          ),
        ),
      ),
    );
    const search = server
      .callTool({ name: "peer_memory_search", arguments: { search: { contextIds: [] } } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    const listed = server.tools
      .map(({ tool }) => tool.name)
      .filter((name) => name.startsWith("peer_memory_"));
    return { plugins, listed, search, read };
  });

it.effect("withholds frozen Memory tools and refuses cached calls", () =>
  Effect.gen(function* () {
    const server = yield* startedServer({ available: false, on: false });
    expect(server.listed).toEqual([]);
    const error = yield* server.search.pipe(Effect.flip);
    expect(error.message).toContain("not found");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("lists memory's tools only when memory was on as the server started", () =>
  Effect.gen(function* () {
    expect((yield* startedServer({ available: true, on: false })).listed).toEqual([]);
    expect((yield* startedServer({ available: true, on: true })).listed).toEqual([
      "peer_memory_search",
      "peer_memory_read",
      "peer_memory_changes",
      "peer_memory_project",
      "peer_memory_remember",
      "peer_memory_command",
      "peer_memory_receipt",
      "peer_memory_context",
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses a tool call once memory is turned off, reading nothing", () =>
  Effect.gen(function* () {
    const server = yield* startedServer({ available: true, on: true });
    yield* server.plugins.setPlugin({ id: "memory", enabled: false });
    const result = yield* server.search;
    expect(result.structuredContent).toEqual({
      _tag: "OrchestratorMcpFailure",
      code: "capability_denied",
      message: "Peer Memory is turned off on this environment.",
    });
    expect(server.read.threads).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("publishes memory's tools under unique names, with reference-free object-root inputs", () => {
  const names = new Set<string>();
  for (const tool of Object.values(PeerMemoryToolkit.tools)) {
    expect(names.has(tool.name)).toBe(false);
    names.add(tool.name);
    // T3's own tools never take this prefix, so memory's cannot collide with them.
    expect(tool.name.startsWith("peer_memory_"), tool.name).toBe(true);
    const schema = Tool.getJsonSchema(tool);
    expect(schema).toMatchObject({ type: "object" });
    // The published tool catalog must also work with providers without $ref support.
    expect(JSON.stringify(schema), tool.name).not.toContain('"$ref"');
    // Every published tool must have labels for its lifecycle, branding, and a summary.
    const definition = resolveT3McpToolDefinition(tool.name);
    expect(definition, tool.name).not.toBeNull();
    expect(
      definition?.labels.every((label) => label.trim().length > 0),
      tool.name,
    ).toBe(true);
    for (const name of [tool.name, `mcp__t3-code__${tool.name}`, `T3-code.${tool.name}`]) {
      expect(resolveT3McpToolPresentation(name)?.logo, name).toBe("t3-code");
      expect(resolveT3McpToolSummaryAction(name), name).not.toBeNull();
    }
  }
  expect(names.size).toBe(8);
});
