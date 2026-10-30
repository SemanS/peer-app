import { assert, describe, it } from "@effect/vitest";
import { PeerHubError, type PeerRoomInboxItem, type PeerRoomTarget } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { BOB, EVA, messageOf } from "./fixtures.test.ts";
import { act, decide, kindOf, NO_CHECKOUT, type FollowDeps, type HereRun } from "./follow.ts";

const delivery = (state: string, over: Partial<PeerRoomTarget> = {}): PeerRoomTarget => ({
  kind: "agent",
  email: BOB,
  state,
  ...over,
});
const own = (target: PeerRoomTarget) => messageOf({ author: { email: BOB }, to: [target] });
const passed = (target: PeerRoomTarget) => messageOf({ to: [target] });
const live: HereRun = { id: "run_1", live: true };
const detached: HereRun = { id: "run_2", live: false };

describe("decide", () => {
  it("gives a passed delivery to a live session of the owner's run", () => {
    assert.deepStrictEqual(
      decide(own(delivery("passed")), delivery("passed"), [detached, live], BOB),
      {
        do: "take-offer",
        run: "run_1",
      },
    );
  });

  it("prefers the run the delivery names", () => {
    const other: HereRun = { id: "run_3", live: true };
    const target = delivery("passed", { run: "run_3" });
    assert.deepStrictEqual(decide(passed(target), target, [live, other], BOB), {
      do: "take-offer",
      run: "run_3",
    });
  });

  it("continues a detached run here", () => {
    assert.deepStrictEqual(decide(own(delivery("passed")), delivery("passed"), [detached], BOB), {
      do: "take-continue",
      run: "run_2",
    });
  });

  it("starts a review session for the person's own message with no usable run", () => {
    assert.deepStrictEqual(decide(own(delivery("passed")), delivery("passed"), [], BOB), {
      do: "take-review",
    });
  });

  it("starts a working run for a passed-on message with no usable run", () => {
    assert.deepStrictEqual(decide(passed(delivery("passed")), delivery("passed"), [], BOB), {
      do: "take-start",
    });
  });

  it("after a crash, offers a taken delivery again to a live session of its run", () => {
    const target = delivery("taken", { run: "run_1" });
    assert.deepStrictEqual(decide(passed(target), target, [live], BOB), {
      do: "offer",
      run: "run_1",
    });
  });

  it("after a crash, starts nothing for a taken delivery whose run is not live", () => {
    const target = delivery("taken", { run: "run_2" });
    assert.deepStrictEqual(decide(passed(target), target, [detached], BOB), { do: "nothing" });
  });

  it("after a crash, starts nothing for a taken delivery that recorded no run", () => {
    assert.deepStrictEqual(decide(passed(delivery("taken")), delivery("taken"), [live], BOB), {
      do: "nothing",
    });
  });

  it.each(["waiting", "heard", "answered", "failed", "snoozed"])("leaves %s alone", (state) => {
    assert.deepStrictEqual(decide(passed(delivery(state)), delivery(state), [live], BOB), {
      do: "nothing",
    });
  });
});

describe("kindOf", () => {
  it("tells the person's own message, a passed-on one and team reach apart", () => {
    assert.strictEqual(kindOf(own(delivery("passed")), delivery("passed"), BOB), "own");
    assert.strictEqual(
      kindOf(passed(delivery("passed", { by: BOB })), delivery("passed", { by: BOB }), BOB),
      "passed",
    );
    assert.strictEqual(kindOf(passed(delivery("passed")), delivery("passed"), BOB), "team");
  });
});

