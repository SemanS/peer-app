import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpPlugin } from "../../plugins/mcp/index.ts";
import { RecipesPlugin } from "../../plugins/recipes/index.ts";
import { bindPlugin } from "../plugin.ts";
import { brokerFixture, pluginsOf } from "../broker/testkit.ts";
import { coreLayer } from "../testkit.ts";
import { PeerAgents } from "../coordination/PeerAgents.ts";
import { PeerPlugins, startPlugins } from "./PeerPlugins.ts";
it.effect(
  "announces actual recipe prompt availability changes and removes the recipe tool when disabled",
  () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() =>
          brokerFixture((host) => ({
            threadAgent: async () => ({
              agent: "cursor",
              nativeId: "native",
              cwd: host.scriptsDir.replace(/\/scripts$/, ""),
            }),
          })),
        ),
        (f) => Effect.promise(f.dispose),
      );
      const announcement = bindPlugin({
        id: "announcements",
        title: "Announcements",
        summary: "Availability only",
        defaultEnabled: true,
        layer: Layer.empty,
        make: Effect.succeed({}),
      });
      const core = yield* Layer.build(
        coreLayer(fixture.root, { plugins: [McpPlugin, RecipesPlugin, announcement] }),
      );
      yield* Effect.gen(function* () {
        yield* startPlugins;
        const plugins = yield* PeerPlugins;
        Object.assign(fixture.broker.host, pluginsOf(plugins));
        yield* (yield* PeerAgents).attach(fixture.broker);
        const command = (yield* plugins.contributions)
          .flatMap((p) => p.commands ?? [])
          .find((c) => c.name === "mcp")!;
        const headers = { "x-peer-mcp": "recipes-proof", "x-peer-thread": "thread" };
        const call = (id: number, method: string) =>
          command.stdio!({ headers, line: JSON.stringify({ jsonrpc: "2.0", id, method }) }).pipe(
            Effect.map((s) => s.split("\n").map((line) => JSON.parse(line))),
          );
        const first = yield* call(1, "prompts/list");
        expect(first.at(-1).result.prompts.map((p: { name: string }) => p.name)).toContain(
          "announce",
        );
        yield* plugins.setPlugin({ id: "announcements", enabled: false });
        const next = yield* call(2, "prompts/list");
        expect(next[0].method).toBe("notifications/prompts/list_changed");
        expect(next.at(-1).result.prompts.map((p: { name: string }) => p.name)).not.toContain(
          "announce",
        );
        yield* plugins.setPlugin({ id: "recipes", enabled: false });
        const off = yield* call(3, "tools/list");
        expect(off[0].method).toBe("notifications/prompts/list_changed");
        expect(off.at(-1).result.tools.map((p: { name: string }) => p.name)).not.toContain(
          "peer_recipe",
        );
        yield* plugins.setPlugin({ id: "recipes", enabled: true });
        const on = yield* call(4, "prompts/list");
        expect(on[0].method).toBe("notifications/prompts/list_changed");
        expect(on.at(-1).result.prompts.map((p: { name: string }) => p.name)).toContain("catch-up");
      }).pipe(Effect.provideContext(core));
    }).pipe(Effect.provide(NodeServices.layer)),
);
