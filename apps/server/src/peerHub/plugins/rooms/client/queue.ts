/**
 * The messages waiting for each run on this computer, and what keeps them true. A message stays
 * queued until its session has it, and its delivery can end meanwhile: it expires, or a person
 * acts. The inbox read prunes what left the work list, and a message is checked with the Hub again
 * just before it is told, so a ping still on its way cannot put an ended delivery in front of a model.
 *
 * @module peerHub/plugins/rooms/client/queue
 */
import type { PeerHubError, PeerRoomInbox, PeerRoomMessage } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { refOf, STEP_MESSAGES, type Heard } from "../text.ts";

/** The Hub lists at most this many in `work`, so a full list proves nothing by leaving one out. */
const WORK_LISTED = 64;
/** A step's check of its messages, under the hook's budget; past it they wait for the next step. */
const CHECK_TIME = "800 millis";
/** What may still reach a model; anything else, a newer Hub's state included, may not. */
const TELLABLE: ReadonlySet<string> = new Set(["passed", "taken", "heard"]);

/** Whether a message as the Hub reads it now may be told to `me`'s agent. */
export const stillTellable = (message: PeerRoomMessage | undefined, me: string) =>
  message?.to.some(
    (target) =>
      target.kind === "agent" &&
      target.email.toLowerCase() === me.toLowerCase() &&
      TELLABLE.has(target.state ?? ""),
  ) === true;

export const runQueues = () => {
  const queues = new Map<string, Map<string, Heard>>();
  const remove = (keep: (heard: Heard) => boolean) => {
    for (const [run, queue] of queues) {
      for (const [ref, heard] of queue) if (!keep(heard)) queue.delete(ref);
      if (queue.size === 0) queues.delete(run);
    }
  };
  return {
    add: (run: string, heard: Heard) => {
      queues.set(run, (queues.get(run) ?? new Map<string, Heard>()).set(heard.ref, heard));
    },
    remove: (run: string | undefined, ref: string) => {
      if (run !== undefined) queues.get(run)?.delete(ref);
    },
    /** The messages waiting for a run, oldest first. */
    of: (run: string | undefined) =>
      run === undefined ? [] : [...(queues.get(run)?.values() ?? [])],
    /** Drops a workspace's messages the inbox no longer lists as work. */
    prune: (workspace: string, inbox: PeerRoomInbox) => {
      if (inbox.work.length >= WORK_LISTED) return;
      const listed = new Set(
        inbox.work.map(({ project, task, message }) => `${project}/${refOf(task, message.seq)}`),
      );
      remove(
        (heard) => heard.workspace !== workspace || listed.has(`${heard.project}/${heard.ref}`),
      );
    },
    forget: (workspace?: string) =>
      remove((heard) => heard.workspace !== workspace && workspace !== undefined),
    keep: (workspaces: ReadonlyArray<string>) =>
      remove((heard) => workspaces.includes(heard.workspace)),
  };
};

export type RunQueues = ReturnType<typeof runQueues>;

/**
 * Of `candidates`, what a step may tell: the first messages it carries are checked with the Hub,
 * the rest only counted. One that ended leaves the queue; a Hub that does not answer holds them all
 * for the next step, since telling an ended message is worse than telling it late.
 */
export const tellable = (input: {
  readonly queues: RunQueues;
  readonly run: string | undefined;
  readonly candidates: ReadonlyArray<Heard>;
  readonly me: string;
  readonly read: (heard: Heard) => Effect.Effect<PeerRoomMessage | undefined, PeerHubError>;
}) =>
  Effect.gen(function* () {
    const { candidates, me, queues, read, run } = input;
    const sure: Heard[] = [];
    for (const [at, heard] of candidates.entries()) {
      if (sure.length === STEP_MESSAGES) return [...sure, ...candidates.slice(at)];
      const now = yield* read(heard).pipe(
        Effect.map((message) => (stillTellable(message, me) ? "tell" : "drop")),
        Effect.catch((error) => Effect.succeed(error.status === 404 ? "drop" : "hold")),
      );
      if (now === "hold") return sure;
      if (now === "tell") sure.push(heard);
      else queues.remove(run, heard.ref);
    }
    return sure;
  }).pipe(
    Effect.timeoutOption(CHECK_TIME),
    Effect.map(Option.getOrElse((): ReadonlyArray<Heard> => [])),
  );
