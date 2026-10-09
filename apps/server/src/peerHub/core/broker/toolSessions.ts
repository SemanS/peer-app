// @effect-diagnostics nodeBuiltinImport:off globalDate:off - local HTTP headers and the broker's wall-clock delivery deadline.
/* oxlint-disable oxc/no-this-in-exported-function -- Broker methods. */
import { PeerLocalAgent } from "@t3tools/contracts";
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

export async function bindTools(this: CoordinationBroker, input: PeerToolBinding) {
  if (input.session !== undefined)
    return this.sessionView(
      await this.callerOf({ "x-peer-session": input.session, "x-peer-session-token": input.token }),
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
      "run the agent in a checkout of a workspace project.",
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
    text = await this.runCli(command, args, { "x-peer-cwd": session.cwd }, session);
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
  this.log("mcp.call", { session: id, command, chars: added, isError });
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
