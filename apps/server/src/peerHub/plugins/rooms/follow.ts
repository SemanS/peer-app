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
  PEER_ROOM_START_GRACE_MS,
  PeerHubError,
  type PeerRoomCapacity,
  type PeerRoomInboxItem,
  type PeerRoomMessage,
  type PeerRoomTarget,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { HeardKind } from "./text.ts";

const isHubError = Schema.is(PeerHubError);

/** One of the person's runs on the task here, as `decide` reads it. */
export interface HereRun {
  readonly id: string;
  /** A session of it is live on this computer. */
  readonly live: boolean;
  /** What carries it; undefined until this computer has read its threads since it started. */
  readonly capacity?: PeerRoomCapacity | undefined;
  /** A session of it is open, though none is live here: it may be back, so nothing starts it. */
  readonly running?: boolean;
  /** Its person continues it where it ran (a terminal, an editor); Peer cannot. */
  readonly staysPut?: boolean;
  /** Its agent runs and waits on its person before its session can start: not lost, however long. */
  readonly waiting?: boolean;
}

export type Decision =
  | { readonly do: "nothing" }
  /** A taken delivery with a live session after a restart: offered again, safe as heard needs model input. */
  | { readonly do: "offer"; readonly run: string }
  | { readonly do: "take-offer"; readonly run: string }
  | { readonly do: "take-continue"; readonly run: string }
  /** A run that reads as running with no live session: taken and queued for its next session. */
  | { readonly do: "take-queue"; readonly run: string }
  /** A taken delivery's run has no live session here yet; `ms` is left of the grace. */
  | { readonly do: "wait"; readonly ms: number }
  /** Past the grace: its session is gone. */
  | { readonly do: "lost"; readonly run: string }
  | { readonly do: "take-review" }
  | { readonly do: "take-start" }
  | { readonly do: "fail"; readonly reason: string };

/** How often a delivery looks again at an agent that waits on its person. */
const WAITING_REREAD_MS = 15_000;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A team-reach delivery: nobody's pass let it through, only the run's reach, so only that run may hear it. */
const isTeamReach = (message: PeerRoomMessage, delivery: PeerRoomTarget, me: string) =>
  !same(message.author.email, me) && delivery.by === undefined;

/** How the message reaches the agent: words only, the Hub already decided that it may. */
export function kindOf(message: PeerRoomMessage, delivery: PeerRoomTarget, me: string): HeardKind {
  if (same(message.author.email, me)) return "own";
  return delivery.by !== undefined && same(delivery.by, me) ? "passed" : "team";
}

/**
 * D6's order: a live session of the owner's run, a detached run here, else a new session or run. A
 * team-reach delivery has one run and nothing else: no other run, and never a start on its owner's
 * capacity, which only their yes pays for.
 */
export function decide(
  message: PeerRoomMessage,
  delivery: PeerRoomTarget,
  runs: ReadonlyArray<HereRun>,
  me: string,
  /** How long it has stood taken under this Peer: since the take, or since Peer started. */
  stood = 0,
  /** The room is a chat: its own agent works there, as nothing else would carry the work. */
  chat = false,
): Decision {
  const named = delivery.run;
  const reached = runs.find((run) => run.id === named);
  const team = isTeamReach(message, delivery, me);
  if (delivery.state !== "passed" && delivery.state !== "taken") return { do: "nothing" };
  if (team && delivery.state === "passed" && reached === undefined)
    return { do: "fail", reason: RUN_ENDED };
  if (team && reached !== undefined) {
    if (reached.capacity === undefined) return { do: "nothing" };
    if (reached.capacity !== "shared") return { do: "fail", reason: RUN_NOW_PERSONAL };
  }
  if (delivery.state === "taken") {
    if (named === undefined) return { do: "nothing" };
    if (reached?.live === true) return { do: "offer", run: named };
    if (reached?.waiting === true) return { do: "wait", ms: WAITING_REREAD_MS };
    return stood >= PEER_ROOM_START_GRACE_MS
      ? { do: "lost", run: named }
      : { do: "wait", ms: PEER_ROOM_START_GRACE_MS - Math.max(0, stood) };
  }
  // A model its author chose is a new session on it: an open run has its model already.
  if (same(message.author.email, me) && delivery.model !== undefined)
    return { do: chat ? "take-start" : "take-review" };
  const live = reached?.live === true ? reached : team ? undefined : runs.find((run) => run.live);
  if (live !== undefined) return { do: "take-offer", run: live.id };
  const own = same(message.author.email, me);
  const kept = reached ?? (own ? runs.find((run) => run.running || !run.staysPut) : runs[0]);
  if (kept !== undefined)
    return { do: kept.running === true ? "take-queue" : "take-continue", run: kept.id };
  return own && !chat ? { do: "take-review" } : { do: "take-start" };
}