/** Deps that record what was called, in order. */
const depsOf = (over: Partial<FollowDeps> & { readonly runs?: ReadonlyArray<HereRun> } = {}) => {
  const log: string[] = [];
  const note = (what: string) => Effect.sync(() => void log.push(what));
  const deps: FollowDeps = {
    me: BOB,
    runsHere: () => Effect.succeed(over.runs ?? []),
    take: (_item, run) => note(`take ${run ?? "-"}`),
    fail: (_item, reason) => note(`fail ${reason}`),
    heard: (_item, run) => note(`heard ${run}`),
    queue: (_item, run, kind) => note(`queue ${run} ${kind}`),
    unqueue: (_item, run) => note(`unqueue ${run}`),
    wake: note("wake"),
    continueRun: (_item, run) => Effect.as(note(`continue ${run}`), null),
    review: () => Effect.as(note("review"), "run_9"),
    start: () => Effect.as(note("start"), "run_8"),
    ...over,
  };
  return { deps, log };
};
const itemOf = (message: ReturnType<typeof messageOf>): PeerRoomInboxItem => ({
  project: "app",
  task: "vl-7",
  message,
});
const failed = new PeerHubError({ detail: "No." });

describe("act", () => {
  it.effect("takes, queues and wakes for a live session", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [live] });
      yield* act(deps, itemOf(own(delivery("passed"))));
      assert.deepStrictEqual(log, ["take run_1", "queue run_1 own", "wake"]);
    }),
  );

  it.effect("continues a detached run after taking it", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [detached] });
      yield* act(deps, itemOf(own(delivery("passed"))));
      assert.deepStrictEqual(log, ["take run_2", "queue run_2 own", "continue run_2"]);
    }),
  );

  it.effect("fails with the reason a detached run could not continue, unqueued", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({
        runs: [detached],
        continueRun: () => Effect.succeed("Continue it in the terminal."),
      });
      yield* act(deps, itemOf(own(delivery("passed"))));
      assert.deepStrictEqual(log, [
        "take run_2",
        "queue run_2 own",
        "unqueue run_2",
        "fail Continue it in the terminal.",
      ]);
    }),
  );

  it.effect("starts a review session, and records its run as heard", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf();
      yield* act(deps, itemOf(own(delivery("passed"))));
      assert.deepStrictEqual(log, ["take -", "review", "heard run_9"]);
    }),
  );

  it.effect("starts a working run for a passed-on message", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf();
      yield* act(deps, itemOf(passed(delivery("passed", { by: BOB }))));
      assert.deepStrictEqual(log, ["take -", "start", "heard run_8"]);
    }),
  );

  it.effect("fails saying why a review session cannot start: no checkout, no plugin", () =>
    Effect.gen(function* () {
      for (const reason of [NO_CHECKOUT, "Review sessions is turned off on this environment."]) {
        const { deps, log } = depsOf({
          review: () => Effect.fail(new PeerHubError({ detail: reason })),
        });
        yield* act(deps, itemOf(own(delivery("passed"))));
        assert.deepStrictEqual(log, ["take -", `fail ${reason}`]);
      }
    }),
  );

  it.effect("fails a working run the same way, and nothing retries", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ start: () => Effect.fail(failed) });
      yield* act(deps, itemOf(passed(delivery("passed", { by: BOB }))));
      assert.deepStrictEqual(log, ["take -", "fail No."]);
    }),
  );

  it.effect("starts nothing when another computer won the take", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ take: () => Effect.fail(failed) });
      yield* act(deps, itemOf(own(delivery("passed"))));
      assert.deepStrictEqual(log, []);
    }),
  );

  it.effect("never starts twice: a second read sees the delivery taken", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf();
      yield* act(deps, itemOf(own(delivery("passed"))));
      yield* act(deps, itemOf(own(delivery("taken"))));
      assert.deepStrictEqual(log, ["take -", "review", "heard run_9"]);
    }),
  );

  it.effect("offers a taken message again after a restart, without taking it", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [live] });
      yield* act(deps, itemOf(passed(delivery("taken", { run: "run_1", by: BOB }))));
      assert.deepStrictEqual(log, ["queue run_1 passed", "wake"]);
    }),
  );

  it.effect("ignores a delivery of someone else", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [live] });
      yield* act(deps, itemOf(messageOf({ to: [{ ...delivery("passed"), email: EVA }] })));
      assert.deepStrictEqual(log, []);
    }),
  );
});
