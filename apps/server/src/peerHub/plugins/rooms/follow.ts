/**
 * What this computer does with a delivery assigned to it (design D5, D6). `decide` is the pure part:
 * it reads a delivery and the sessions and runs here, and says one thing to do. `act` carries it out
 * through `FollowDeps`. `take` always comes first: it is the one-winner step, so two reads, two
 * computers or a restart never start an agent twice. A failed or lost start never retries by itself;
 * its owner decides with Try again.
 *
 * @module peerHub/plugins/rooms/follow
 */
import {
  PeerHubError,
  type PeerRoomInboxItem,
  type PeerRoomMessage,
  type PeerRoomTarget,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { HeardKind } from "./text.ts";

const isHubError = Schema.is(PeerHubError);

/** One of the person's runs on the task here, as `decide` reads it. */
export interface HereRun {
  readonly id: string;
  /** A session of it is live on this computer. */
  readonly live: boolean;
}

export type Decision =
  | { readonly do: "nothing" }
  /** A taken delivery with a live session after a restart: offered again, safe as heard needs model input. */
  | { readonly do: "offer"; readonly run: string }
  | { readonly do: "take-offer"; readonly run: string }
  | { readonly do: "take-continue"; readonly run: string }
  | { readonly do: "take-review" }
  | { readonly do: "take-start" };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** How the message reaches the agent: words only, the Hub already decided that it may. */
export function kindOf(message: PeerRoomMessage, delivery: PeerRoomTarget, me: string): HeardKind {
  if (same(message.author.email, me)) return "own";
  return delivery.by !== undefined && same(delivery.by, me) ? "passed" : "team";
}

/** D6's order: a live session of the owner's run, a detached run here, else a new session or run. */
export function decide(
  message: PeerRoomMessage,
  delivery: PeerRoomTarget,
  runs: ReadonlyArray<HereRun>,
  me: string,
): Decision {
  const named = delivery.run;
  const live = runs.find((run) => run.live && run.id === named) ?? runs.find((run) => run.live);
  if (delivery.state === "taken")
    return named !== undefined && runs.some((run) => run.live && run.id === named)
      ? { do: "offer", run: named }
      : { do: "nothing" };
  if (delivery.state !== "passed") return { do: "nothing" };
  if (live !== undefined) return { do: "take-offer", run: live.id };
  const detached = runs.find((run) => run.id === named) ?? runs[0];
  if (detached !== undefined) return { do: "take-continue", run: detached.id };
  return same(message.author.email, me) ? { do: "take-review" } : { do: "take-start" };
}

/** A failed start says this; the Hub keeps it and the room shows it. */
export const NO_CHECKOUT = "This computer has no checkout of the project.";

/** A start that made a run; `typed` is false when its agent runs but its prompt never reached it. */
export interface Started {
  readonly run: string;
  readonly typed: boolean;
}

export interface FollowDeps {
  readonly me: string;
  readonly runsHere: (item: PeerRoomInboxItem) => Effect.Effect<ReadonlyArray<HereRun>>;
  /** `take`: the one-winner step. Fails when another took it or the state moved. */
  readonly take: (
    item: PeerRoomInboxItem,
    run: string | undefined,
  ) => Effect.Effect<void, PeerHubError>;
  readonly fail: (item: PeerRoomInboxItem, reason: string) => Effect.Effect<void>;
  /** Records on a taken delivery the run a start made, which ends "may not have started". */
  readonly record: (item: PeerRoomInboxItem, run: string) => Effect.Effect<void>;
  /** The run whose queue holds this message here, if any. */
  readonly queuedRun: (item: PeerRoomInboxItem) => string | undefined;
  /** The agent has it in its first prompt. */
  readonly heard: (item: PeerRoomInboxItem, run: string) => Effect.Effect<void>;
  /** Puts the message in the run's queue, for its notice and its next session's start. */
  readonly queue: (item: PeerRoomInboxItem, run: string, kind: HeardKind) => Effect.Effect<void>;
  readonly unqueue: (item: PeerRoomInboxItem, run: string) => Effect.Effect<void>;
  readonly wake: Effect.Effect<void>;
  /** Continues a detached run; the reason it did not start. */
  readonly continueRun: (item: PeerRoomInboxItem, run: string) => Effect.Effect<string | null>;
  /** Starts a review session. */
  readonly review: (item: PeerRoomInboxItem) => Effect.Effect<Started, PeerHubError>;
  /** Starts a working run for a passed-on message. */
  readonly start: (item: PeerRoomInboxItem) => Effect.Effect<Started, PeerHubError>;
}

/** Carries one delivery as far as this read can; a Hub that refuses `take` ends it here. */
export const act = (deps: FollowDeps, item: PeerRoomInboxItem) =>
  Effect.gen(function* () {
    const delivery = item.message.to.find(
      (target) => target.kind === "agent" && same(target.email, deps.me),
    );
    if (delivery === undefined) return;
    // A start whose run the Hub did not take yet: its agent runs, so this is all there is to do.
    const unrecorded = delivery.run === undefined ? deps.queuedRun(item) : undefined;
    if (delivery.state === "taken" && unrecorded !== undefined)
      return yield* deps.record(item, unrecorded);
    const decision = decide(item.message, delivery, yield* deps.runsHere(item), deps.me);
    const kind = kindOf(item.message, delivery, deps.me);
    // The agent exists from here on: a failed prompt must not read as a failed start, or Try
    // again would start a second one. It hears the message as any session of the run does.
    const started = (start: Effect.Effect<Started, PeerHubError>) =>
      start.pipe(
        Effect.matchEffect({
          onFailure: (error) => deps.fail(item, error.detail),
          onSuccess: ({ run, typed }) =>
            typed
              ? Effect.andThen(deps.record(item, run), deps.heard(item, run))
              : deps
                  .queue(item, run, kind)
                  .pipe(Effect.andThen(deps.record(item, run)), Effect.andThen(deps.wake)),
        }),
      );
    switch (decision.do) {
      case "nothing":
        return;
      case "offer":
        yield* deps.queue(item, decision.run, kind);
        return yield* deps.wake;
      case "take-offer":
        yield* deps.take(item, decision.run);
        yield* deps.queue(item, decision.run, kind);
        return yield* deps.wake;
      case "take-continue": {
        yield* deps.take(item, decision.run);
        yield* deps.queue(item, decision.run, kind);
        const reason = yield* deps.continueRun(item, decision.run);
        if (reason === null) return;
        yield* deps.unqueue(item, decision.run);
        return yield* deps.fail(item, reason);
      }
      case "take-review":
        yield* deps.take(item, undefined);
        return yield* started(deps.review(item));
      case "take-start":
        yield* deps.take(item, undefined);
        return yield* started(deps.start(item));
    }
  }).pipe(
    // A take someone else won, or a Hub out of reach: nothing started, the next read looks again.
    Effect.catch((error) => (isHubError(error) ? Effect.void : Effect.fail(error))),
  );
