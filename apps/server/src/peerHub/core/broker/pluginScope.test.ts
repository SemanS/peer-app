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
      active: [{ id: "knowledge", title: "Knowledge", requiresHub: true, contributions: {} }],
      commands: [
        {
          plugin: "knowledge",
          command: {
            name: "knowledge",
            usage: "knowledge",
            summary: "Read team knowledge",
            public: true,
            run: () =>
              Effect.sync(() => {
                ran = true;
                return "Team knowledge";
              }),
          },
        },
      ],
    }),
  }));
  try {
    await expect(
      fixture.broker.runCli("knowledge", [], { "x-peer-cwd": fixture.root }),
    ).rejects.toMatchObject({ outcome: "refused" });
    expect(ran).toBe(false);
  } finally {
    await fixture.dispose();
  }
});

it("keeps Hub index contributions out of public local checkout reads", async () => {
  let read = false;
  const indexSource = {
    entries: () =>
      Effect.sync(() => {
        read = true;
        return [];
      }),
    section: () => "Team knowledge",
  };
  const fixture = await brokerFixture((host) => ({
    placeOf: async () => ({
      workspace: PEER_LOCAL_WORKSPACE,
      project: "app",
      root: host.scriptsDir,
    }),
    plugins: async () => ({
      ...NO_PLUGINS,
      active: [
        { id: "knowledge", title: "Knowledge", requiresHub: true, contributions: { indexSource } },
      ],
      indexSource,
    }),
  }));
  try {
    expect(await fixture.broker.runCli("index", [], { "x-peer-cwd": fixture.root })).not.toContain(
      "Team knowledge",
    );
    expect(read).toBe(false);
  } finally {
    await fixture.dispose();
  }
});
