// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalConsole:off globalTimers:off - standalone CLI wire test with a native cancellation timer, never part of the Effect server runtime.
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import * as NodeTimers from "node:timers";
import { query } from "@anthropic-ai/claude-agent-sdk";

import { writeClaudeMod } from "./install.ts";

const listen = (server: NodeHttp.Server, target: string | number) =>
  new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    if (typeof target === "string") server.listen(target, resolve);
    else server.listen(target, "127.0.0.1", resolve);
  });
const close = (server: NodeHttp.Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));
const readBody = async (request: NodeHttp.IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
};

/**
 * Real CLI/SDK and socket I/O; the provider is a deterministic local server, never a model. The
 * `plan-mode` scenario has that provider call ExitPlanMode in plan mode, and the test host approve
 * it, to see what the Mod's PostToolUse sends the broker for it.
 */
export async function smokeClaudeMod(
  executable = "claude",
  scenario: "bash" | "plan-mode" = "bash",
) {
  const planMode = scenario === "plan-mode";
  const candidates = NodePath.isAbsolute(executable)
    ? [executable]
    : (process.env.PATH ?? "")
        .split(NodePath.delimiter)
        .map((directory) => NodePath.join(directory, executable));
  let executablePath: string | undefined;
  for (const candidate of candidates) {
    try {
      await NodeFSP.access(candidate);
      executablePath = candidate;
      break;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  if (executablePath === undefined) throw new Error("Claude Code executable not found");
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-mod-smoke-"));
  const cliMarker = "peer-cli-available-in-bash";
  const socket = `/tmp/peer-mod-${NodeCrypto.randomUUID()}.sock`;
  const note = `Peer smoke input ${NodeCrypto.randomUUID()}`;
  const hooks: string[] = [];
  const postTools: Record<string, unknown>[] = [];
  const startCredentials: string[] = [];
  const providerInputs: string[] = [];
  const usage: Record<string, unknown>[] = [];
  const receipts: Record<string, unknown>[] = [];
  const stderr: string[] = [];
  const send = (response: NodeHttp.ServerResponse, value: unknown) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  const broker = NodeHttp.createServer((request, response) => {
    void readBody(request)
      .then((body) => {
        if (request.headers["x-peer-adapter"] !== "mod") throw new Error("Mod header missing");
        if (request.url === "/hook") {
          const event = String(body.hook_event_name);
          hooks.push(event);
          if (event === "PostToolUse") postTools.push(body);
          if (event === "SessionStart") {
            const token = String(request.headers["x-peer-session-token"] ?? "");
            if (!/^[0-9a-f]{32}$/.test(token)) throw new Error("SessionStart credential missing");
            startCredentials.push(token);
          }
          const offered = event === "SessionStart" || event === "UserPromptSubmit";
          const offeredText = `${note} ${event}`;
          send(response, {
            peerStatus: "Peer smoke",
            ...(offered
              ? {
                  hookSpecificOutput: { hookEventName: event, additionalContext: offeredText },
                  peerDelivery: {
                    id: `smoke-${event}`,
                    text: offeredText,
                    chars: offeredText.length,
                  },
                }
              : {}),
          });
        } else if (request.url === "/usage") {
          usage.push(body);
          send(response, {});
        } else if (request.url === "/delivery") {
          receipts.push(body);
          send(response, {});
        } else {
          response.writeHead(404);
          response.end();
        }
      })
      .catch((error) => {
        response.writeHead(500);
        response.end(String(error));
      });
  });
  const provider = NodeHttp.createServer((request, response) => {
    void readBody(request)
      .then((body) => {
        if (request.url?.startsWith("/v1/messages/count_tokens")) {
          send(response, { input_tokens: 12 });
          return;
        }
        if (request.method !== "POST" || !request.url?.startsWith("/v1/messages")) {
          response.writeHead(404);
          response.end('{"error":{"type":"not_found_error","message":"local fake provider only"}}');
          return;
        }
        providerInputs.push(JSON.stringify(body));
        const probeCli = providerInputs.length === 1;
        const content = probeCli
          ? planMode
            ? {
                type: "tool_use",
                id: "peer-plan-exit",
                name: "ExitPlanMode",
                input: { plan: "Change src/tax.ts and use nothing else." },
              }
            : {
                type: "tool_use",
                id: "peer-cli-probe",
                name: "Bash",
                input: { command: "peer", description: "Check the temporary Peer CLI" },
              }
          : { type: "text", text: "Peer local smoke complete." };
        const message = {
          id: "msg_peer_smoke",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [content],
          stop_reason: probeCli ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 12,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        };
        if (!body.stream) {
          send(response, message);
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const event = (value: Record<string, unknown>) =>
          response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
        event({
          type: "message_start",
          message: {
            ...message,
            content: [],
            stop_reason: null,
            usage: { ...message.usage, output_tokens: 0 },
          },
        });
        event({
          type: "content_block_start",
          index: 0,
          content_block: probeCli ? { ...content, input: {} } : { type: "text", text: "" },
        });
        event({
          type: "content_block_delta",
          index: 0,
          delta: probeCli
            ? { type: "input_json_delta", partial_json: JSON.stringify(content.input) }
            : { type: "text_delta", text: "Peer local smoke complete." },
        });
        event({ type: "content_block_stop", index: 0 });
        event({
          type: "message_delta",
          delta: { stop_reason: message.stop_reason, stop_sequence: null },
          usage: { output_tokens: 5 },
        });
        event({ type: "message_stop" });
        response.end();
      })
      .catch((error) => {
        response.writeHead(500);
        response.end(String(error));
      });
  });
  const controller = new AbortController();
  const timer = NodeTimers.setTimeout(() => controller.abort(), 25_000);
  try {
    await listen(broker, socket);
    await listen(provider, 0);
    const address = provider.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing local provider port");
    const directory = NodePath.join(root, "claude-mod");
    const peerScript = NodePath.join(root, "peer-bin", "peer");
    await NodeFSP.mkdir(NodePath.dirname(peerScript));
    await NodeFSP.writeFile(peerScript, `#!/bin/sh\nprintf '%s\\n' '${cliMarker}'\n`, {
      mode: 0o700,
    });
    await writeClaudeMod({
      directory,
      socketPath: socket,
      peerScript,
    });
    const environment: Record<string, string | undefined> = {};
    // Clear inherited provider credentials/selectors by name, without reading their values.
    for (const key of Object.keys(process.env)) {
      if (
        /^(ANTHROPIC_|CLAUDE_CODE_(OAUTH|USE_)|CLAUDE_CODE_PLUGIN_DIRS$|PEER_CLAUDE_MOD_DIR$)/.test(
          key,
        )
      )
        environment[key] = undefined;
    }
    Object.assign(environment, {
      CLAUDE_CONFIG_DIR: NodePath.join(root, "config"),
      ANTHROPIC_API_KEY: "peer-local-test-dummy",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      CLAUDE_CODE_USE_BEDROCK: "0",
      CLAUDE_CODE_USE_VERTEX: "0",
      CLAUDE_CODE_USE_FOUNDRY: "0",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      ALL_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      all_proxy: undefined,
      NO_PROXY: "127.0.0.1,localhost",
      NODE_USE_ENV_PROXY: "0",
      PEER_COORDINATION: "on",
    });
    let success = false;
    const messages = query({
      prompt: "Complete this deterministic local transport test.",
      options: {
        cwd: root,
        pathToClaudeCodeExecutable: executablePath,
        plugins: [{ type: "local", path: directory }],
        env: environment,
        settingSources: [],
        mcpServers: {},
        extraArgs: { "strict-mcp-config": null },
        tools: planMode ? ["Bash", "ExitPlanMode"] : ["Bash"],
        allowedTools: planMode ? [] : ["Bash"],
        systemPrompt: "Local integration test.",
        model: "claude-sonnet-4-6",
        maxTurns: 2,
        persistSession: false,
        permissionMode: planMode ? "plan" : "dontAsk",
        // Leaving plan mode asks the person, however the rules are set: the host is the person.
        ...(planMode
          ? {
              canUseTool: async (tool: string, input: Record<string, unknown>) =>
                tool === "ExitPlanMode"
                  ? { behavior: "allow" as const, updatedInput: input }
                  : { behavior: "deny" as const, message: "Only ExitPlanMode is expected." },
            }
          : {}),
        abortController: controller,
        stderr: (text) => stderr.push(text),
      },
    });
    try {
      for await (const message of messages) {
        if (message.type === "result") success = message.subtype === "success" && !message.is_error;
      }
    } catch (error) {
      throw new Error(
        `Physical SDK query failed: ${String(error)}; ${JSON.stringify({ hooks, providerCalls: providerInputs.length, usage: usage.length, receipts: receipts.length })}\n${stderr.join("").slice(-3000)}`,
        { cause: error },
      );
    }
    if (startCredentials.length === 0)
      throw new Error(
        `No SessionStart credential was observed: ${JSON.stringify({ success, hooks, usage: usage.length, receipts: receipts.length })}\n${stderr.join("").slice(-3000)}`,
      );
    const inputVerified = ["SessionStart", "UserPromptSubmit"].every((event) =>
      providerInputs.some((body) => body.includes(`${note} ${event}`)),
    );
    const cliAvailable = providerInputs.some((body) => body.includes(cliMarker));
    // What the Mod's PostToolUse sent for the call: its fields are what the broker's plugins read.
    const fields = (value: unknown) =>
      typeof value === "object" && value !== null ? Object.keys(value).sort() : typeof value;
    const sent = postTools.map((body) => ({
      tool_name: body.tool_name,
      tool: body.tool,
      keys: Object.keys(body).sort(),
      input: fields(body.tool_input),
      response: fields(body.tool_response),
    }));
    const exitPlan = sent.find((body) => body.tool_name === "ExitPlanMode");
    if (
      !success ||
      hooks.length === 0 ||
      !inputVerified ||
      (planMode ? exitPlan === undefined : !cliAvailable) ||
      usage.length === 0 ||
      !["SessionStart", "UserPromptSubmit"].every((event) =>
        receipts.some(
          (receipt) => receipt.id === `smoke-${event}` && receipt.evidence === "model-input",
        ),
      )
    ) {
      throw new Error(
        `Physical Mod smoke incomplete: ${JSON.stringify({ success, hooks, providerCalls: providerInputs.length, inputVerified, cliAvailable, usage: usage.length, receipts: receipts.length, postTools: sent })}\n${stderr.join("").slice(-3000)}`,
      );
    }
    return {
      hooks,
      providerCalls: providerInputs.length,
      inputVerified,
      cliAvailable,
      usage: usage.length,
      receipts: receipts.map((receipt) => ({ id: receipt.id, evidence: receipt.evidence })),
      ...(planMode ? { postTools: sent } : {}),
    };
  } finally {
    NodeTimers.clearTimeout(timer);
    controller.abort();
    await Promise.all([close(broker), close(provider)]);
    await NodeFSP.rm(root, { recursive: true, force: true });
    await NodeFSP.rm(socket, { force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  NodeURL.fileURLToPath(import.meta.url) === NodePath.resolve(process.argv[1])
) {
  try {
    // `--plan-mode`: the provider's call is ExitPlanMode in plan mode, not the `peer` probe in Bash.
    console.log(
      JSON.stringify(
        await smokeClaudeMod(
          process.env.CLAUDE_BIN || "claude",
          process.argv.includes("--plan-mode") ? "plan-mode" : "bash",
        ),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
