import { assert, describe, it } from "@effect/vitest";
import { PeerHubError, type PeerRoomInboxItem, type PeerRoomTarget } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { BOB, EVA, messageOf } from "./fixtures.test.ts";
import {
  act,
  actOn,
  decide,
  kindOf,
  NO_CHECKOUT,
  NOT_RUNNING,
  RUN_ENDED,
  RUN_NOW_PERSONAL,
  SESSION_ENDED,
  type FollowDeps,
  type HereRun,
} from "./follow.ts";

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
    const other: HereRun = { id: "run_3", live: true, capacity: "shared" };
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
    const target = delivery("passed", { by: BOB });
    assert.deepStrictEqual(decide(passed(target), target, [], BOB), { do: "take-start" });
  });

  it("after a crash, offers a taken delivery again to a live session of its run", () => {
    const target = delivery("taken", { run: "run_1", by: BOB });
    assert.deepStrictEqual(decide(passed(target), target, [live], BOB), {
      do: "offer",
      run: "run_1",
    });
  });

  describe("for a taken delivery whose run has no live session", () => {
    const target = delivery("taken", { run: "run_2", by: BOB });

    it("starts nothing and waits out the grace", () => {
      assert.deepStrictEqual(decide(passed(target), target, [detached], BOB, 30_000), {
        do: "wait",
        ms: 90_000,
      });
    });

    it("calls it lost after the grace, and never gives it another run", () => {
      assert.deepStrictEqual(decide(passed(target), target, [live], BOB, 120_000), {
        do: "lost",
        run: "run_2",
      });
    });
  });

  it("reads an open session with none live here as coming back: queued, nothing started", () => {
    const back: HereRun = { id: "run_4", live: false, running: true };
    assert.deepStrictEqual(decide(own(delivery("passed")), delivery("passed"), [back], BOB), {
      do: "take-queue",
      run: "run_4",
    });
  });

  it("gives an own message a review session when its only run cannot continue here", () => {
    const terminal: HereRun = { id: "run_5", live: false, staysPut: true };
    assert.deepStrictEqual(decide(own(delivery("passed")), delivery("passed"), [terminal], BOB), {
      do: "take-review",
    });
  });

  it("after a crash, starts nothing for a taken delivery that recorded no run", () => {
    assert.deepStrictEqual(decide(passed(delivery("taken")), delivery("taken"), [live], BOB), {
      do: "nothing",
    });
  });

  describe("for a team-reach delivery", () => {
    const shared: HereRun = { id: "run_1", live: true, capacity: "shared" };
    const target = delivery("passed", { run: "run_1" });

    it("offers it to its live run", () => {
      assert.deepStrictEqual(decide(passed(target), target, [shared], BOB), {
        do: "take-offer",
        run: "run_1",
      });
    });

    it("continues its run when that is detached", () => {
      assert.deepStrictEqual(decide(passed(target), target, [{ ...shared, live: false }], BOB), {
        do: "take-continue",
        run: "run_1",
      });
    });

    it("never gives it to another run, and never starts one on the owner's capacity", () => {
      const other: HereRun = { id: "run_2", live: true, capacity: "shared" };
      const fail = { do: "fail", reason: RUN_ENDED } as const;
      assert.deepStrictEqual(decide(passed(target), target, [other], BOB), fail);
      assert.deepStrictEqual(decide(passed(target), target, [], BOB), fail);
    });

    it("fails with its own reason when the run is personal now", () => {
      for (const state of ["passed", "taken"]) {
        const now = delivery(state, { run: "run_1" });
        assert.deepStrictEqual(
          decide(passed(now), now, [{ ...shared, capacity: "personal" }], BOB),
          { do: "fail", reason: RUN_NOW_PERSONAL },
        );
      }
    });

    it("waits while this computer cannot tell what carries the run", () => {
      const { capacity: _unknown, ...unread } = shared;
      assert.deepStrictEqual(decide(passed(target), target, [unread], BOB), { do: "nothing" });
    });

    it("reads an own delivery as own, though it has no `by` either", () => {
      assert.deepStrictEqual(decide(own(delivery("passed")), delivery("passed"), [], BOB), {
        do: "take-review",
      });
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
    record: (_item, run) => note(`record ${run}`),
    queuedRun: () => undefined,
    prompted: (_item, run, kind) => note(`prompted ${run} ${kind}`),
    told: () => false,
    startedAt: 0,
    later: (ms) => note(`later ${ms}`),
    queue: (_item, run, kind) => note(`queue ${run} ${kind}`),
    unqueue: (_item, run) => note(`unqueue ${run}`),
    wake: note("wake"),
    continueRun: (_item, run) => Effect.as(note(`continue ${run}`), null),
    review: () => Effect.as(note("review"), { run: "run_9", typed: true }),
    start: () => Effect.as(note("start"), { run: "run_8", typed: true }),
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

  it.effect("starts a review session and records its run, but a typed prompt is not heard", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf();
      yield* act(deps, itemOf(own(delivery("passed"))));
      assert.deepStrictEqual(log, ["take -", "review", "prompted run_9 own", "record run_9"]);
    }),
  );

  it.effect("fails a team delivery whose run ended, and takes nothing", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf();
      yield* act(deps, itemOf(passed(delivery("passed", { run: "run_gone" }))));
      assert.deepStrictEqual(log, [`fail ${RUN_ENDED}`]);
    }),
  );

  it.effect("starts a working run for a passed-on message", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf();
      yield* act(deps, itemOf(passed(delivery("passed", { by: BOB }))));
      assert.deepStrictEqual(log, ["take -", "start", "prompted run_8 passed", "record run_8"]);
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

  it.effect("does not tell a live session again what it was told", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [live], told: () => true });
      yield* act(deps, itemOf(passed(delivery("taken", { run: "run_1", by: BOB }))));
      assert.deepStrictEqual(log, []);
    }),
  );

  it.effect("keeps a delivery taken and queued for a run with no live session", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [{ id: "run_4", live: false, running: true }] });
      yield* act(deps, itemOf(own(delivery("passed"))));
      assert.deepStrictEqual(log, ["take run_4", "queue run_4 own"]);
    }),
  );

  describe("a taken delivery with a run and no live session", () => {
    const at = "1970-01-01T00:16:40.000Z";
    const lost = passed(delivery("taken", { run: "run_2", by: BOB, at }));
    const after = (ms: number) => TestClock.setTime(1_000_000 + ms);

    it.effect("waits the grace from the take, reading again when it ends", () =>
      Effect.gen(function* () {
        const { deps, log } = depsOf({ runs: [detached] });
        yield* after(20_000);
        yield* act(deps, itemOf(lost));
        assert.deepStrictEqual(log, ["later 100000"]);
      }),
    );

    it.effect("never fails on the first read after a restart, however old the take", () =>
      Effect.gen(function* () {
        yield* after(3_600_000);
        const { deps, log } = depsOf({ runs: [detached], startedAt: 1_000_000 + 3_600_000 });
        yield* act(deps, itemOf(lost));
        assert.deepStrictEqual(log, ["later 120000"]);
      }),
    );

    it.effect("fails it past the grace: told, its session ended", () =>
      Effect.gen(function* () {
        yield* after(120_000);
        const { deps, log } = depsOf({ runs: [detached], told: () => true });
        yield* act(deps, itemOf(lost));
        assert.deepStrictEqual(log, ["unqueue run_2", `fail ${SESSION_ENDED}`]);
      }),
    );

    it.effect("fails it past the grace: not told, the agent is gone", () =>
      Effect.gen(function* () {
        yield* after(120_000);
        const { deps, log } = depsOf();
        yield* act(deps, itemOf(lost));
        assert.deepStrictEqual(log, ["unqueue run_2", `fail ${NOT_RUNNING}`]);
      }),
    );
  });

  it.effect("carries the other deliveries past one that dies", () =>
    Effect.gen(function* () {
      const log: string[] = [];
      const { deps } = depsOf({
        runs: [live],
        take: (item, run) =>
          item.message.seq === 1
            ? Effect.die("a bad row")
            : Effect.sync(() => void log.push(`take ${run}`)),
      });
      const items = [1, 2].map((seq) =>
        itemOf(messageOf({ seq, author: { email: BOB }, to: [delivery("passed")] })),
      );
      yield* Effect.forEach(items, (item) => actOn(deps, item), { discard: true });
      assert.deepStrictEqual(log, ["take run_1"]);
    }),
  );

  it.effect("never starts twice: a second read sees the delivery taken", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf();
      yield* act(deps, itemOf(own(delivery("passed"))));
      yield* act(deps, itemOf(own(delivery("taken"))));
      assert.deepStrictEqual(log, ["take -", "review", "prompted run_9 own", "record run_9"]);
    }),
  );

  it.effect("offers a taken message again after a restart, without taking it", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [live] });
      yield* act(deps, itemOf(passed(delivery("taken", { run: "run_1", by: BOB }))));
      assert.deepStrictEqual(log, ["queue run_1 passed", "wake"]);
    }),
  );

  describe("when the agent starts but its prompt could not be typed", () => {
    const unread = { run: "run_9", typed: false };

    it.effect("keeps the delivery taken with its run, and queues the message for that run", () =>
      Effect.gen(function* () {
        const { deps, log } = depsOf({ review: () => Effect.succeed(unread) });
        yield* act(deps, itemOf(own(delivery("passed"))));
        assert.deepStrictEqual(log, ["take -", "queue run_9 own", "record run_9", "wake"]);
      }),
    );

    it.effect("does the same for a working run, and neither fails nor says heard", () =>
      Effect.gen(function* () {
        const { deps, log } = depsOf({ start: () => Effect.succeed(unread) });
        yield* act(deps, itemOf(passed(delivery("passed", { by: BOB }))));
        assert.deepStrictEqual(log, ["take -", "queue run_9 passed", "record run_9", "wake"]);
      }),
    );

    it.effect("records the run again at the next read if the Hub did not take it", () =>
      Effect.gen(function* () {
        const { deps, log } = depsOf({ queuedRun: () => "run_9" });
        yield* act(deps, itemOf(own(delivery("taken"))));
        assert.deepStrictEqual(log, ["record run_9"]);
      }),
    );

    it.effect("never starts a second agent: Try again finds the run the start made", () =>
      Effect.gen(function* () {
        const made: HereRun = { id: "run_9", live: true };
        const { deps, log } = depsOf({ runs: [made] });
        yield* act(deps, itemOf(own(delivery("passed"))));
        assert.deepStrictEqual(log, ["take run_9", "queue run_9 own", "wake"]);
        const starting: HereRun = { id: "run_9", live: false };
        const later = depsOf({ runs: [starting] });
        yield* act(later.deps, itemOf(own(delivery("passed"))));
        assert.deepStrictEqual(later.log, ["take run_9", "queue run_9 own", "continue run_9"]);
      }),
    );

    it.effect("a live session hears it once the Hub lists the run", () =>
      Effect.gen(function* () {
        const { deps, log } = depsOf({ runs: [live] });
        yield* act(deps, itemOf(own(delivery("taken", { run: "run_1" }))));
        assert.deepStrictEqual(log, ["queue run_1 own", "wake"]);
      }),
    );
  });

  it.effect("ignores a delivery of someone else", () =>
    Effect.gen(function* () {
      const { deps, log } = depsOf({ runs: [live] });
      yield* act(deps, itemOf(messageOf({ to: [{ ...delivery("passed"), email: EVA }] })));
      assert.deepStrictEqual(log, []);
    }),
  );
});
