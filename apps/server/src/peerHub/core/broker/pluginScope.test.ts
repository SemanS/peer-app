import { expect, it } from "vite-plus/test";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { NO_PLUGINS, type PeerBrokerPlugins } from "./host.ts";
import { pluginsForWorkspace } from "./pluginScope.ts";
import { brokerFixture } from "./testkit.ts";

it("does not invoke Hub hooks or reports for a local project on a signed-in environment", () => {
  const plugins: PeerBrokerPlugins = {
    ...NO_PLUGINS,
    active: [
      { id: "changes", title: "Changes", requiresHub: true, contributions: {} },
      { id: "audit", title: "Local audit", contributions: {} },
    ],
    commands: [
      {
        plugin: "changes",
        command: {
          name: "ask",
          usage: "ask",
          summary: "Ask a teammate",
          run: () => Effect.succeed("sent"),
        },
      },
    ],
    reportSessions: [
      { plugin: "changes", add: (_workspace, sessions) => Effect.succeed(sessions) },
    ],
  };
  const local = pluginsForWorkspace(plugins, PEER_LOCAL_WORKSPACE);
  expect(local.active.map((p) => p.id)).toEqual(["audit"]);
  expect(local.commands[0]?.refused).toBe("hub");
  expect(local.reportSessions).toEqual([]);
  expect(pluginsForWorkspace(plugins, "team")).toBe(plugins);
});

it("refuses a public Hub command from a local checkout before running it", async () => {
  let ran = false;
  const fixture = await brokerFixture((host) => ({
    placeOf: async () => ({
      workspace: PEER_LOCAL_WORKSPACE,
      project: "app",
      root: host.scriptsDir,
    }),
    plugins: async () => ({
      ...NO_PLUGINS,
      active: [{ id: "changes", title: "Changes", requiresHub: true, contributions: {} }],
      commands: [
        {
          plugin: "changes",
          command: {
            name: "changes",
            usage: "changes",
            summary: "Read the team's changes",
            public: true,
            run: () =>
              Effect.sync(() => {
                ran = true;
                return "Changes";
              }),
          },
        },
      ],
    }),
  }));
  try {
    await expect(
      fixture.broker.runCli("changes", [], { "x-peer-cwd": fixture.root }),
    ).rejects.toMatchObject({ outcome: "refused" });
    expect(ran).toBe(false);
  } finally {
    await fixture.dispose();
  }
});
