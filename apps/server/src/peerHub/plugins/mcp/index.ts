// @effect-diagnostics nodeBuiltinImport:off - the stable absolute command provider adapters receive.
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { bindPlugin, refused, type PeerContributions } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as ServerConfig from "../../../config.ts";
import * as Sessions from "./sessions.ts";

export const McpPlugin = bindPlugin({
  id: "mcp",
  title: "Coordination tools (MCP)",
  summary: "Advisory coordination tools for agents without Peer hooks.",
  defaultEnabled: true,
  layer: Sessions.layer,
  make: Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    const state = yield* PeerState.PeerState;
    const agents = yield* PeerAgents.PeerAgents;
    const config = yield* ServerConfig.ServerConfig;
    const command = NodePath.join(config.stateDir, "coord", "bin", "peer");
    return {
      commands: [
        {
          name: "mcp",
          usage: "mcp",
          summary: "these commands as MCP tools over stdio, for agents without Peer hooks",
          waitSeconds: 30,
          stdio: ({ line, headers }) => sessions.message(line, headers),
          run: () => Effect.fail(refused("mcp requires stdio", "run peer mcp from an MCP client.")),
        },
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
