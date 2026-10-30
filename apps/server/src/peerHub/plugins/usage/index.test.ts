import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerHubError, UsageRpcGroup, type PeerUsageReportInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as RpcTest from "effect/rpc/RpcTest";
import * as PeerHub from "../../PeerHub.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import {
  coreLayer,
  coreRpcStandIns,
  seedState,
  signedInSeed,
  standInHub,
} from "../../core/testkit.ts";
import { UsagePlugin } from "./index.ts";
import { PeerUsageService, layer } from "./service.ts";

const wrap: PeerRpcWrap = {
  effect: (_method, effect) => effect,
  stream: (_method, stream) => stream,
};

const overview = {
  workspace: "acme",
  days: 7,
  from: "2026-10-24",
  to: "2026-10-30",
  project: "pay",
  scope: "self",
  tickets: null,
  implementations: { runs: 1, agents: 1, seconds: 60 },
  apiSpend: { usd: null, gateway: null },
  tokenValue: null,
  code: null,
  tokens: null,
  byAgent: [{ agent: "claude", runs: 1, usd: null, tokens: null }],
  byUser: [
    {
      email: "ana@acme.test",
      name: "Ana",
      runs: 1,
      usd: null,
      tokens: null,
      sharing: false,
      former: false,
    },
  ],
  coverage: { members: 1, sharing: 0, latestReportAt: null },
};

const report: PeerUsageReportInput = {
  workspace: "acme",
  project: "pay/web",
  day: "2026-10-30",
  environment: "ana-laptop",
  rev: 1793000000000,
  rows: [
    {
      agent: "claude",
      model: "claude-opus-5-5",
      capacity: "personal",
      input: 1,
      output: 2,
      cached: 3,
      usd: null,
      sessions: 1,
    },
  ],
};

const refusal = (code: string, message = code) => ({ error: { code, message } });

/** Core with the plugin's RPC methods on a stand-in Hub that `answer` speaks for. */
const rpcClient = (answer: Parameters<typeof standInHub>[0]) =>
  Effect.gen(function* () {
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "s", plugins: [UsagePlugin] }),
    );
    const plugins = yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      return yield* PeerPlugins.PeerPlugins;
    }).pipe(Effect.provide(core));
    const client = yield* RpcTest.makeClient(UsageRpcGroup).pipe(
      Effect.provide(
        PeerHub.rpcLayer(wrap).pipe(
          Layer.provide(
            Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
          ),
        ),
      ),
    );
    return { client, hub, plugins };
  });

/** The plugin's service on a stand-in Hub, for what the Hub's answers mean to the reporter. */
const usageService = (answer: Parameters<typeof standInHub>[0]) =>
  Effect.gen(function* () {
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "s" }),
    );
    const usage = yield* PeerUsageService.pipe(Effect.provide(layer), Effect.provide(core));
    return { usage, hub };
  });

