// @effect-diagnostics nodeBuiltinImport:off globalDate:off - local HTTP headers and the broker's wall-clock delivery deadline.
/* oxlint-disable oxc/no-this-in-exported-function -- Broker methods. */
import { PeerHarness, PeerLocalAgent } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { CoordinationBroker } from "./Broker.ts";
import { CliError, refused, render, uncertain } from "./cliContract.ts";
import type { PeerToolBinding } from "../plugin.ts";
import {
  handlers,
  notifyDeliveries,
  type PreparedDelivery,
  startBlocks,
  stepNotices,
  withPluginText,
} from "./pipeline.ts";

const runtimeAgents = Schema.Struct({ list: Schema.Array(PeerLocalAgent) });

/** Read the runtime's published list; no filesystem or directory heuristic can name an agent. */
export async function localRuntimeAgents(this: CoordinationBroker) {
  const plugin = (await this.plugins()).active.find(
    (entry) => entry.contributions.runtime !== undefined,
  );
  const read = plugin?.contributions.status?.read;
  if (read === undefined) return [];
  const decoded = Schema.decodeUnknownOption(runtimeAgents)(await this.host.run(read));
  return decoded._tag === "Some" ? decoded.value.list : [];
}

const isHarness = Schema.is(PeerHarness);
/** Words in an MCP client's name that say which agent it is, checked in this order. */
const CLIENT_AGENTS: ReadonlyArray<readonly [string, string]> = [
  ["cursor", "cursor"],
  ["windsurf", "windsurf"],
  ["gemini", "gemini"],
  ["zed", "zed"],
  ["opencode", "opencode"],
  ["kiro", "kiro"],
  ["claude", "claude"],
  ["codex", "codex"],
  ["copilot", "vscode"],
  ["vscode", "vscode"],
  ["code", "vscode"],
];

/**
 * The agent name of an MCP client Peer did not start: its `PEER_HARNESS` when Peer knows it, else
 * the agent its `clientInfo.name` names, else that name as `[a-z0-9-]`, else `mcp`.
 */
