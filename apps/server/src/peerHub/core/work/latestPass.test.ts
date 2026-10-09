import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as PeerState from "../state/PeerState.ts";
import { coreLayer, paymentsSeed, paymentsT3, seedState, standInHub } from "../testkit.ts";
import * as PeerWork from "./PeerWork.ts";
it.effect(
  "publishes each work pass without projection reads from a snapshot reader or taking the state lock",
  () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, { projects: {} }] });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "test", t3: paymentsT3 }),
      );
      yield* Effect.gen(function* () {
        const work = yield* PeerWork.PeerWork,
          state = yield* PeerState.PeerState,
          projection = yield* ProjectionStore.ProjectionStoreV2;
        const reads = vi.spyOn(projection, "getThreadRecords");
        assert.isNull(yield* work.latestPass);
        yield* work.refresh();
        const first = yield* work.latestPass;
        assert.strictEqual(first?.threads[0]?.id, "thread-1");
        assert.strictEqual(first?.assignment("peer:thread-1", "acme", "pay"), "krk-1");
        const count = reads.mock.calls.length;
        const again = yield* state.lock.withPermits(1)(
          Effect.gen(function* () {
            const reader = yield* work.latestPass.pipe(Effect.forkScoped);
            return yield* Fiber.join(reader);
          }),
        );
        assert.strictEqual(first, again);
        assert.strictEqual(reads.mock.calls.length, count);
        yield* work.refresh();
        assert.notStrictEqual(yield* work.latestPass, first);
        if (first) yield* first.turnsOf("thread-1");
        assert.strictEqual(reads.mock.calls.length, count + 2);
      }).pipe(Effect.provide(core));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
