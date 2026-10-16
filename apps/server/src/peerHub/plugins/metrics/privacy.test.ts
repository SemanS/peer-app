// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - isolated broker, fake Hub and exported privacy evidence.
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { MetricsRpcGroup, PEER_METRICS_METHODS, PeerMetricsRow } from "@t3tools/contracts";
import { taskRef } from "@t3tools/shared/peerRef";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as RpcTest from "effect/rpc/RpcTest";
import { metricsExport } from "../../../../../../packages/client-runtime/src/peer/metrics.ts";
import * as PeerHub from "../../PeerHub.ts";
import * as PeerLog from "../../core/log/PeerLog.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import {
  coreLayer,
  coreRpcStandIns,
  paymentsSeed,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import { createLocalStore } from "./client/localStore.ts";
import { MetricsPlugin } from "./index.ts";
const decodeRow = Schema.decodeUnknownEffect(PeerMetricsRow);
const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };
it.effect(
  "sentinel content stays only in debug detail through broker, rollups, upload, RPC and exports",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-10-09T12:00:00Z"));
      const sentinels = [
          "SENTINEL-prompt",
          "SENTINEL-path",
          "SENTINEL-note",
          "SENTINEL-args",
          "SENTINEL-output",
          "SENTINEL-error",
          "SENTINEL-title-1234",
        ],
        task = sentinels.at(-1)!,
        uploaded = Promise.withResolvers<void>();
      const hub = yield* standInHub({
        current: (url) => {
          if (url.includes("/days/")) uploaded.resolve();
          return url === "/v1/me"
            ? [
                200,
                { email: "ana@acme.test", workspaces: [], joinable: [], features: { metrics: 1 } },
              ]
            : url.endsWith("/metrics")
              ? [200, { enabled: true, epoch: 1, retentionDays: 365 }]
              : [200, {}];
        },
      });
      const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsSeed(hub.url)), {
            session: "fake",
            plugins: [MetricsPlugin],
          }),
        ),
        plugins = yield* PeerPlugins.PeerPlugins.pipe(Effect.provide(core)),
        state = yield* PeerState.PeerState.pipe(Effect.provide(core));
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
      const broker = yield* Effect.acquireRelease(
          Effect.promise(() =>
            brokerFixture((host) => ({
              ...pluginsOf(plugins),
              taskOf: () => task,
              placeOf: async () => ({ workspace: "acme", project: "pay", root: host.contextsDir }),
              note: async () => {
                throw Error(sentinels[5]);
              },
            })),
          ),
          (f) => Effect.promise(f.dispose),
        ),
        subscribed = Promise.withResolvers<void>();
      const work = yield* PeerWork.PeerWork.pipe(Effect.provide(core)),
        seeded = Promise.withResolvers<void>();
      let generation = 1;
      const pass = (): PeerWork.PeerWorkPass => ({
        at: generation,
        threads: [
          {
            id: "thread-1",
            projectId: "t3-pay",
            providerInstanceId: "shared-1",
            updatedAt: DateTime.makeUnsafe(generation),
          } as never,
        ],
        assignment: () => task,
        projectOf: new Map([
          [
            "t3-pay",
            {
              workspace: { slug: "acme", name: "Acme" },
              project: { id: "pay" } as never,
              repositoryPath: broker.root,
            },
          ],
        ]),
        sharedInstance: new Map([
          ["shared-1", { workspace: { slug: "acme", name: "Acme" }, projectId: "pay" }],
        ]),
        turnsOf: () =>
          Effect.sync(() => {
            seeded.resolve();
            return {
              providerThreads: [{ id: "p", providerInstanceId: "shared-1" }],
              providerTurns: Array.from({ length: generation }, (_, i) => ({
                id: `turn-${i}`,
                providerThreadId: "p",
                completedAt: DateTime.makeUnsafe(Date.parse("2026-10-09T12:00:00Z") + i),
                status: "completed",
                turnTokenUsage: {
                  inputTokens: 100,
                  outputTokens: 10,
                  cachedInputTokens: 20,
                  cacheCreationTokens: 5,
                  usageStatus: "complete",
                  usageScope: "main_agent",
                  hasSubagents: false,
                },
              })),
            } as never;
          }),
      });
      const log = broker.broker.host.log,
        contribution = yield* MetricsPlugin.contributions.pipe(
          Effect.provideService(PeerLog.PeerLog, {
            ...log,
            subscribe: (f) => {
              subscribed.resolve();
              return log.subscribe(f);
            },
          }),
          Effect.provideService(PeerWork.PeerWork, { ...work, latestPass: Effect.sync(pass) }),
          Effect.provide(core),
        );
      yield* plugins.attach(new Map([["metrics", contribution]]), []);
      yield* Effect.promise(() => subscribed.promise);
      yield* Effect.promise(() => seeded.promise);
      const rpc = yield* RpcTest.makeClient(MetricsRpcGroup).pipe(
        Effect.provide(
          PeerHub.rpcLayer(wrap).pipe(
            Layer.provide(
              Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
            ),
          ),
        ),
      );
      yield* rpc[PEER_METRICS_METHODS.peerMetricsConfigure]({
        workspace: "acme",
        sharing: true,
        debug: "on",
      });
      const body = { session_id: "one", cwd: broker.root };
      yield* Effect.promise(() =>
        broker.broker["hook"]({ ...body, hook_event_name: "SessionStart" }, {}),
      );
      yield* Effect.promise(() =>
        broker.broker["hook"](
          { ...body, hook_event_name: "UserPromptSubmit", prompt: sentinels[0] },
          {},
        ),
      );
      yield* Effect.promise(() =>
        broker.broker["hook"](
          {
            ...body,
            hook_event_name: "PostToolUse",
            tool_name: "Edit",
            tool_input: { file_path: `${broker.root}/${sentinels[1]}` },
          },
          {},
        ),
      );
      yield* Effect.promise(() =>
        broker.broker["runCli"]("note", [sentinels[2]!], { "x-peer-session": "claude:one" }).catch(
          () => undefined,
        ),
      );
      yield* Effect.promise(() =>
        broker.broker["runCli"]("scope", [sentinels[3]!], { "x-peer-session": "claude:one" }).catch(
          () => undefined,
        ),
      );
      broker.broker.record("session.started", { session: "claude:one", task, label: sentinels[0] });
      broker.broker.record("cli", {
        session: "claude:one",
        args: [sentinels[3]],
        out: sentinels[4],
        note: sentinels[2],
      });
      broker.broker.record("cli.failed", { session: "claude:one", error: sentinels[5] });
      broker.broker.record("intent", {
        session: "claude:one",
        task,
        ms: 10,
        verdictCounts: { clear: 1 },
      });
      yield* Effect.promise(log.idle);
      generation = 2;
      yield* TestClock.adjust("30 seconds");
      yield* Effect.promise(() => uploaded.promise);
      yield* plugins.setPlugin({ id: "metrics", enabled: false });
      const store = createLocalStore(`${state.hubHome}/.metrics`, () =>
          Date.parse("2026-10-09T12:00:00Z"),
        ),
        files = yield* Effect.promise(store.files);
      assert.isTrue(files.length > 0);
      const main = yield* Effect.promise(() => NodeFSP.readFile(log.path, "utf8")),
        debug = yield* Effect.promise(() => NodeFSP.readFile(broker.debugPath, "utf8")),
        rolls = yield* Effect.promise(async () =>
          (await Promise.all(files.map((f) => NodeFSP.readFile(f.file, "utf8")))).join("\n"),
        );
      const bodies = hub.calls
        .filter((c) => c.method === "PUT" && c.url?.includes("/days/"))
        .map((c) => c.body);
      assert.isTrue(bodies.length > 0);
      for (const body of bodies) {
        const row = yield* decodeRow(JSON.parse(body));
        assert.isTrue(Object.keys(row.counters).every((k) => /^[a-z][a-z0-9_.-]{0,47}$/.test(k)));
        assert.isTrue(Object.keys(row.tasks).every((k) => /^(t_[a-f0-9]{12}|none|other)$/.test(k)));
      }
      yield* plugins.setPlugin({ id: "metrics", enabled: true });
      const input = {
          workspace: "acme",
          project: "pay",
          scope: "environment" as const,
          window: 28 as const,
        },
        summary = yield* rpc[PEER_METRICS_METHODS.peerMetricsSummary](input),
        days = yield* rpc[PEER_METRICS_METHODS.peerMetricsDays]({
          ...input,
          from: "2026-10-09",
          to: "2026-10-09",
        }),
        exported = metricsExport(days, "ana-laptop", []);
      for (const text of [
        main,
        rolls,
        ...bodies,
        JSON.stringify(summary),
        exported.csv,
        exported.tasksCsv,
        exported.json,
      ])
        for (const sentinel of sentinels) assert.notInclude(text, sentinel);
      for (const sentinel of sentinels) assert.include(debug, sentinel);
      assert.include(main, taskRef(task));
      assert.strictEqual(summary.current.tasks[taskRef(task)]?.in, 100);
      const joined = metricsExport(days, "ana-laptop", [{ id: task, title: task } as never]);
      assert.include(joined.tasksCsv, task);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
