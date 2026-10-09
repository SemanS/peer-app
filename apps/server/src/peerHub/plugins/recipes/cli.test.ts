// @effect-diagnostics nodeBuiltinImport:off - check fixed MCP mappings against published tool definitions.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { makeRecipes } from "./RecipeService.ts";
import { recipeTable } from "./recipeTable.generated.ts";
import { recipeCommand } from "./cli.ts";
import { recipeMcp } from "./mcp.ts";
import { renderRecipe, MCP_MAPPING } from "./catalog.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
it.effect(
  "reads without Hub or session, refuses unavailable input and preserves exact MCP text",
  () =>
    Effect.gen(function* () {
      let on = true,
        requests = true;
      const service = {
        ...makeRecipes({
          available: Effect.sync(() => ({
            enabled: on,
            recipes: on
              ? recipeTable.filter((r) => requests || !r.requires.includes("requests"))
              : [],
          })),
          localAgent: () => Effect.succeed(null),
          prompt: () => Effect.void,
          threadSend: () => Effect.succeed({ delivery: "queued" }),
        }),
        bindThreads: () => undefined,
      };
      const source = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(import.meta.dirname, "..", "mcp", "tools.ts"), "utf8"),
      );
      const tools = new Set(
        [...source.matchAll(/\[\s*"([a-z-]+)",/g)].map((match) => `peer_${match[1]}`),
      );
      for (const name of MCP_MAPPING.match(/peer_(?:status|context)/g) ?? [])
        expect(tools.has(name)).toBe(true);
      const command = recipeCommand(service);
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() =>
          brokerFixture(() => ({
            placeOf: async () => {
              throw new Error("no lookup");
            },
            plugins: async () => ({
              ...NO_PLUGINS,
              commands: [
                { plugin: "recipes", command, ...(on ? {} : { refused: "off" as const }) },
              ],
            }),
          })),
        ),
        (f) => Effect.promise(() => f.dispose()),
      );
      expect(yield* Effect.promise(() => fixture.broker.runCli("recipe", [], {}))).toContain(
        "catch-up  Catch me up  (reads only)",
      );
      for (const row of recipeTable) {
        const cli = yield* Effect.promise(() =>
          fixture.broker.runCli("recipe", [row.name, "$& {{input}}"], {}),
        );
        expect(cli).toBe(renderRecipe(row, "$& {{input}}"));
        const mcp = recipeMcp(service);
        const prompt = yield* mcp.agentPrompts!.get({} as PeerSessionView, row.name, {
          input: "$& {{input}}",
        });
        expect(prompt.text).toBe(cli + "\n\n" + MCP_MAPPING);
        expect(
          yield* Effect.promise(() =>
            fixture.broker.runCli(
              "recipe",
              mcp.agentTools![0]!.arguments({ name: row.name, input: "$& {{input}}" }),
              {},
              undefined,
              true,
            ),
          ),
        ).toBe(prompt.text);
      }
      yield* Effect.promise(() =>
        expect(fixture.broker.runCli("recipe", ["missing"], {})).rejects.toMatchObject({
          outcome: "usage",
        }),
      );
      yield* Effect.promise(() =>
        expect(
          fixture.broker.runCli("recipe", ["catch-up", "x".repeat(4001)], {}),
        ).rejects.toMatchObject({ outcome: "usage" }),
      );
      requests = false;
      yield* Effect.promise(() =>
        expect(fixture.broker.runCli("recipe", ["handoff"], {})).rejects.toMatchObject({
          outcome: "usage",
        }),
      );
      expect(
        (yield* recipeMcp(service).agentPrompts!.list({} as PeerSessionView)).map((r) => r.name),
      ).not.toContain("handoff");
      on = false;
      yield* Effect.promise(() =>
        expect(fixture.broker.runCli("recipe", [], {})).rejects.toMatchObject({
          outcome: "refused",
        }),
      );
      expect(yield* recipeMcp(service).agentPrompts!.list({} as PeerSessionView)).toEqual([]);
    }).pipe(Effect.scoped),
);
