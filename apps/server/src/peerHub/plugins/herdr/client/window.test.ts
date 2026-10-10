import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import type { HerdrProcessShape } from "./HerdrProcess.ts";
import { fakeHerdrProcess, fakeHerdrWorld, type FakeHerdrWorld } from "./HerdrProcess.testkit.ts";
import { makeHerdrSupervisor } from "./supervisor.ts";
import { makeHerdrWindows } from "./window.ts";

/** Windows over Peer's herdr, once it serves (the supervisor has looked). */
const windowsOver = (world: FakeHerdrWorld, override: Partial<HerdrProcessShape> = {}) =>
  Effect.gen(function* () {
    const port = { ...fakeHerdrProcess(world), ...override };
    const supervisor = makeHerdrSupervisor({ port, stateDir: "/home/ana/.peer" });
    yield* Effect.promise(() => supervisor.tick());
    const focused: Array<string> = [];
    const windows = makeHerdrWindows({
      port,
      supervisor,
      focus: async (pane, socket) =>
        void focused.push(`${pane} ${socket === supervisor.socketPath()}`),
    });
    return { windows, focused, supervisor };
  });

/** Lets promises the effect waits on settle. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true });

describe("showing an agent when a window is needed", () => {
  it.effect("opens nothing when a client is attached", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({ attached: 2 });
      const { windows } = yield* windowsOver(world);
      assert.isUndefined(yield* windows.ensure);
      assert.notInclude(world.calls, "open terminal");
    }),
  );

  it.effect("opens a window when none is attached, and waits until it is", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({ attached: 0 });
      const { windows } = yield* windowsOver(world);
      const done = yield* Effect.forkChild(windows.ensure);
      yield* settle;
      assert.include(world.calls, "open terminal");
      // The fake window attaches when opened; one poll later the wait is over.
      yield* TestClock.adjust("250 millis");
      assert.isUndefined(yield* Fiber.join(done));
    }),
  );

  it.effect("stops waiting after five seconds for a window that never attaches", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({ attached: 0 });
      const { windows } = yield* windowsOver(world, {
        openTerminal: async () => ({ opened: true, via: "open" }),
      });
      const done = yield* Effect.forkChild(windows.ensure);
      yield* settle;
      yield* TestClock.adjust("4750 millis");
      assert.isUndefined(done.pollUnsafe());
      yield* TestClock.adjust("250 millis");
      assert.isUndefined(yield* Fiber.join(done));
    }),
  );

  it.effect("opens one window per run when herdr cannot say who is attached", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({ attached: "unknown" });
      const { windows } = yield* windowsOver(world);
      const first = yield* Effect.forkChild(windows.ensure);
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(first);
      yield* windows.ensure;
      assert.strictEqual(world.calls.filter((call) => call === "open terminal").length, 1);
    }),
  );

  it.effect("does nothing where the herdr in use is the person's own", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({ attached: 0, own: { version: "0.9.4", agents: [] } });
      const { windows } = yield* windowsOver(world);
      assert.isUndefined(yield* windows.ensure);
      assert.notInclude(world.calls, "open terminal");
    }),
  );

  it.effect("says why no window opened, with the command to attach by hand", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({
        attached: 0,
        terminal: { opened: false, reason: "Peer found no terminal application." },
      });
      const { windows } = yield* windowsOver(world);
      const failure = yield* windows.ensure;
      assert.match(
        failure ?? "",
        /^Peer found no terminal application\. To attach by hand, run: herdr --session peer-/,
      );
    }),
  );
});

describe("opening a terminal on the owner's request", () => {
  it.effect("always opens one, and brings the pane forward when asked", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({ attached: 1 });
      const { windows, focused } = yield* windowsOver(world);
      assert.isUndefined(yield* windows.open());
      const done = yield* Effect.forkChild(windows.open("w1:p3"));
      yield* settle;
      yield* TestClock.adjust("250 millis");
      assert.isUndefined(yield* Fiber.join(done));
      assert.strictEqual(world.calls.filter((call) => call === "open terminal").length, 2);
      assert.deepStrictEqual(focused, ["w1:p3 true"]);
    }),
  );

  it.effect("refuses where Peer has no herdr running of its own", () =>
    Effect.gen(function* () {
      const own = fakeHerdrWorld({ own: { version: "0.9.4", agents: [] } });
      assert.match((yield* (yield* windowsOver(own)).windows.open()) ?? "", /yours/);
      const none = fakeHerdrWorld({
        binary: { available: false, reason: "No herdr." },
      });
      assert.match(
        (yield* (yield* windowsOver(none)).windows.open()) ?? "",
        /no herdr of Peer's own/,
      );
    }),
  );
});
