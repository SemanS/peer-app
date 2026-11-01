import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import { isCodexSessionHeld, waitOutCodexSessionHold } from "./CodexSessionHold.ts";

const held = "held";
const isHeld = (error: string) => error === held;

/** Fails with `held` until `heldAttempts` ran, and hands each attempt to the test in turn. */
const makeAttempts = (heldAttempts: number) =>
  Effect.gen(function* () {
    let attempts = 0;
    let reached = yield* Deferred.make<void>();
    return {
      count: () => attempts,
      reached: () => Deferred.await(reached),
      attempt: Effect.suspend(() =>
        Effect.gen(function* () {
          attempts += 1;
          const current = reached;
          reached = yield* Deferred.make<void>();
          yield* Deferred.succeed(current, undefined);
          return yield* attempts > heldAttempts ? Effect.succeed("read") : Effect.fail(held);
        }),
      ),
    };
  });

describe("isCodexSessionHeld", () => {
  it("prefers the structured reason over the words", () => {
    expect(
      isCodexSessionHeld({ message: "anything", data: { reason: "thread_active_writer" } }),
    ).toBe(true);
    expect(
      isCodexSessionHeld({
        message: "in use by another Codex client",
        data: { reason: "something_else" },
      }),
    ).toBe(false);
  });

  it("reads the words when Codex sends no reason", () => {
    expect(isCodexSessionHeld({ message: "thread t already has an active writer" })).toBe(true);
    expect(isCodexSessionHeld({ message: "thread not found" })).toBe(false);
  });
});

describe("waitOutCodexSessionHold", () => {
  it.effect("keeps trying every 5 seconds until Codex lets go", () =>
    Effect.gen(function* () {
      const attempts = yield* makeAttempts(2);
      const fiber = yield* waitOutCodexSessionHold(attempts.attempt, isHeld).pipe(Effect.forkChild);

      yield* attempts.reached();
      yield* Effect.yieldNow;
      expect(attempts.count()).toBe(1);
      yield* TestClock.adjust("4 seconds");
      expect(attempts.count()).toBe(1);
      for (const expected of [2, 3]) {
        const next = attempts.reached();
        yield* TestClock.adjust(expected === 2 ? "1 second" : "5 seconds");
        yield* next;
        expect(attempts.count()).toBe(expected);
      }

      expect(yield* Fiber.join(fiber)).toBe("read");
    }),
  );

  it.effect("gives up at the bound with the refusal", () =>
    Effect.gen(function* () {
      const attempts = yield* makeAttempts(Number.POSITIVE_INFINITY);
      const fiber = yield* waitOutCodexSessionHold(attempts.attempt, isHeld).pipe(
        Effect.flip,
        Effect.forkChild,
      );

      yield* attempts.reached();
      for (let elapsed = 5; elapsed <= 75; elapsed += 5) {
        const next = attempts.reached();
        yield* TestClock.adjust("5 seconds");
        yield* next;
      }

      expect(yield* Fiber.join(fiber)).toBe(held);
      expect(attempts.count()).toBe(16);
    }),
  );

  it.effect("fails at once on anything else", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const failure = yield* waitOutCodexSessionHold(
        Effect.suspend(() => {
          attempts += 1;
          return Effect.fail("gone");
        }),
        isHeld,
      ).pipe(Effect.flip);

      expect(failure).toBe("gone");
      expect(attempts).toBe(1);
    }),
  );
});
