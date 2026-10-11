// @effect-diagnostics nodeBuiltinImport:off - the file an agent edits, in a broker fixture's checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { McpPlugin } from "../../plugins/mcp/index.ts";
import { SettingsPlugin } from "../../plugins/settings/index.ts";
import { PeerAgents } from "../coordination/PeerAgents.ts";
import { PeerHubClient } from "../hub/PeerHubClient.ts";
import { brokerFixture, pluginsOf } from "../broker/testkit.ts";
import { PeerStatus } from "../status/PeerStatus.ts";
import { coreLayer, meAnswer, seedState, signedInSeed, standInHub } from "../testkit.ts";
import { PeerPlugins, startPlugins } from "./PeerPlugins.ts";

const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const WS = "/v1/workspaces/acme";
const eva = { email: "eva@acme.dev", name: "Eva" };
const project = {
  name: "App",
  members: ["*"],
  leads: ["ana@acme.test"],
  repositories: [],
  tools: [],
  knowledge: { kontext: true, company: true },
  capacity: { personal: "any" },
  coordination: { policy: "notify" },
};
const proposal = {
  id: "p_1",
  by: eva,
  via: { kind: "agent", agent: "cursor" },
  at: "2026-10-11T12:00:00Z",
  base: 42,
  message: "Over MCP",
  instruction: null,
  lines: [],
  scopes: ["project:app"],
  owners: "App's leads and admins",
  state: "pending",
  decidedBy: null,
  decidedAt: null,
  reason: null,
  revision: null,
  mine: true,
  canDecide: false,
};

interface Reply {
  readonly result: {
    readonly tools: ReadonlyArray<{ readonly name: string }>;
    readonly isError?: boolean;
    readonly content: ReadonlyArray<{ readonly text: string }>;
  };
}

it.effect("serves peer config to an agent without a shell, through the active plugin", () =>
  Effect.gen(function* () {
    const hub = yield* standInHub({
      current: (url) =>
        url === "/v1/me"
          ? [200, meAnswer({ settings: 1 })]
          : url === `${WS}/settings`
            ? [
                200,
                {
                  revision: { seq: 42, commit: "3f2a", at: "x", by: eva, message: "Start" },
                  rights: { admin: false, owner: false, leads: ["app"] },
                  document: { projects: { app: project } },
                  features: { pathRules: true, webhooks: true, github: true },
                  people: [],
                },
              ]
            : url === `${WS}/settings/proposals`
              ? [201, proposal]
              : [200, { proposals: [] }],
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: [McpPlugin, SettingsPlugin],
      }),
    );
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
    yield* Effect.gen(function* () {
      yield* (yield* PeerStatus).coordinationFrom(() =>
        Effect.succeed({
          enabled: false,
          policy: "coordinate",
          claudeHooks: false,
          logPath: "/tmp/settings-mcp",
          sessions: [],
          overlaps: [],
          findings: [],
          contexts: [],
          candidates: [],
        }),
      );
      yield* (yield* PeerHubClient).me;
      yield* startPlugins;
      const plugins = yield* PeerPlugins;
      Object.assign(fixture.broker.host, pluginsOf(plugins));
      yield* (yield* PeerAgents).attach(fixture.broker);
      const command = (yield* plugins.contributions)
        .flatMap((plugin) => plugin.commands ?? [])
        .find((candidate) => candidate.name === "mcp")!;
      const headers = { "x-peer-mcp": "settings-proof", "x-peer-thread": "thread" };
      const call = (id: number, method: string, params?: Record<string, unknown>) =>
        command.stdio!({ headers, line: json({ jsonrpc: "2.0", id, method, params }) }).pipe(
          Effect.map((text) => parseJson(text.split("\n").at(-1)!) as Reply),
        );
      const tools = (id: number) =>
        call(id, "tools/list").pipe(Effect.map((reply) => reply.result.tools.map((t) => t.name)));

      assert.includeMembers(yield* tools(1), ["peer_config_show", "peer_config_propose"]);
      const shown = (yield* call(2, "tools/call", { name: "peer_config_show", arguments: {} }))
        .result;
      assert.notStrictEqual(shown.isError, true);
      assert.include(
        shown.content[0]!.text,
        "# Peer settings · acme · revision 42 · scope project:app",
      );
      // The agent edits the file it was shown and proposes it; relative to its own directory.
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(fixture.root, "edited.yaml"),
          shown.content[0]!.text.replace("policy: notify", "policy: coordinate"),
        ),
      );
      const sent = (yield* call(3, "tools/call", {
        name: "peer_config_propose",
        arguments: { file: "edited.yaml", why: "Over MCP" },
      })).result;
      assert.notStrictEqual(sent.isError, true);
      assert.include(sent.content[0]!.text, "Proposal p_1");
      const posted = hub.calls.filter(
        (c) => c.method === "POST" && c.url === `${WS}/settings/proposals`,
      );
      assert.deepStrictEqual(parseJson(posted.at(-1)!.body), {
        base: 42,
        set: [
          {
            path: ["projects", "app"],
            value: { ...project, coordination: { policy: "coordinate" } },
          },
        ],
        message: "Over MCP",
        via: { kind: "agent", agent: "cursor" },
      });
      // A reason that is a flag is refused, and nothing more reaches the Hub.
      const refused = (yield* call(4, "tools/call", {
        name: "peer_config_propose",
        arguments: { file: "edited.yaml", why: "--file elsewhere" },
      })).result;
      assert.strictEqual(refused.isError, true);
      assert.strictEqual(
        hub.calls.filter((c) => c.method === "POST" && c.url === `${WS}/settings/proposals`).length,
        1,
      );
      // Turned off, the tools are gone.
      yield* plugins.setPlugin({ id: "settings", enabled: false });
      const left = yield* tools(5);
      assert.notInclude(left, "peer_config_show");
      assert.notInclude(left, "peer_config_propose");
    }).pipe(Effect.provideContext(core));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