export function clientAgent(input: Pick<PeerToolBinding, "harness" | "client">): string {
  if (input.harness !== undefined && isHarness(input.harness)) return input.harness;
  const name = (input.client ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return CLIENT_AGENTS.find(([word]) => name.includes(word))?.[1] ?? (name || "mcp");
}

/**
 * Binds a tool caller to a session, in this order: its hook session and token, its Peer thread,
 * its herdr pane, or else the folder it runs in. The last is how any MCP client Peer did not start
 * (an editor, a CLI agent) coordinates: its conversation id is its native session id.
 */
export async function bindTools(this: CoordinationBroker, input: PeerToolBinding) {
  if (input.session !== undefined)
    return this.sessionView(
      await this.callerOf({
        "x-peer-session": input.session,
        "x-peer-session-token": input.token,
        "x-peer-cwd": input.cwd,
      }),
    );
  let agent: string;
  let native: string;
  let cwd: string;
  let thread: string | undefined;
  let runtimeKey: string | undefined;
  if (input.thread !== undefined) {
    thread = input.thread.startsWith("peer:") ? input.thread : `peer:${input.thread}`;
    const runtime = await this.host.threadAgent?.(thread);
    if (runtime === null || runtime === undefined || runtime.nativeId === undefined)
      throw refused(
        "this Peer thread is still registering its agent",
        "call the tool again after the provider starts.",
      );
    agent = runtime.agent;
    native = runtime.nativeId;
    cwd = runtime.cwd;
  } else if (input.pane === undefined) {
    if (input.cwd === undefined)
      throw refused(
        "Peer cannot tell which folder this MCP client runs in",
        "start the MCP server from the project folder, or set PEER_CWD.",
      );
    agent = clientAgent(input);
    native = input.server;
    cwd = input.cwd;
  } else {
    const runtime = (await this.localRuntimeAgents()).find((agent) => agent.paneId === input.pane);
    if (runtime === undefined || runtime.cwd === undefined)
      throw refused(
        "Peer cannot tell which agent is calling these tools",
        "run the agent in herdr or a Peer thread and let the MCP client pass HERDR_PANE_ID to peer mcp.",
      );
    agent = runtime.agent ?? "unknown";
    runtimeKey = runtime.id;
    cwd = runtime.cwd;
    const prefix = `herdr:${agent}:`;
    native = runtime.id.startsWith(prefix)
      ? runtime.id.slice(prefix.length)
      : `mcp-${runtime.id.replace(/^herdr:/, "")}`;
  }
  const id = `${agent}:${native}`;
  if (input.thread === undefined && input.pane !== undefined)
    for (const previous of Array.from(this.sessions.values()))
      if (previous.adapter === "mcp" && previous.pane === input.pane && previous.id !== id)
        await this.endTools(previous.id);
  let creating = this.creatingSessions.get(id);
  if (creating === undefined) {
    creating = this.createSession(
      agent,
      { session_id: native, cwd },
      input.pane,
      "mcp",
      thread,
    ).finally(() => this.creatingSessions.delete(id));
    this.creatingSessions.set(id, creating);
  }
  const session = await creating;
  if (session === null)
    throw refused(
      "this agent's directory belongs to no workspace project",
      input.thread === undefined && input.pane === undefined
        ? "run the agent in a checkout of a workspace project, or share the folder with peer_share."
        : "run the agent in a checkout of a workspace project.",
    );
  if (runtimeKey !== undefined) {
    session.runtimeKey = runtimeKey;
    session.task = this.taskFor(session, (await this.plugins()).runtime);
  }
  this.markDirty();
  return this.sessionView(session);
}

export async function callTools(
  this: CoordinationBroker,
  id: string,
  command: string,
  args: ReadonlyArray<string>,
  first: boolean,
) {
  const session = this.sessions.get(id);
  if (session === undefined)
    throw refused(
      "this agent session ended",
      "restart the MCP server from the current agent process.",
    );
  const plugins = await this.plugins();
  await this.readTeamLines(session);
  if (session.keeps) await this.saveShared(session);
  const deliveries: PreparedDelivery[] = [];
  const step = this.pipelineStep(session, plugins, Date.now() + 2500, deliveries);
  const blocks = first ? startBlocks(step, "startup") : Promise.resolve(null);
  const start = first
    ? (withPluginText(
        await this.startContextFor(session, "startup", plugins, true),
        await blocks,
      ) ?? "")
    : "";
  let text: string;
  let isError = false;
  try {
    if (
      (command === "review" || command === "done") &&
      session.keeps &&
      this.mirrorOf(session)?.unsent
    )
      throw refused(
        "the shared handoff context has not reached the Hub",
        "call peer_status to retry publishing it, then hand the task over.",
      );
    text = await this.runCli(command, args, { "x-peer-cwd": session.cwd }, session, true);
  } catch (failure) {
    text = render(failure instanceof CliError ? failure : uncertain(command));
    isError = true;
  }
  const notices = await stepNotices(
    this.pipelineStep(session, plugins, Date.now() + 2500, deliveries),
    this.toolContext(session, { tool_name: `peer_${command}`, tool_input: {} }, "post-tool", 2500),
  );
  const news = withPluginText(this.news(session, { plugins, deliveries }), notices) ?? "";
  const added = start.length + news.length;
  session.injected.set("mcp", (session.injected.get("mcp") ?? 0) + added);
  this.touch(session);
  const reply = [start, text, news].filter(Boolean).join("\n\n");
  await notifyDeliveries(deliveries, "offered", reply);
  this.record("mcp.call", { session: id, command, chars: added, isError });
  return { text: reply, isError };
}

export async function endTools(this: CoordinationBroker, id: string) {
  const session = this.sessions.get(id);
  if (session?.adapter !== "mcp") return;
  const step = this.pipelineStep(session, await this.plugins(), Date.now() + 2500);
  await handlers(step, "session-ending");
  for (const pending of session.pending.splice(0))
    if (typeof pending !== "string") await notifyDeliveries(pending.deliveries, "dropped");
  await this.readTeamLines(session);
  if (session.keeps) await this.saveShared(session);
  await this.release(session);
  this.sessions.delete(id);
  this.markDirty();
  await handlers(step, "session-end");
}
