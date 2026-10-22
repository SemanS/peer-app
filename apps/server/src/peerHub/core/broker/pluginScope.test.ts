import { expect, it } from "vite-plus/test";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { NO_PLUGINS, type PeerBrokerPlugins } from "./host.ts";
import { pluginsForWorkspace } from "./pluginScope.ts";

it("does not invoke Hub hooks or reports for a local project on a signed-in environment", () => {
  const plugins: PeerBrokerPlugins = {
    ...NO_PLUGINS,
    active: [
      { id: "requests", title: "Team requests", requiresHub: true, contributions: {} },
      { id: "metrics", title: "Local metrics", contributions: {} },
    ],
    commands: [
      {
        plugin: "requests",
        command: {
          name: "ask",
          usage: "ask",
          summary: "Ask a teammate",
          run: () => Effect.succeed("sent"),
        },
      },
    ],
    reportSessions: [
      { plugin: "requests", add: (_workspace, sessions) => Effect.succeed(sessions) },
    ],
  };
  const local = pluginsForWorkspace(plugins, PEER_LOCAL_WORKSPACE);
  expect(local.active.map((p) => p.id)).toEqual(["metrics"]);
  expect(local.commands[0]?.refused).toBe("hub");
  expect(local.reportSessions).toEqual([]);
  expect(pluginsForWorkspace(plugins, "team")).toBe(plugins);
});
