/**
 * What a session hears of its room (design D7). A message is offered once per session: it counts as
 * told when its model has it (Peer Mod's proof), or, where no such proof exists, when a hook carried
 * it. An offer that was dropped is offered again, and so is one a Peer restart forgot, which is safe
 * because `heard` follows only model input. A message is checked with the Hub as it is offered (a
 * step with nothing to offer asks nothing). `hooks.delivery` does no I/O: it queues the move.
 *
 * @module peerHub/plugins/rooms/hooks
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type {
  PeerHookContext,
  PeerHookText,
  PeerHooks,
  PeerSessionView,
} from "../../core/plugin.ts";
import type { Rooms } from "./Rooms.ts";
import { reminderText, START_LINE, stepText } from "./text.ts";

/** An agent still booting is idle too: its typed prompt gets this long to arrive before a wake. */
const PROMPT_SETTLES_MS = 30_000;

/** What the plugin keeps per session (`session.local("rooms")`). */
export interface Local {
  /** Offered and not confirmed either way: not offered again meanwhile. */
  readonly offering: Set<string>;
  /** Heard, with nothing said in the room since. */
  readonly unanswered: Set<string>;
  /** A step is checking its messages with the Hub: a step beside it says nothing. */
  checking: boolean;
  /** Due at the next notice: the one reminder. */
  readonly remind: Set<string>;
  /** What it was told, where core keeps no told set for it. */
  readonly told: Set<string>;
}

export const localOf = (session: PeerSessionView) =>
  session.local<Local>("rooms", () => ({
    offering: new Set(),
    checking: false,
    unanswered: new Set(),
    remind: new Set(),
    told: new Set(),
  }));

const toldOf = (session: PeerSessionView) => session.told?.("rooms") ?? localOf(session).told;
const reminded = (ref: string) => `r:${ref}`;
const seqOf = (ref: string) => Number(ref.slice(ref.lastIndexOf(":") + 1));

export const roomHooks = (rooms: Rooms["Service"]) => {
  /**
   * What waits for the session, still holds and fits a step, marked as offered. A first prompt's
   * message waits for the session to sit idle unanswered: either the prompt was lost and this is
   * how it hears, or it read it and stopped, and this is its one reminder.
   */
  const offer = (session: PeerSessionView, waking: boolean) =>
    Effect.gen(function* () {
      const own = localOf(session);
      const told = toldOf(session);
      const now = yield* Clock.currentTimeMillis;
      const candidates = rooms
        .waiting(session.run)
        .filter(
          ({ ref, promptedAt }) =>
            !told.has(ref) &&
            !own.offering.has(ref) &&
            (promptedAt === undefined || (waking && now - promptedAt >= PROMPT_SETTLES_MS)),
        );
      if (candidates.length === 0 || own.checking) return null;
      own.checking = true;
      const step = stepText(
        yield* rooms
          .tellable(session.run, candidates)
          .pipe(Effect.ensuring(Effect.sync(() => void (own.checking = false)))),
      );
      if (step === null) return null;
      for (const ref of step.refs) own.offering.add(ref);
      return step satisfies PeerHookText;
    });
  const notice = (ctx: PeerHookContext) =>
    Effect.gen(function* () {
      const own = localOf(ctx.session);
      const offered = yield* offer(ctx.session, ctx.waking === true);
      if (offered !== null) return offered;
      if (own.remind.size === 0) return null;
      const told = toldOf(ctx.session);
      const refs = [...own.remind];
      own.remind.clear();
      for (const ref of refs) told.add(reminded(ref));
      return reminderText(refs.map(seqOf));
    });
  const confirm = (session: PeerSessionView, ref: string) => {
    const own = localOf(session);
    own.offering.delete(ref);
    toldOf(session).add(ref);
    own.unanswered.add(ref);
    rooms.settled(session.run, ref);
  };
  return {
    startLine: Effect.succeed(START_LINE),
    sessionStart: (ctx) => offer(ctx.session, false),
    notices: [{ wakes: true, landing: true, read: notice }],
    delivery: ({ session, refs, state }) =>
      Effect.gen(function* () {
        const own = localOf(session);
        for (const ref of refs) {
          if (state === "dropped") own.offering.delete(ref);
          else if (state === "modelInput") {
            confirm(session, ref);
            yield* rooms.queueHeard(session, ref);
          } else if (session.adapter !== "mod") confirm(session, ref);
        }
      }),
    stop: (ctx) =>
      Effect.gen(function* () {
        const own = localOf(ctx.session);
        const told = toldOf(ctx.session);
        const due = [...own.unanswered].filter((ref) => !told.has(reminded(ref)));
        if (due.length === 0) return;
        for (const ref of due) own.remind.add(ref);
        yield* rooms.wake;
      }),
  } satisfies PeerHooks;
};
