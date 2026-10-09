import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";
import type { PeerCommand } from "../plugin.ts";
it("global plugin reads need neither caller nor checkout lookup and still honor disablement", async () => {
  let off = false;
  const command: PeerCommand = {
    name: "recipe",
    usage: "recipe [name]",
    summary: "recipes",
    globalRead: (args, { tools }) => Effect.succeed(args.join(" ") + (tools ? " MCP" : " CLI")),
    run: () => Effect.succeed("session only"),
  };
  const fixture = await brokerFixture(() => ({
    placeOf: async () => {
      throw new Error("Hub and checkout lookup must not run");
    },
    plugins: async () => ({
      ...NO_PLUGINS,
      commands: [{ plugin: "recipes", command, ...(off ? { refused: "off" as const } : {}) }],
    }),
  }));
  try {
    expect(await fixture.broker.runCli("recipe", ["catch-up", "$& {{input}}"], {})).toBe(
      "catch-up $& {{input}} CLI",
    );
    expect(await fixture.broker.runCli("recipe", ["catch-up"], {}, undefined, true)).toBe(
      "catch-up MCP",
    );
    off = true;
    await expect(fixture.broker.runCli("recipe", [], {})).rejects.toMatchObject({
      outcome: "refused",
    });
  } finally {
    await fixture.dispose();
  }
});
