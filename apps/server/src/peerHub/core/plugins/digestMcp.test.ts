// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - isolated private broker and a stand-in Hub.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DigestPlugin } from "../../plugins/digest/index.ts";
import { McpPlugin } from "../../plugins/mcp/index.ts";
import { PeerHubClient } from "../hub/PeerHubClient.ts";
import { PeerAgents } from "../coordination/PeerAgents.ts";
import { brokerFixture, pluginsOf } from "../broker/testkit.ts";
import { coreLayer, seedState, signedInSeed, standInHub, meAnswer } from "../testkit.ts";
import { PeerPlugins, startPlugins } from "./PeerPlugins.ts";
it.effect(
  "uses the actual active digest service through MCP with the same continued CLI window",
  () =>
    Effect.gen(function* () {
      const digest = {
        project: "app",
        since: "2026-10-09T00:00:00Z",
        until: "2026-10-09T08:00:00Z",
        coverage: { complete: true },
        sections: [
          {
            id: "tasks",
            title: "Tasks",
            total: 1,
            entries: [
              {
                kind: "task.closed",
                at: "2026-10-09T07:00:00Z",
                subject: "Task",
                by: ["ana@acme.test"],
              },
            ],
          },
        ],
      };
      const hub = yield* standInHub({
        current: (url) => [200, url === "/v1/me" ? meAnswer({ digest: 1 }) : digest],
      });
      const seed = JSON.parse(signedInSeed(hub.url));
      seed.workspaces[0].manifest = {
        version: 2,
        workspace: { slug: "acme", name: "Acme", currency: "EUR" },
        member: { email: "ana@acme.test", name: "Ana", role: "member" },
        knowledge: {},
        projects: [
          {
            id: "app",
            name: "App",
            role: "member",
            members: [{ email: "ana@acme.test", name: "Ana" }],
            repositories: [],
            knowledge: { kontext: false, company: false },
            tools: [],
            capacity: { personal: "any", personalHarnesses: [] },
            integrations: {},
          },
        ],
      };
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
      const core = yield* Layer.build(
        coreLayer(yield* seedState(JSON.stringify(seed)), {
          session: "phs_test",
          plugins: [McpPlugin, DigestPlugin],
        }),
      );
      yield* Effect.gen(function* () {
        yield* (yield* PeerHubClient).me;
        yield* startPlugins;
        const plugins = yield* PeerPlugins;
        Object.assign(fixture.broker.host, pluginsOf(plugins));
        yield* (yield* PeerAgents).attach(fixture.broker);
        const command = (yield* plugins.contributions)
          .flatMap((p) => p.commands ?? [])
          .find((c) => c.name === "mcp")!;
        const headers = { "x-peer-mcp": "digest-proof", "x-peer-thread": "thread" };
        const call = (id: number, method: string, params?: Record<string, unknown>) =>
          command.stdio!({
            headers,
            line: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          }).pipe(Effect.map((text) => JSON.parse(text.split("\n").at(-1)!)));
        expect(
          (yield* call(1, "tools/list")).result.tools.map((tool: { name: string }) => tool.name),
        ).toContain("peer_catchup");
        const first = yield* call(2, "tools/call", { name: "peer_catchup" });
        expect(first.result.isError).not.toBe(true);
        expect(first.result.content[0].text).toContain("Task closed by you");
        expect(hub.calls.at(-1)?.url).toContain("since=8h&limit=4");
        yield* call(3, "tools/call", { name: "peer_catchup" });
        expect(hub.calls.at(-1)?.url).toContain("since=2026-10-09T08%3A00%3A00Z&limit=4");
        const invalid = yield* call(4, "tools/call", {
          name: "peer_catchup",
          arguments: { since: "3w" },
        });
        expect(invalid.result.isError).toBe(true);
        yield* plugins.setPlugin({ id: "digest", enabled: false });
        expect(
          (yield* call(5, "tools/list")).result.tools.map((tool: { name: string }) => tool.name),
        ).not.toContain("peer_catchup");
      }).pipe(Effect.provideContext(core));
    }).pipe(Effect.provide(NodeServices.layer)),
);
