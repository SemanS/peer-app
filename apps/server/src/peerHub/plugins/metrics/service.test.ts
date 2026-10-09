// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - isolated persisted consent and rollup fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerLog from "../../core/log/PeerLog.ts";
import { coreLayer, paymentsSeed, seedState } from "../../core/testkit.ts";
import { createLocalStore, dayAt, dayOf } from "./client/localStore.ts";
import { make } from "./service.ts";
import { init } from "./vocabulary.ts";
const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(Date.parse("2026-10-09T12:00:00Z"));
  const core = yield* Layer.build(
    coreLayer(yield* seedState(paymentsSeed("https://isolated.test")), { session: "fake" }),
  );
  const state = yield* PeerState.PeerState.pipe(Effect.provide(core)),
    clock = yield* Clock.Clock;
  const now = () => clock.currentTimeMillisUnsafe(),
    log = yield* PeerLog.PeerLog.pipe(Effect.provide(core));
  let publishes = 0,
    fail = false;
  const calls: { method?: string; path: string }[] = [];
  const client = {
    me: Effect.succeed({
      email: "ana@acme.test",
      workspaces: [],
      joinable: [],
      features: { metrics: 1 },
    }),
    request: (_schema: unknown, input: { path: string; method?: string }) =>
      Effect.suspend(() => {
        calls.push(input);
        if (input.path === "/metrics")
          return Effect.succeed({ enabled: true, epoch: 1, retentionDays: 365 });
        if (input.method === "DELETE") return Effect.succeed({});
        if (fail) return Effect.fail(new PeerHubError({ detail: "offline" }));
        return Effect.succeed({
          rows: [
            {
              computers: 3,
              counters: { "overlaps.measured": 0, "overlaps.opened": 2 },
              durations: {},
              tasks: {},
            },
          ],
        });
      }),
  };
  const store = createLocalStore(`${state.hubHome}/.metrics`, now),
    today = dayOf(now());
  yield* Effect.promise(() => store.load());
  for (const delta of [0, -6, -7, -13, -14])
    yield* Effect.promise(() =>
      store.save("acme", "pay", dayAt(today, delta), {
        ...init(),
        day: dayAt(today, delta),
        counters: { "hook.events.codex_hooks": 1 },
      }),
    );
  const service = yield* make.pipe(
    Effect.provideService(PeerHubClient.PeerHubClient, client as never),
    Effect.provideService(PeerStatus.PeerStatus, {
      publish: Effect.sync(() => {
        publishes++;
      }),
    } as never),
    Effect.provide(core),
  );
  return {
    service,
    store,
    state,
    log,
    calls,
    today,
    publishes: () => publishes,
    fail: () => {
      fail = true;
    },
  };
});
it.effect("compares equal UTC windows and preserves local values when Team is unreachable", () =>
  Effect.gen(function* () {
    const f = yield* fixture,
      input = {
        workspace: "acme",
        project: "pay",
        scope: "environment" as const,
        window: 7 as const,
      };
    const local = yield* f.service.summary(input);
    assert.strictEqual(local.current.counters["hook.events.codex_hooks"], 2);
    assert.strictEqual(local.previous.counters["hook.events.codex_hooks"], 2);
    const before = f.publishes();
    yield* f.service.summary(input);
    assert.strictEqual(f.publishes(), before);
    const team = yield* f.service.summary({ ...input, scope: "team" });
    assert.strictEqual(team.current.counters["overlaps.measured"], 0);
    assert.strictEqual(f.calls.filter((c) => c.path.includes("by=total")).length, 2);
    f.fail();
    const fallback = yield* f.service.summary({ ...input, scope: "team" });
    assert.strictEqual(fallback.scope, "environment");
    assert.strictEqual(fallback.current.counters["hook.events.codex_hooks"], 2);
    assert.match(fallback.team.reason, /could not be reached/);
    const range = yield* f.service.days({
      workspace: "acme",
      project: "pay",
      scope: "environment",
      from: dayAt(f.today, -6),
      to: f.today,
    });
    assert.strictEqual(range.rows.length, 2);
    const refused = yield* f.service
      .configure({ workspace: "acme", team: true })
      .pipe(Effect.result);
    assert.strictEqual(refused._tag, "Failure");
    assert.isFalse(f.calls.some((c) => c.method === "PUT"));
    yield* f.service.configure({ workspace: "acme", sharing: true });
    assert.isTrue((yield* f.service.status).workspaces[0]?.sharing);
    yield* f.state.updateRuntime((current) => ({
      ...current,
      persisted: { ...current.persisted, email: "bob@acme.test" },
    }));
    assert.isFalse((yield* f.service.status).workspaces[0]?.sharing);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("debug renewal replaces detail and local erase leaves the dashboard empty", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.service.configure({ debug: "on" });
    f.log.record("cli", { outBytes: 1 }, { out: "SENTINEL-first" });
    yield* Effect.promise(f.log.idle);
    assert.include(
      yield* Effect.promise(() => NodeFSP.readFile(f.log.debugState().path, "utf8")),
      "SENTINEL-first",
    );
    yield* f.service.configure({ debug: "on" });
    f.log.record("cli", { outBytes: 1 }, { out: "SENTINEL-second" });
    yield* Effect.promise(f.log.idle);
    const detail = yield* Effect.promise(() => NodeFSP.readFile(f.log.debugState().path, "utf8"));
    assert.notInclude(detail, "SENTINEL-first");
    assert.include(detail, "SENTINEL-second");
    yield* f.service.configure({ eraseLocal: true });
    assert.deepStrictEqual(yield* Effect.promise(() => f.store.files()), []);
    const summary = yield* f.service.summary({
      workspace: "acme",
      project: "pay",
      scope: "environment",
      window: 7,
    });
    assert.deepStrictEqual(summary.current.counters, {});
    yield* f.service.configure({ debug: "delete" });
    yield* Effect.promise(f.log.idle);
    assert.isFalse(f.log.debugState().on);
    assert.isNull(
      yield* Effect.promise(() => NodeFSP.stat(f.log.debugState().path).catch(() => null)),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("removed projects cannot read retained local rollups or query Team metrics", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.service.summary({
      workspace: "acme",
      project: "pay",
      scope: "environment",
      window: 7,
    });
    const before = f.calls.length;
    yield* f.state.updateRuntime((current) => ({
      ...current,
      persisted: {
        ...current.persisted,
        workspaces: current.persisted.workspaces.map((w) => ({
          ...w,
          manifest: w.manifest ? { ...w.manifest, projects: [] } : null,
        })),
      },
    }));
    for (const scope of ["environment", "team"] as const) {
      const summary = yield* f.service
        .summary({
          workspace: "acme",
          project: "pay",
          scope,
          window: 7,
        })
        .pipe(Effect.result);
      const days = yield* f.service
        .days({
          workspace: "acme",
          project: "pay",
          scope,
          from: dayAt(f.today, -6),
          to: f.today,
        })
        .pipe(Effect.result);
      assert.strictEqual(summary._tag, "Failure");
      assert.strictEqual(days._tag, "Failure");
      if (summary._tag === "Failure") assert.isTrue(summary.failure.refused);
      if (days._tag === "Failure") assert.isTrue(days.failure.refused);
    }
    assert.strictEqual(f.calls.length, before);
    assert.strictEqual((yield* Effect.promise(() => f.store.files())).length, 5);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect(
  "turn-off loads persisted consent before erasing and leaving clears it without a request",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.store.consent("ana@acme.test", "acme").sharing = true;
      yield* Effect.promise(() => f.store.saveState());
      yield* f.service.turnOff;
      assert.strictEqual(f.calls.filter((c) => c.method === "DELETE").length, 1);
      assert.isFalse((yield* f.service.status).workspaces[0]?.sharing);
      yield* f.service.configure({ workspace: "acme", sharing: true });
      const before = f.calls.length;
      yield* f.service.lifecycle({ kind: "left-workspace", workspace: "acme" });
      assert.strictEqual(f.calls.length, before);
      assert.isFalse((yield* f.service.status).workspaces[0]?.sharing);
      assert.strictEqual((yield* Effect.promise(() => f.store.files())).length, 5);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
