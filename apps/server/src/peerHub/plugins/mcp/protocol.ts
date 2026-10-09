import * as Schema from "effect/Schema";
import { type PeerAgentPrompt, type PeerAgentTool, CliError, render } from "../../core/plugin.ts";
import { instructions } from "./tools.ts";

const envelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  method: Schema.String,
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const callParams = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const promptParams = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
interface Host {
  readonly tools: () => ReadonlyArray<PeerAgentTool>;
  readonly call: (
    command: string,
    args: ReadonlyArray<string>,
  ) => Promise<{ readonly text: string; readonly isError: boolean }>;
  readonly prompts: () => Promise<ReadonlyArray<PeerAgentPrompt>>;
  readonly prompt: (
    name: string,
    args: Readonly<Record<string, string>>,
  ) => Promise<{ readonly description?: string; readonly text: string }>;
}
export async function protocol(line: string, host: Host): Promise<string> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }
  const decoded = Schema.decodeUnknownOption(envelope)(raw);
  if (decoded._tag === "None")
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid request" },
    });
  const message = decoded.value;
  if (message.id === undefined) return "";
  const reply = (result: unknown) => JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
  const error = (code: number, text: string) =>
    JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
  switch (message.method) {
    case "initialize": {
      const version = message.params?.protocolVersion;
      return reply({
        protocolVersion: ["2025-06-18", "2025-03-26", "2024-11-05"].includes(String(version))
          ? version
          : "2025-06-18",
        capabilities: { tools: {}, prompts: { listChanged: true } },
        serverInfo: { name: "peer", version: "1" },
        instructions,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: host
          .tools()
          .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case "tools/call": {
      const params = Schema.decodeUnknownOption(callParams)(message.params);
      if (params._tag === "None") return error(-32602, "Invalid tool parameters");
      const tool = host.tools().find((tool) => tool.name === params.value.name);
      if (tool === undefined) return error(-32602, "Unknown tool");
      try {
        const result = await host.call(tool.command, tool.arguments(params.value.arguments ?? {}));
        return reply({
          content: [{ type: "text", text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        });
      } catch (failure) {
        if (failure instanceof CliError)
          return reply({ content: [{ type: "text", text: render(failure) }], isError: true });
        return error(-32603, "Peer could not answer this tool call");
      }
    }
    case "prompts/list":
      try {
        return reply({ prompts: await host.prompts() });
      } catch (failure) {
        return error(
          -32602,
          failure instanceof CliError ? render(failure) : "Peer could not list prompts",
        );
      }
    case "prompts/get": {
      const params = Schema.decodeUnknownOption(promptParams)(message.params);
      if (params._tag === "None") return error(-32602, "Invalid prompt parameters");
      try {
        const prompt = await host.prompt(params.value.name, params.value.arguments ?? {});
        return reply({
          ...(prompt.description === undefined ? {} : { description: prompt.description }),
          messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
        });
      } catch (failure) {
        return error(-32602, failure instanceof Error ? failure.message : "Unknown prompt");
      }
    }
    default:
      return error(-32601, "Method not found");
  }
}
