import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import { makeRecipes } from "./RecipeService.ts";
import { recipeCommand } from "./cli.ts";
import { recipeMcp } from "./mcp.ts";
import { recipeTable } from "./recipeTable.generated.ts";
import { MCP_MAPPING } from "./catalog.ts";
it.effect("hands the same generated text to CLI, own herdr, own thread and MCP", () =>
  Effect.gen(function* () {
    let herdr = "",
      thread = "";
    const service = {
      ...makeRecipes({
        available: Effect.succeed({ enabled: true, recipes: recipeTable }),
        localAgent: () =>
          Effect.succeed({
            title: "Own",
            status: "working",
            coordinating: true,
            projectId: ProjectId.make("p"),
          }),
        prompt: (_id, text) =>
          Effect.sync(() => {
            herdr = text;
          }),
        threadSend: (input) =>
          Effect.sync(() => {
            thread = input.text;
            return { delivery: "queued" };
          }),
      }),
      bindThreads: () => undefined,
    };
    const command = recipeCommand(service);
    const fixture = yield* Effect.acquireRelease(
      Effect.promise(() =>
        brokerFixture(() => ({
          plugins: async () => ({ ...NO_PLUGINS, commands: [{ plugin: "recipes", command }] }),
        })),
      ),
      (f) => Effect.promise(f.dispose),
    );
    for (const recipe of recipeTable) {
      const input = "My $& {{input}} remains literal";
      const cli = yield* Effect.promise(() =>
        fixture.broker.runCli("recipe", [recipe.name, input], {}),
      );
      yield* service.send({
        target: { kind: "herdr", agentId: "own" },
        recipe: recipe.name,
        input,
        op: `herdr-${recipe.name}`,
      });
      yield* service.send({
        target: { kind: "thread", threadId: ThreadId.make("own") },
        recipe: recipe.name,
        input,
        op: `thread-${recipe.name}`,
      });
      const mcp = yield* recipeMcp(service).agentPrompts!.get({} as PeerSessionView, recipe.name, {
        input,
      });
      expect(herdr).toBe(cli);
      expect(thread).toBe(cli);
      expect(mcp.text).toBe(cli + "\n\n" + MCP_MAPPING);
    }
  }).pipe(Effect.scoped),
);