describe("Usage through core", () => {
  it.effect("reaches the Hub's paths and refuses while the plugin is off", () =>
    Effect.gen(function* () {
      const { client, hub, plugins } = yield* rpcClient({
        current: (path, method) =>
          path.startsWith("/v1/workspaces/acme/usage/overview")
            ? [200, overview]
            : path === "/v1/workspaces/acme/usage/sharing" && method === "PUT"
              ? [200, { sharing: false, at: null, removed: 3 }]
              : path === "/v1/workspaces/acme/usage/sharing"
                ? [200, { sharing: true, at: "2026-10-30T12:00:00Z" }]
                : [200, {}],
      });

      const read = yield* client["peer.usage.overview"]({
        workspace: "acme",
        days: 7,
        project: "pay",
      });
      assert.deepStrictEqual(read, overview as typeof read);
      yield* client["peer.usage.overview"]({ workspace: "acme", days: 30 });
      assert.deepStrictEqual(yield* client["peer.usage.sharing"]({ workspace: "acme" }), {
        sharing: true,
        at: "2026-10-30T12:00:00Z",
      });
      assert.deepStrictEqual(
        yield* client["peer.usage.setSharing"]({ workspace: "acme", sharing: false }),
        { sharing: false, at: null, removed: 3 },
      );

      const usageCalls = hub.calls.filter((call) => call.url?.includes("/usage"));
      assert.deepStrictEqual(
        usageCalls.map((call) => `${call.method} ${call.url}`),
        [
          "GET /v1/workspaces/acme/usage/overview?days=7&project=pay",
          "GET /v1/workspaces/acme/usage/overview?days=30",
          "GET /v1/workspaces/acme/usage/sharing",
          "PUT /v1/workspaces/acme/usage/sharing",
        ],
      );
      assert.deepStrictEqual(JSON.parse(usageCalls[3]?.body ?? ""), { sharing: false });

      yield* plugins.setPlugin({ id: "usage", enabled: false });
      const count = hub.calls.length;
      const refused = yield* client["peer.usage.sharing"]({ workspace: "acme" }).pipe(
        Effect.result,
      );
      assert.isTrue(Result.isFailure(refused));
      assert.strictEqual(hub.calls.length, count);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("answers unsupported for a Hub without the feature, however it says so", () =>
    Effect.gen(function* () {
      let answer: readonly [number, unknown] = [404, {}];
      const { client } = yield* rpcClient({
        current: (path) => (path.includes("/usage") ? answer : [200, {}]),
      });
      for (const older of [
        [404, {}],
        [404, refusal("not_found", "no such route")],
        [405, {}],
      ] as const) {
        answer = older;
        const unsupported = { unsupported: true } as const;
        assert.deepStrictEqual(
          yield* client["peer.usage.overview"]({ workspace: "acme", days: 30 }),
          unsupported,
        );
        assert.deepStrictEqual(
          yield* client["peer.usage.sharing"]({ workspace: "acme" }),
          unsupported,
        );
        assert.deepStrictEqual(
          yield* client["peer.usage.setSharing"]({ workspace: "acme", sharing: true }),
          unsupported,
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the Hub's own 404 an error, so a refusal never reads as an older Hub", () =>
    Effect.gen(function* () {
      const { client } = yield* rpcClient({
        current: (path) =>
          path.includes("/usage") ? [404, refusal("not_found", "no such project")] : [200, {}],
      });
      const refused = yield* client["peer.usage.overview"]({
        workspace: "acme",
        days: 7,
        project: "other",
      }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused));
      if (Result.isFailure(refused)) {
        assert.instanceOf(refused.failure, PeerHubError);
        assert.strictEqual((refused.failure as PeerHubError).status, 404);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("the reporter's seam", () => {
  it.effect("wakes the reporter for the workspace that turned sharing on, and for no other", () =>
    Effect.gen(function* () {
      const { usage, hub } = yield* usageService({
        current: (path) =>
          path.startsWith("/v1/workspaces/older/")
            ? [404, {}]
            : path.startsWith("/v1/workspaces/quiet/")
              ? [200, { sharing: false, at: null, removed: 0 }]
              : [200, { sharing: true, at: "2026-10-30T12:00:00Z" }],
      });
      yield* usage.setSharing({ workspace: "older", sharing: true });
      yield* usage.setSharing({ workspace: "quiet", sharing: false });
      yield* usage.setSharing({ workspace: "acme", sharing: true });
      // The first wake is acme's: neither the older Hub's answer nor turning off queued one.
      assert.strictEqual(yield* usage.sharingTurnedOn, "acme");
      assert.strictEqual(hub.calls.filter((call) => call.method === "PUT").length, 3);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("a report", () => {
  it.effect("sends only the Hub's fields, to the project and day", () =>
    Effect.gen(function* () {
      const { usage, hub } = yield* usageService({ current: () => [200, { stored: true }] });
      assert.strictEqual(yield* usage.report(report), "stored");
      const sent = hub.calls.find((call) => call.method === "PUT");
      assert.strictEqual(sent?.url, "/v1/workspaces/acme/usage/reports/pay%2Fweb/2026-10-30");
      assert.deepStrictEqual(JSON.parse(sent?.body ?? ""), {
        environment: report.environment,
        rev: report.rev,
        rows: report.rows,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("names what the reporter must tell apart, and fails on anything else", () =>
    Effect.gen(function* () {
      let answer: readonly [number, unknown] = [200, { stored: false }];
      const { usage } = yield* usageService({ current: () => answer });
      assert.strictEqual(yield* usage.report({ ...report, rows: [] }), "stored");
      answer = [409, refusal("stale_rollup")];
      assert.strictEqual(yield* usage.report(report), "stale");
      answer = [403, refusal("usage_not_shared")];
      assert.strictEqual(yield* usage.report(report), "not-shared");
      answer = [404, {}];
      assert.strictEqual(yield* usage.report(report), "unsupported");
      for (const refused of [
        [404, refusal("not_found", "no such project")],
        [403, refusal("forbidden")],
        [400, refusal("invalid_request")],
        [409, refusal("conflict")],
      ] as const) {
        answer = refused;
        const failed = yield* usage.report(report).pipe(Effect.result);
        assert.isTrue(Result.isFailure(failed));
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
