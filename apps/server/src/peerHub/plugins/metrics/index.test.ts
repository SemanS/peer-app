// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - isolated plugin/broker test evidence.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeFSP from "node:fs/promises";
import { assert, it } from "@effect/vitest";
import { MetricsRpcGroup, PEER_METRICS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import * as PeerHub from "../../PeerHub.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerLog from "../../core/log/PeerLog.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import {
  coreLayer,
  coreRpcStandIns,
  paymentsSeed,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import { MetricsPlugin } from "./index.ts";
const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };
it.effect(
  "metrics are quiet for agents, inactive RPC is refused and no off-period event is folded",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-10-09T12:00:00Z"));
      const hub = yield* standInHub({
        current: (url) =>
          url === "/v1/me"
            ? [200, { email: "ana@acme.test", workspaces: [], joinable: [], features: {} }]
            : [200, { enabled: true, epoch: 1, retentionDays: 365 }],
      });
      const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsSeed(hub.url)), {
            session: "fake",
            plugins: [MetricsPlugin],
          }),
        ),
        plugins = yield* PeerPlugins.PeerPlugins.pipe(Effect.provide(core)),
        log = yield* PeerLog.PeerLog.pipe(Effect.provide(core));
      yield* (yield* PeerStatus.PeerStatus.pipe(Effect.provide(core))).coordinationFrom(() =>
        Effect.succeed({
          enabled: false,
          policy: "coordinate",
          claudeHooks: false,
          logPath: "",
          sessions: [],
          overlaps: [],
          findings: [],
          contexts: [],
          candidates: [],
        }),
      );
      const started = Promise.withResolvers<void>();
      let listener: ((r: import("../../core/metricsCatalog.ts").MetricRecord) => void) | undefined;
      const contribution = yield* MetricsPlugin.contributions.pipe(
        Effect.provideService(PeerLog.PeerLog, {
          ...log,
          subscribe: (f) => {
            listener = f;
            started.resolve();
            return log.subscribe(f);
          },
        }),
        Effect.provide(core),
      );
      assert.isUndefined(contribution.commands);
      assert.isUndefined(contribution.hooks);
      assert.isUndefined(contribution.hubChanges);
      assert.isUndefined(contribution.mcp);
      assert.isUndefined(contribution.agentTools);
      assert.isUndefined(contribution.agentPrompts);
      assert.isUndefined(MetricsPlugin.hubFeature);
      yield* plugins.attach(new Map([["metrics", contribution]]), []);
      yield* Effect.promise(() => started.promise);
      const rpc = yield* RpcTest.makeClient(MetricsRpcGroup).pipe(
        Effect.provide(
          PeerHub.rpcLayer(wrap).pipe(
            Layer.provide(
              Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
            ),
          ),
        ),
      );
      const input = {
        workspace: "acme",
        project: "pay",
        scope: "environment" as const,
        window: 28 as const,
      };
      const broker = yield* Effect.acquireRelease(
        Effect.promise(() => brokerFixture(() => pluginsOf(plugins))),
        (f) => Effect.promise(f.dispose),
      );
      const answers = () =>
        Effect.promise(async () => [
          await broker.broker.help(),
          await broker.broker["hook"](
            { session_id: "one", cwd: broker.root, hook_event_name: "SessionStart" },
            {},
          ),
          await broker.broker["hook"](
            {
              session_id: "one",
              cwd: broker.root,
              hook_event_name: "UserPromptSubmit",
              prompt: "Format prices",
            },
            {},
          ),
        ]);
      const on = yield* answers();
      listener!({
        event: "hook",
        t: "2026-10-09T12:00:00Z",
        workspace: "acme",
        project: "pay",
        adapter: "codex_hooks",
        chars: 80,
      });
      const after = yield* Effect.promise(() =>
        broker.broker["hook"](
          {
            session_id: "one",
            cwd: broker.root,
            hook_event_name: "UserPromptSubmit",
            prompt: "Format prices",
          },
          {},
        ),
      );
      assert.deepStrictEqual(after, on[2]);
      yield* plugins.setPlugin({ id: "metrics", enabled: false });
      assert.strictEqual(
        (yield* rpc[PEER_METRICS_METHODS.peerMetricsSummary](input).pipe(Effect.result))._tag,
        "Failure",
      );
      const off = yield* answers();
      assert.deepStrictEqual(off, on);
      log.record(
        "hook",
        { workspace: "acme", project: "pay", adapter: "codex_hooks", chars: 100 },
        { prompt: "SENTINEL-off-prompt" },
      );
      yield* Effect.promise(log.idle);
      assert.notInclude(
        yield* Effect.promise(() => NodeFSP.readFile(log.path, "utf8")),
        "SENTINEL",
      );
      yield* plugins.setPlugin({ id: "metrics", enabled: true });
      const summary = yield* rpc[PEER_METRICS_METHODS.peerMetricsSummary](input);
      assert.strictEqual(summary.current.counters["hook.events.codex_hooks"], 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
