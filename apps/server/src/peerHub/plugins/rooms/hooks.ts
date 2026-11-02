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

import {
  isLanding,
  type PeerHookContext,
  type PeerHookText,
  type PeerHooks,
  type PeerSessionView,
  type PeerToolContext,
} from "../../core/plugin.ts";
import { isLocalRoom } from "./client/local.ts";
import type { Rooms } from "./Rooms.ts";
import { reminderText, roomLinesText, START_LINE, stepText } from "./text.ts";

/** An agent still booting is idle too: its typed prompt gets this long to arrive before a wake. */
const PROMPT_SETTLES_MS = 30_000;
/** How often agents' words may wake one session in an hour, so two agents cannot answer each other forever. */
const AGENT_WAKES = 6;
const HOUR_MS = 3_600_000;

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
  /** It heard where a shared room's other projects are. */
  projectsTold?: boolean;
  /** When agents' words woke it, in the last hour. */
  agentWakes: number[];
  /** The overlaps its room was told of. */
  readonly overlaps: Set<string>;
  /** Notes on lines since `peer ready`; absent before it. */
  readyNotes?: number;
  /** How far a landing step of this session has read its room. */
  landingRead: number;
}

export const localOf = (session: PeerSessionView) =>
  session.local<Local>("rooms", () => ({
    offering: new Set(),
    checking: false,
    unanswered: new Set(),
    remind: new Set(),
    told: new Set(),
    agentWakes: [],
    overlaps: new Set(),
    landingRead: 0,
  }));

/** Whom a queue belongs to: a run, or the session itself on a computer with no runs. */
const queueOf = (session: PeerSessionView) => session.run ?? session.id;

const toldOf = (session: PeerSessionView) => session.told?.("rooms") ?? localOf(session).told;
const reminded = (ref: string) => `r:${ref}`;
const seqOf = (ref: string) => Number(ref.slice(ref.lastIndexOf(":") + 1));

export const roomHooks = (rooms: Rooms["Service"]) => {
  const left = ({ session }: PeerHookContext) => rooms.sessionLeft(session);
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
      own.agentWakes = own.agentWakes.filter((at) => now - at < HOUR_MS);
      const wakesLeft = own.agentWakes.length < AGENT_WAKES;
      const candidates = rooms
        .waiting(queueOf(session))
        .filter(
          ({ ref, promptedAt, quiet, byAgent }) =>
            !told.has(ref) &&
            !own.offering.has(ref) &&
            (promptedAt === undefined || (waking && now - promptedAt >= PROMPT_SETTLES_MS)) &&
            !(waking && (quiet === true || (byAgent === true && !wakesLeft))),
        );
      if (candidates.length === 0 || own.checking) return null;
      own.checking = true;
      const sure = yield* rooms
        .tellable(queueOf(session), candidates)
        .pipe(Effect.ensuring(Effect.sync(() => void (own.checking = false))));
      const step = stepText(sure, session.task);
      if (step === null) return null;
      for (const ref of step.refs) own.offering.add(ref);
      if (waking && sure.some(({ byAgent }) => byAgent === true)) own.agentWakes.push(now);
      // A first prompt can be lost, and its folders with it: what reaches the agent carries them.
      const projects = own.projectsTold ? undefined : yield* rooms.projectsOf(session.run);
      if (projects === undefined) return step satisfies PeerHookText;
      own.projectsTold = true;
      return { ...step, text: `${projects}\n${step.text}` } satisfies PeerHookText;
    });
  const notice = (ctx: PeerHookContext) =>
    Effect.gen(function* () {
      const own = localOf(ctx.session);
      yield* rooms.overlapLines(ctx.session, own.overlaps);
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
    // A colleague's words may go unanswered: only its person's yes would make it answer, so no
    // reminder wakes it for them.
    const queue = queueOf(session);
    const quiet = rooms.waiting(queue).some((one) => one.ref === ref && one.quiet === true);
    if (!quiet) own.unanswered.add(ref);
    rooms.settled(queue, ref);
  };
  /** Before work lands, what its room says that this session never heard, once. */
  const beforeLanding = Effect.fn("RoomHooks.beforeLanding")(function* (
    ctx: PeerHookContext | PeerToolContext,
  ) {
    const { session } = ctx;
    const command = "command" in ctx ? ctx.command : undefined;
    if (command === undefined || !isLanding(command)) return null;
    if (session.task === undefined && !isLocalRoom(session.workspace)) return null;
    const own = localOf(session);
    const told = toldOf(session);
    const { seq, unread } = yield* rooms.unread(session, own.landingRead);
    own.landingRead = seq;
    return roomLinesText(unread.filter((line) => !told.has(line.ref)));
  });
  return {
    startLine: Effect.succeed(START_LINE),
    sessionStart: (ctx) => offer(ctx.session, false),
    sessionEnd: left,
    sessionExpired: left,
    notices: [
      { wakes: true, landing: true, read: notice },
      { wakes: false, landing: true, read: beforeLanding },
    ],
    delivery: ({ session, refs, state }) =>
      Effect.gen(function* () {
        const own = localOf(session);
        for (const ref of refs) {
          if (state === "dropped") own.offering.delete(ref);
          else if (state === "modelInput") {
            confirm(session, ref);
            yield* rooms.queueHeard(session, ref);
          } else if (session.adapter !== "mod") {
            // Its person is asked about these until the Hub hears it has them; a hook's word is all there is.
            const quiet = rooms
              .waiting(queueOf(session))
              .some((one) => one.ref === ref && one.quiet === true);
            confirm(session, ref);
            if (quiet) yield* rooms.queueHeard(session, ref);
          }
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
