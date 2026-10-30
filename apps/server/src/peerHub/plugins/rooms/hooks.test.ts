import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { PeerHookContext, PeerSessionView } from "../../core/plugin.ts";
import { sessionOf } from "./fixtures.test.ts";
import { localOf, roomHooks } from "./hooks.ts";
import type { Rooms } from "./Rooms.ts";
import type { Heard } from "./text.ts";

const heard = (seq: number, text = "Why?"): Heard => ({
  ref: `vl-7:${seq}`,
  kind: "passed",
  seq,
  task: "vl-7",
  taskName: "VL-7",
  author: "Eva",
  owner: "Bob",
  text,
});

/** The hooks over a stand-in service: a run's queue, and what it was told to send. */
const hooksOf = (waiting: Heard[]) => {
  const queued: string[] = [];
  let wakes = 0;
  const rooms = {
    waiting: () => waiting,
    settled: (_run: string | undefined, ref: string) => {
      const at = waiting.findIndex((one) => one.ref === ref);
      if (at >= 0) waiting.splice(at, 1);
    },
    queueHeard: (_session: PeerSessionView, ref: string) =>
      Effect.sync(() => void queued.push(ref)),
    wake: Effect.sync(() => {
      wakes += 1;
    }),
  } as unknown as Rooms["Service"];
  return { hooks: roomHooks(rooms), queued, wakes: () => wakes };
};

const ctxOf = (session: PeerSessionView): PeerHookContext => ({
  session,
  event: "stop",
  remainingMs: 1000,
});

const read = (hooks: ReturnType<typeof hooksOf>["hooks"], session: PeerSessionView) =>
  hooks.notices[0]!.read(ctxOf(session));
const refsOf = (said: unknown) =>
  typeof said === "object" && said !== null ? (said as { refs: string[] }).refs : [];

describe("the room's notice", () => {
  it("wakes and stops a landing, as a message addressed to the agent", () => {
    const [notice] = hooksOf([]).hooks.notices;
    assert.isTrue(notice?.wakes);
    assert.isTrue(notice?.landing);
  });

  it.effect("says a message once while it is on its way", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([heard(12)]);
      const session = sessionOf();
      assert.deepStrictEqual(refsOf(yield* read(hooks, session)), ["vl-7:12"]);
      assert.isNull(yield* read(hooks, session));
    }),
  );

  it.effect("offers a dropped message again", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([heard(12)]);
      const session = sessionOf();
      yield* read(hooks, session);
      yield* hooks.delivery({ session, refs: ["vl-7:12"], state: "dropped" });
      assert.deepStrictEqual(refsOf(yield* read(hooks, session)), ["vl-7:12"]);
    }),
  );

  it.effect("carries a start block too", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([heard(12)]);
      const said = yield* hooks.sessionStart(ctxOf(sessionOf()));
      assert.deepStrictEqual(refsOf(said), ["vl-7:12"]);
    }),
  );
});

describe("heard means read", () => {
  it.effect("an offer to a Peer Mod session queues no heard", () =>
    Effect.gen(function* () {
      const { hooks, queued } = hooksOf([heard(12)]);
      const session = sessionOf({ adapter: "mod" });
      yield* read(hooks, session);
      yield* hooks.delivery({ session, refs: ["vl-7:12"], state: "offered" });
      assert.deepStrictEqual(queued, []);
      assert.isFalse(session.told?.("rooms").has("vl-7:12"));
    }),
  );

  it.effect("model input queues heard and tells it for good", () =>
    Effect.gen(function* () {
      const waiting = [heard(12)];
      const { hooks, queued } = hooksOf(waiting);
      const session = sessionOf({ adapter: "mod" });
      yield* read(hooks, session);
      yield* hooks.delivery({ session, refs: ["vl-7:12"], state: "modelInput" });
      assert.deepStrictEqual(queued, ["vl-7:12"]);
      assert.isTrue(session.told?.("rooms").has("vl-7:12"));
      assert.deepStrictEqual(waiting, []);
    }),
  );

  it.effect("after a restart a message only offered is offered again", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([heard(12)]);
      const before = sessionOf({ adapter: "mod" });
      yield* read(hooks, before);
      yield* hooks.delivery({ session: before, refs: ["vl-7:12"], state: "offered" });
      const after = sessionOf({ adapter: "mod", told: before.told! });
      assert.deepStrictEqual(refsOf(yield* read(hooks, after)), ["vl-7:12"]);
    }),
  );

  it.effect("a session without proof of model input queues no heard, and is told once", () =>
    Effect.gen(function* () {
      const { hooks, queued } = hooksOf([heard(12)]);
      const session = sessionOf({ adapter: "hooks" });
      yield* read(hooks, session);
      yield* hooks.delivery({ session, refs: ["vl-7:12"], state: "offered" });
      assert.deepStrictEqual(queued, []);
      assert.isTrue(session.told?.("rooms").has("vl-7:12"));
    }),
  );
});

describe("the one reminder", () => {
  const heardBy = (session: PeerSessionView, hooks: ReturnType<typeof hooksOf>["hooks"]) =>
    Effect.gen(function* () {
      yield* read(hooks, session);
      yield* hooks.delivery({ session, refs: ["vl-7:12"], state: "modelInput" });
    });

  it.effect("comes after a stop without a word, wakes, and is said once", () =>
    Effect.gen(function* () {
      const { hooks, wakes } = hooksOf([heard(12)]);
      const session = sessionOf();
      yield* heardBy(session, hooks);
      yield* hooks.stop(ctxOf(session));
      assert.strictEqual(wakes(), 1);
      const said = yield* read(hooks, session);
      assert.match(String(said), /you read #12/);
      yield* hooks.stop(ctxOf(session));
      assert.strictEqual(wakes(), 1);
      assert.isNull(yield* read(hooks, session));
    }),
  );

  it.effect("stays away once the session posted", () =>
    Effect.gen(function* () {
      const { hooks, wakes } = hooksOf([heard(12)]);
      const session = sessionOf();
      yield* heardBy(session, hooks);
      localOf(session).unanswered.clear();
      yield* hooks.stop(ctxOf(session));
      assert.strictEqual(wakes(), 0);
      assert.isNull(yield* read(hooks, session));
    }),
  );

  it.effect("does not come before anything was heard", () =>
    Effect.gen(function* () {
      const { hooks, wakes } = hooksOf([]);
      yield* hooks.stop(ctxOf(sessionOf()));
      assert.strictEqual(wakes(), 0);
    }),
  );
});
