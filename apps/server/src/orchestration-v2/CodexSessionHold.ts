import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

/**
 * Codex keeps a thread for about 60 s after its last client leaves, and refuses every other client
 * until then. `thread/unsubscribe` returns at once, `thread/closed` follows a minute later and no
 * method unloads sooner, so waiting is the only way through. Past this bound a real client holds it.
 */
const SESSION_HOLD_BOUND = Duration.seconds(75);
const SESSION_HOLD_RETRY_INTERVAL = Duration.seconds(5);

const REFUSAL_TEXT = /already has an active writer|in use by another Codex client/iu;

export interface CodexRefusal {
  readonly message: string;
  readonly data?: unknown;
}

export const isCodexSessionHeld = (refusal: CodexRefusal): boolean => {
  const { data } = refusal;
  return typeof data === "object" && data !== null && "reason" in data
    ? data.reason === "thread_active_writer"
    : REFUSAL_TEXT.test(refusal.message);
};

/** Repeats `attempt` while `isHeld` says Codex holds the session, up to the bound. */
export const waitOutCodexSessionHold = Effect.fn("CodexSessionHold.waitOut")(function* <A, E, R>(
  attempt: Effect.Effect<A, E, R>,
  isHeld: (error: E) => boolean,
) {
  const startedAt = yield* Clock.currentTimeMillis;
  const bound = Duration.toMillis(SESSION_HOLD_BOUND);
  const interval = Duration.toMillis(SESSION_HOLD_RETRY_INTERVAL);
  while (true) {
    const result = yield* Effect.result(attempt);
    if (result._tag === "Success") return result.success;
    if (!isHeld(result.failure)) return yield* Effect.fail(result.failure);
    const elapsed = (yield* Clock.currentTimeMillis) - startedAt;
    if (elapsed + interval > bound) return yield* Effect.fail(result.failure);
    yield* Effect.sleep(SESSION_HOLD_RETRY_INTERVAL);
  }
});
