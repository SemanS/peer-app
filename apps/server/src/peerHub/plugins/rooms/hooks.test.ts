import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import type { PeerHookContext, PeerSessionView } from "../../core/plugin.ts";
import { sessionOf } from "./fixtures.test.ts";
import { localOf, roomHooks } from "./hooks.ts";
import type { Rooms } from "./Rooms.ts";
import type { Heard } from "./text.ts";

const heard = (seq: number, text = "Why?"): Heard => ({
  ref: `vl-7:${seq}`,
  workspace: "acme",
  project: "app",
  kind: "passed",
  seq,
  task: "vl-7",
  taskName: "VL-7",
  author: "Eva",
  owner: "Bob",
  text,
});

/** The hooks over a stand-in service: a run's queue, and what it was told to send. */
const hooksOf = (
  waiting: Heard[],
  tellable: (candidates: ReadonlyArray<Heard>) => ReadonlyArray<Heard> = (all) => all,
) => {
  const queued: string[] = [];
  let wakes = 0;
  const rooms = {
    waiting: () => waiting,
    tellable: (_run: string | undefined, candidates: ReadonlyArray<Heard>) =>
      Effect.succeed(tellable(candidates)),
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

describe("a message a started run's first prompt carried", () => {
  const prompted = (over: Partial<Heard> = {}): Heard => ({ ...heard(12), promptedAt: 0, ...over });
  const stepOf = (hooks: ReturnType<typeof hooksOf>["hooks"], session: PeerSessionView) =>
    hooks.notices[0]!.read({ ...ctxOf(session), event: "post-tool" });
  const wake = (hooks: ReturnType<typeof hooksOf>["hooks"], session: PeerSessionView) =>
    hooks.notices[0]!.read({ ...ctxOf(session), waking: true });

  it.effect("is not repeated at a working step or at session start: the prompt has it", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([prompted()]);
      yield* TestClock.setTime(3_600_000);
      assert.isNull(yield* stepOf(hooks, sessionOf()));
      assert.isNull(yield* hooks.sessionStart(ctxOf(sessionOf())));
    }),
  );

  it.effect("prompt lost: the idle session is woken with it, and it counts once heard", () =>
    Effect.gen(function* () {
      const waiting = [prompted()];
      const { hooks, queued } = hooksOf(waiting);
      const session = sessionOf();
      yield* TestClock.setTime(30_000);
      const said = yield* wake(hooks, session);
      assert.deepStrictEqual(refsOf(said), ["vl-7:12"]);
      yield* hooks.delivery({ session, refs: ["vl-7:12"], state: "modelInput" });
      assert.deepStrictEqual(queued, ["vl-7:12"]);
      assert.isNull(yield* wake(hooks, session));
    }),
  );

  it.effect("prompt read, no answer: it is the same message once, its one reminder", () =>
    Effect.gen(function* () {
      const waiting = [prompted()];
      const { hooks } = hooksOf(waiting);
      const session = sessionOf();
      assert.isNull(yield* stepOf(hooks, session));
      yield* TestClock.setTime(60_000);
      assert.deepStrictEqual(refsOf(yield* wake(hooks, session)), ["vl-7:12"]);
      yield* hooks.delivery({ session, refs: ["vl-7:12"], state: "modelInput" });
      assert.isNull(yield* wake(hooks, session));
      assert.isNull(yield* stepOf(hooks, session));
    }),
  );

  it.effect("gives a booting agent's prompt time to arrive before waking it", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([prompted()]);
      yield* TestClock.setTime(29_000);
      assert.isNull(yield* wake(hooks, sessionOf()));
    }),
  );
});

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

describe("a message that ended meanwhile", () => {
  it.effect("is not told when the Hub says its delivery ended", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([heard(12), heard(13)], (all) =>
        all.filter((one) => one.seq !== 12),
      );
      assert.deepStrictEqual(refsOf(yield* read(hooks, sessionOf())), ["vl-7:13"]);
    }),
  );

  it.effect("says nothing, and offers nothing, when none still holds", () =>
    Effect.gen(function* () {
      const { hooks } = hooksOf([heard(12)], () => []);
      const session = sessionOf();
      assert.isNull(yield* read(hooks, session));
      assert.strictEqual(localOf(session).offering.size, 0);
      assert.isNull(yield* hooks.sessionStart(ctxOf(session)));
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
