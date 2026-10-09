import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState } from "../../core/testkit.ts";
import { createCollector } from "./rollup.ts";
import { createHubSync } from "./client/hubSync.ts";
import { createLocalStore, dayAt, dayOf } from "./client/localStore.ts";
const fixture = Effect.gen(function* () {
  const context = yield* Layer.build(
    coreLayer(yield* seedState(paymentsSeed("https://isolated.test")), { session: "fake" }),
  );
  const state = yield* PeerState.PeerState.pipe(Effect.provide(context));
  let now = Date.parse("2026-10-09T12:00:00Z"),
    epoch = 1,
    supported = true,
    enabled = true,
    failures = 0,
    failure: string | null = null;
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  let respond: (path: string) => Effect.Effect<unknown, PeerHubError> = () => Effect.succeed({});
  const client: Pick<PeerHubClient.PeerHubClient["Service"], "me" | "request"> = {
    me: Effect.suspend(() => {
      calls.push({ path: "me" });
      return failure === "me"
        ? Effect.fail(new PeerHubError({ detail: "offline" }))
        : Effect.succeed({
            email: "ana@acme.test",
            workspaces: [],
            joinable: [],
            features: supported ? { metrics: 1 } : {},
          });
    }),
    request: (_schema, input) =>
      Effect.suspend(() => {
        calls.push({
          path: input.path,
          ...(input.method ? { method: input.method } : {}),
          ...(input.body ? { body: input.body } : {}),
        });
        if (input.path === "/metrics" && input.method !== "PUT")
          return Effect.succeed({ enabled, epoch, retentionDays: 365 });
        if (input.path === "/metrics" && input.method === "PUT") {
          enabled = (input.body as { enabled: boolean }).enabled;
          return Effect.succeed({ enabled, epoch, retentionDays: 365 });
        }
        if (input.path.includes("/days/") && failure)
          return Effect.fail(
            new PeerHubError({
              detail: "offline",
              ...(failure === "network" ? {} : { code: failure }),
            }),
          );
        return respond(input.path);
      }) as never,
  };
  const store = createLocalStore(`${state.hubHome}/.metrics`, () => now);
  yield* Effect.promise(() => store.load());
  const collector = createCollector(
      store,
      () => now,
      () => failures++,
    ),
    sync = createHubSync(
      client,
      store,
      collector,
      () => now,
      "ana-laptop",
      () => state.current().persisted.email,
      () => failures++,
    ),
    c = store.consent("ana@acme.test", "acme");
  const record = (day: string) =>
    collector.record({
      workspace: "acme",
      project: "pay",
      event: "hook",
      adapter: "codex_hooks",
      t: `${day}T12:00:00Z`,
      chars: 80,
    });
  return {
    state,
    store,
    collector,
    sync,
    c,
    calls,
    record,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    epoch: (v: number) => {
      epoch = v;
    },
    supported: (v: boolean) => {
      supported = v;
    },
    enabled: (v: boolean) => {
      enabled = v;
    },
    failure: (v: string | null) => {
      failure = v;
    },
    respond: (v: typeof respond) => {
      respond = v;
    },
    failures: () => failures,
  };
});
it.effect(
  "sends nothing with sharing off, verifies support and uploads only consenting cumulative days",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture,
        today = dayOf(f.now());
      yield* f.sync.cycle;
      assert.deepStrictEqual(f.calls, []);
      yield* f.sync.setTeam("acme", true);
      yield* f.sync.cycle;
      assert.isFalse(f.calls.some((c) => c.path.includes("/days/")));
      f.c.sharing = true;
      f.c.sharedSince = dayAt(today, -1);
      for (const day of [dayAt(today, -2), dayAt(today, -1), today]) f.record(day);
      yield* f.sync.cycle;
      assert.deepStrictEqual(
        f.calls.filter((c) => c.path.includes("/days/")).map((c) => c.path.slice(-10)),
        [dayAt(today, -1), today],
      );
      f.record(today);
      yield* f.sync.cycle;
      assert.strictEqual(f.calls.filter((c) => c.path.includes("/days/")).length, 2);
      f.advance(600000);
      f.record(today);
      yield* f.sync.cycle;
      assert.strictEqual(f.calls.filter((c) => c.path.includes("/days/")).length, 3);
      const old = yield* fixture;
      old.supported(false);
      old.c.sharing = true;
      old.c.sharedSince = dayOf(old.now());
      old.record(dayOf(old.now()));
      yield* old.sync.cycle;
      assert.strictEqual(old.sync.team("acme").state, "unsupported");
      assert.deepStrictEqual(
        old.calls.map((c) => c.path),
        ["me"],
      );
      const offline = yield* fixture;
      offline.failure("me");
      yield* offline.sync.status("acme");
      assert.strictEqual(offline.sync.team("acme").state, "unknown");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect(
  "resets epoch before old-day uploads and backs off failures without touching coordination",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture,
        today = dayOf(f.now());
      f.c.sharing = true;
      f.c.sharedSince = dayAt(today, -3);
      f.c.epoch = 1;
      f.record(dayAt(today, -1));
      f.record(today);
      f.epoch(2);
      yield* f.sync.cycle;
      assert.strictEqual(f.c.sharedSince, today);
      assert.strictEqual(f.calls.filter((c) => c.path.includes("/days/")).length, 1);
      assert.strictEqual(
        (f.calls.find((c) => c.path.includes("/days/"))!.body as { epoch: number }).epoch,
        2,
      );
      const offline = yield* fixture;
      offline.c.sharing = true;
      offline.c.sharedSince = today;
      offline.record(today);
      offline.failure("network");
      yield* offline.sync.cycle;
      offline.advance(59000);
      yield* offline.sync.cycle;
      assert.strictEqual(offline.calls.filter((c) => c.path.includes("/days/")).length, 1);
      offline.advance(1000);
      yield* offline.sync.cycle;
      offline.advance(119000);
      yield* offline.sync.cycle;
      assert.strictEqual(offline.calls.filter((c) => c.path.includes("/days/")).length, 2);
      offline.advance(1000);
      yield* offline.sync.cycle;
      assert.strictEqual(offline.failures(), 3);
      const stale = yield* fixture;
      stale.c.sharing = true;
      stale.c.sharedSince = today;
      stale.record(today);
      stale.failure("stale_rollup");
      yield* stale.sync.cycle;
      stale.advance(3600000);
      yield* stale.sync.cycle;
      assert.strictEqual(stale.calls.filter((c) => c.path.includes("/days/")).length, 1);
      const invalid = yield* fixture;
      invalid.c.sharing = true;
      invalid.c.sharedSince = today;
      invalid.record(today);
      invalid.failure("invalid_request");
      for (let i = 0; i < 3; i++) {
        yield* invalid.sync.cycle;
        invalid.advance(600000);
      }
      yield* invalid.sync.cycle;
      assert.strictEqual(invalid.calls.filter((c) => c.path.includes("/days/")).length, 3);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect(
  "an owed erase blocks uploads, retries before resuming and times out within five seconds",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture,
        started = yield* Deferred.make<void>();
      f.c.sharing = true;
      f.c.sharedSince = dayOf(f.now());
      f.record(dayOf(f.now()));
      f.respond((path) =>
        path.includes("?environment")
          ? Effect.fail(new PeerHubError({ detail: "unreachable" }))
          : Effect.succeed({}),
      );
      yield* f.sync.erase("acme");
      assert.isFalse(f.c.sharing);
      assert.isTrue(f.c.eraseOwed);
      f.c.sharing = true;
      yield* f.sync.cycle;
      assert.isFalse(f.calls.some((c) => c.path.includes("/days/")));
      f.respond(() => Effect.succeed({}));
      yield* f.sync.cycle;
      assert.isUndefined(f.c.eraseOwed);
      assert.isTrue(f.c.sharing);
      assert.isTrue(
        f.calls.findIndex((c) => c.path.includes("?environment")) <
          f.calls.findIndex((c) => c.path.includes("/days/")),
      );
      assert.isTrue(f.calls.at(-1)?.path.includes("/days/"));
      f.respond(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)));
      const erase = yield* f.sync.erase("acme").pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* TestClock.adjust("5 seconds");
      yield* Fiber.join(erase);
      assert.isTrue(f.c.eraseOwed);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("stale epochs stop old backfill and unsupported versions pause for an hour", () =>
  Effect.gen(function* () {
    const f = yield* fixture,
      today = dayOf(f.now());
    f.c.sharing = true;
    f.c.sharedSince = dayAt(today, -5);
    for (let i = -5; i <= 0; i++) f.record(dayAt(today, i));
    f.failure("stale_epoch");
    yield* f.sync.cycle;
    assert.strictEqual(f.c.sharedSince, today);
    assert.deepStrictEqual(f.c.markers, {});
    f.failure(null);
    yield* f.sync.cycle;
    assert.strictEqual(f.calls.filter((c) => c.path.includes("/days/")).length, 2);
    assert.isTrue(f.calls.at(-1)?.path.endsWith(today));
    const unsupported = yield* fixture;
    unsupported.c.sharing = true;
    unsupported.c.sharedSince = today;
    unsupported.record(today);
    unsupported.failure("unsupported_version");
    yield* unsupported.sync.cycle;
    unsupported.advance(3599999);
    yield* unsupported.sync.cycle;
    assert.strictEqual(unsupported.calls.filter((c) => c.path.includes("/days/")).length, 1);
    unsupported.advance(1);
    yield* unsupported.sync.cycle;
    assert.strictEqual(unsupported.calls.filter((c) => c.path.includes("/days/")).length, 2);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("erase waits for an in-flight upload and repeats after a recent upload timeout", () =>
  Effect.gen(function* () {
    const f = yield* fixture,
      uploadStarted = yield* Deferred.make<void>(),
      release = yield* Deferred.make<void>();
    f.c.sharing = true;
    f.c.sharedSince = dayOf(f.now());
    f.record(dayOf(f.now()));
    f.respond((path) =>
      path.includes("/days/")
        ? Deferred.succeed(uploadStarted, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as({}),
          )
        : Effect.succeed({}),
    );
    const upload = yield* f.sync.cycle.pipe(Effect.forkScoped);
    yield* Deferred.await(uploadStarted);
    const erased = yield* f.sync.erase("acme").pipe(Effect.forkScoped);
    assert.isFalse(f.calls.some((c) => c.method === "DELETE"));
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(upload);
    yield* Fiber.join(erased);
    assert.strictEqual(f.calls.at(-1)?.method, "DELETE");
    assert.isFalse(f.c.sharing);
    const timed = yield* fixture;
    timed.c.sharing = true;
    timed.c.sharedSince = dayOf(timed.now());
    timed.record(dayOf(timed.now()));
    timed.respond((path) =>
      path.includes("/days/")
        ? Effect.fail(new PeerHubError({ detail: "Request timed out" }))
        : Effect.succeed({}),
    );
    yield* timed.sync.cycle;
    yield* timed.sync.erase("acme");
    assert.isTrue(timed.c.eraseOwed);
    timed.advance(59999);
    yield* timed.sync.cycle;
    assert.strictEqual(timed.calls.filter((c) => c.method === "DELETE").length, 1);
    timed.advance(1);
    yield* timed.sync.cycle;
    assert.strictEqual(timed.calls.filter((c) => c.method === "DELETE").length, 2);
    assert.isUndefined(timed.c.eraseOwed);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