export const SESSION_ENDED = "Its session ended before answering.";
export const NOT_RUNNING = "The agent is no longer running.";
export const RUN_ENDED = "The run this message was for has ended.";
export const RUN_NOW_PERSONAL =
  "This run is no longer on the project's shared capacity, so the team cannot reach it directly.";

/** A failed start says this; the Hub keeps it and the room shows it. */
export const NO_CHECKOUT = "This computer has no checkout of the project.";

/** A start that made a run; `typed` means its prompt was typed, not that a model read it; false when its agent runs but its prompt never reached it. */
export interface Started {
  readonly run: string;
  readonly typed: boolean;
}

export interface FollowDeps {
  readonly me: string;
  readonly runsHere: (item: PeerRoomInboxItem) => Effect.Effect<ReadonlyArray<HereRun>>;
  readonly isChat: (item: PeerRoomInboxItem) => Effect.Effect<boolean>;
  /** `take`: the one-winner step. Fails when another took it or the state moved. */
  readonly take: (
    item: PeerRoomInboxItem,
    run: string | undefined,
  ) => Effect.Effect<void, PeerHubError>;
  readonly fail: (item: PeerRoomInboxItem, reason: string) => Effect.Effect<void>;
  /** Records on a taken delivery the run a start made, which ends "may not have started". */
  readonly record: (item: PeerRoomInboxItem, run: string) => Effect.Effect<void>;
  /** The run that holds this message here, queued or told, if any. */
  readonly queuedRun: (item: PeerRoomInboxItem) => string | undefined;
  /** The run's first prompt carries it: queued all the same, as a prompt can be lost. */
  readonly prompted: (item: PeerRoomInboxItem, run: string, kind: HeardKind) => Effect.Effect<void>;
  /** A session of the run has been told this, as far as this Peer remembers. */
  readonly told: (item: PeerRoomInboxItem, run: string) => boolean;
  /** When this Peer started. */
  readonly startedAt: number;
  /** Reads the work list again in `ms`: nothing else would, on a quiet room. */
  readonly later: (ms: number) => Effect.Effect<void>;
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
    const since = Math.max(Date.parse(delivery.at ?? "") || 0, deps.startedAt);
    const stood = (yield* Clock.currentTimeMillis) - since;
    const decision = decide(
      item.message,
      delivery,
      yield* deps.runsHere(item),
      deps.me,
      stood,
      yield* deps.isChat(item),
    );
    const kind = kindOf(item.message, delivery, deps.me);
    // The agent exists from here on: a failed prompt must not read as a failed start, or Try
    // again would start a second one. It hears the message as any session of the run does.
    const started = (start: Effect.Effect<Started, PeerHubError>) =>
      start.pipe(
        Effect.matchEffect({
          onFailure: (error) => deps.fail(item, error.detail),
          onSuccess: ({ run, typed }) =>
            typed
              ? Effect.andThen(deps.prompted(item, run, kind), deps.record(item, run))
              : deps
                  .queue(item, run, kind)
                  .pipe(Effect.andThen(deps.record(item, run)), Effect.andThen(deps.wake)),
        }),
      );
    switch (decision.do) {
      case "nothing":
        return;
      case "fail":
        return yield* deps.fail(item, decision.reason);
      case "offer":
        if (deps.told(item, decision.run)) return;
        yield* deps.queue(item, decision.run, kind);
        return yield* deps.wake;
      case "wait":
        return yield* deps.later(decision.ms);
      case "lost": {
        const told = deps.told(item, decision.run);
        yield* deps.unqueue(item, decision.run);
        return yield* deps.fail(item, told ? SESSION_ENDED : NOT_RUNNING);
      }
      case "take-queue":
        yield* deps.take(item, decision.run);
        return yield* deps.queue(item, decision.run, kind);
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

/** `act` for one of many: a defect in one delivery leaves the others, and the loop, running. */
export const actOn = (deps: FollowDeps, item: PeerRoomInboxItem) =>
  act(deps, item).pipe(
    Effect.catchDefect((defect) =>
      Effect.logWarning("rooms: a delivery could not be carried", {
        task: item.task,
        seq: item.message.seq,
        defect: String(defect),
      }),
    ),
  );
