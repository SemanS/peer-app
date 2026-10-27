import { describe, expect, it } from "vite-plus/test";
import { protocol } from "./protocol.ts";
import {
  AGENT_TOOL_INSTRUCTIONS,
  CORE_AGENT_TOOLS as tools,
} from "../../core/broker/agentTools.ts";
const host = {
  instructions: () => AGENT_TOOL_INSTRUCTIONS,
  client: () => undefined,
  tools: () => tools,
  call: async () => ({ text: "ok", isError: false }),
  prompts: async () => [],
  prompt: async () => ({ text: "prompt" }),
};
const ask = async (message: unknown) => JSON.parse(await protocol(JSON.stringify(message), host));
describe("Peer MCP protocol", () => {
  it("negotiates supported versions and falls back", async () => {
    for (const version of ["2025-06-18", "2025-03-26", "2024-11-05", "future"]) {
      const reply = await ask({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: version },
      });
      expect(reply.result.protocolVersion).toBe(version === "future" ? "2025-06-18" : version);
      expect(reply.result.serverInfo.name).toBe("peer");
    }
  });
  it("answers ping, lists tools and maps command errors into tool results", async () => {
    expect((await ask({ jsonrpc: "2.0", id: 1, method: "ping" })).result).toEqual({});
    expect((await ask({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools).toHaveLength(
      tools.length,
    );
    const reply = await protocol(
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"peer_status"}}',
      {
        ...host,
        call: async () => ({ text: "peer: refused: stale input\nNext: read it", isError: true }),
      },
    );
    expect(JSON.parse(reply).result).toEqual({
      content: [{ type: "text", text: "peer: refused: stale input\nNext: read it" }],
      isError: true,
    });
  });
  it("ignores notifications and reports parse, envelope, method and params errors", async () => {
    expect(await protocol('{"jsonrpc":"2.0","method":"notifications/initialized"}', host)).toBe("");
    expect(JSON.parse(await protocol("no", host)).error.code).toBe(-32700);
    expect((await ask([])).error.code).toBe(-32600);
    expect((await ask({ jsonrpc: "2.0", id: 1, method: "unknown" })).error.code).toBe(-32601);
    expect(
      (await ask({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "unknown" } }))
        .error.code,
    ).toBe(-32602);
  });
});
