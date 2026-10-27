// @effect-diagnostics nodeBuiltinImport:off - the stable absolute command provider adapters receive.
import * as NodePath from "node:path";
import {
  McpRpcGroup,
  PEER_MCP_METHODS,
  type PeerHubError,
  type PeerMcpScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  bindPlugin,
  refused,
  usage,
  type PeerCommand,
  type PeerCommandInput,
  type PeerContributions,
} from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as ServerConfig from "../../../config.ts";
import { MCP_CLIENTS, mcpClient } from "./clients.ts";
import * as Connect from "./connect.ts";
import * as Sessions from "./sessions.ts";

const CLIENT_IDS = MCP_CLIENTS.map((client) => client.id).join(", ");

export const McpPlugin = bindPlugin({
  id: "mcp",
  title: "Coordination tools (MCP)",
  summary: "Peer's coordination tools for MCP clients. Claude Code and Codex use Peer hooks.",
  defaultEnabled: true,
  layer: Layer.merge(Sessions.layer, Connect.layer),
  make: Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    const state = yield* PeerState.PeerState;
    const agents = yield* PeerAgents.PeerAgents;
    const config = yield* ServerConfig.ServerConfig;
    const clients = yield* Connect.McpClients;
    const methods = PEER_MCP_METHODS;
    const command = NodePath.join(config.stateDir, "coord", "bin", "peer");
    /** `peer connect|disconnect <client> [--scope user|project]`, from a project folder. */
    const editorCommand = (kind: "connect" | "disconnect"): PeerCommand => ({
      name: kind,
      usage: `${kind} <client> [--scope user|project]`,
      summary:
        kind === "connect"
          ? `give an editor Peer's tools over MCP (clients: ${CLIENT_IDS})`
          : "remove Peer's MCP entry from an editor's settings",
      public: true,
      run: (input: PeerCommandInput) =>
        Effect.gen(function* () {
          const id = input.plain[0];
          const client = id === undefined ? undefined : mcpClient(id);
          if (client === undefined)
            return yield* Effect.fail(
              usage(
                id === undefined ? "name the client" : `${id} is not a known client`,
                `run peer ${kind} <client>, one of: ${CLIENT_IDS}.`,
              ),
            );
          const flag = input.flag("--scope");
          if (flag !== undefined && flag !== "user" && flag !== "project")
            return yield* Effect.fail(
              usage("--scope is user or project", `run peer ${kind} ${client.id} --scope user.`),
            );
          const scope: PeerMcpScope =
            flag === "user" || flag === "project"
              ? flag
              : client.project !== undefined
                ? "project"
                : "user";
          const answer = yield* clients[kind]({
            client: client.id,
            scope,
            ...(scope === "project" ? { project: { root: input.session.root } } : {}),
          }).pipe(
            Effect.mapError((error: PeerHubError) =>
              refused(
                error.detail,
                `run peer ${kind} ${client.id} --scope user, or use the Peer app.`,
              ),
            ),
          );
          if (answer.outcome === "manual")
            return `${answer.path} is not plain JSON, so Peer left it alone. ${
              kind === "connect" ? "Add" : "Remove"
            } this entry by hand:\n${answer.entry}`;
          if (answer.outcome === "unchanged")
            return `${client.title} ${kind === "connect" ? "already has" : "has no"} Peer's MCP entry in ${answer.path}.`;
          return kind === "connect"
            ? `Connected ${client.title} in ${answer.path}. Reload ${client.title}; it gets the peer_* tools for the folder it opens while Peer runs.`
            : `Removed Peer's MCP entry from ${answer.path}.`;
        }),
    });
    return {
      rpc: {
        group: McpRpcGroup,
        handlers: (wrap) =>
          McpRpcGroup.of({
            [methods.peerMcpClients]: (input) =>
              wrap.effect(methods.peerMcpClients, clients.list(input.project)),
            [methods.peerMcpConnect]: (input) =>
              wrap.effect(methods.peerMcpConnect, clients.connect(input)),
            [methods.peerMcpDisconnect]: (input) =>
              wrap.effect(methods.peerMcpDisconnect, clients.disconnect(input)),
          }),
      },
      commands: [
        {
          name: "mcp",
          usage: "mcp",
          summary: "these commands as MCP tools over stdio, for agents without Peer hooks",
          waitSeconds: 30,
          stdio: ({ line, headers }) => sessions.message(line, headers),
          run: () => Effect.fail(refused("mcp requires stdio", "run peer mcp from an MCP client.")),
        },
        editorCommand("connect"),
        editorCommand("disconnect"),
      ],
      status: {
        read: Effect.gen(function* () {
          const live = yield* agents.sessions;
          const local = yield* agents.runtimeAgents;
          return {
            enabled: true,
            command: `${/^[\w./-]+$/.test(command) ? command : `'${command.replaceAll("'", "'\\''")}'`} mcp`,
            agents: local
              .filter((agent) =>
                live.some((session) => session.adapter === "mcp" && session.pane === agent.paneId),
              )
              .map((agent) => agent.id),
            clients: yield* clients.connected,
            sessions: live
              .filter((session) => session.adapter === "mcp")
              .map((session) => session.id),
          };
        }),
      },
      threadMcpServers: (thread, harness) => {
        if (
          !state.current().persisted.coordination?.enabled ||
          !["cursor", "grok", "opencode", "antigravity"].includes(harness)
        )
          return {};
        return {
          peer: {
            transport: "stdio",
            command,
            args: ["mcp"],
            env: { PEER_THREAD: thread, PEER_HARNESS: harness },
          },
        };
      },
      turnOff: sessions.end,
      workspaceCleanup: (event) =>
        sessions.forgetAbsent(
          event.kind === "signing-out"
            ? []
            : event.kind === "left-workspace"
              ? state
                  .current()
                  .persisted.workspaces.filter((w) => w.slug !== event.workspace)
                  .map((w) => w.slug)
              : event.workspaces.map((w) => w.slug),
        ),
    } satisfies PeerContributions;
  }),
});
