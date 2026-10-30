/**
 * `peer room` and `peer room say`, and their tools `peer_room_read` and `peer_room_say`. Outcomes
 * follow the peer-cli-contract: a wrong line is usage, a Hub's refusal is refused, no answer is
 * uncertain, and repeating the same `say` posts once, as its operation id comes from what it says.
 *
 * @module peerHub/plugins/rooms/cli
 */
import { PeerHubError, type PeerRoomTargetInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  CliError,
  isSignedOut,
  refused,
  toldDigest,
  uncertain,
  usage,
  type PeerCommand,
  type PeerSessionView,
} from "../../core/plugin.ts";
import type * as PeerState from "../../core/state/PeerState.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import { anchorOf, FORM, personOf } from "./client/parse.ts";
import { roomText } from "./client/render.ts";
import type { Rooms } from "./Rooms.ts";
import { localOf } from "./hooks.ts";
import { NO_TASK, refOf } from "./text.ts";

const REPEAT = "repeat the same command; its operation id makes a second send do nothing.";
const SHOWN = 20;
const SAY_FLAGS = new Set(["--reply", "--to", "--at"]);

function failure(error: PeerHubError, posting: boolean): CliError {
  if (isSignedOut(error))
    return refused(error.detail, "ask your person to sign in to Peer, then repeat the command.");
  if (error.status === 400) return usage(error.detail, `run ${FORM}.`);
  if (error.status === 429)
    return refused(error.detail, "wait, or tell your person; the room keeps what was said.");
  if (
    error.refused === true ||
    error.status === 403 ||
    error.status === 404 ||
    error.status === 409
  )
    return refused(error.detail, "tell your person; repeating this command will not help.");
  return posting
    ? uncertain("room say", "the Hub gave no usable answer", REPEAT)
    : refused(error.detail, "run peer room again when the Hub is reachable.");
}

export const roomCommand = (
  rooms: Rooms["Service"],
  work: PeerWork.PeerWork["Service"],
  state: PeerState.PeerState["Service"],
): PeerCommand => {
  const nameOf = (session: PeerSessionView) => (email: string) =>
    state.nameOf(session.workspace, email);

  const read = (session: PeerSessionView, task: string) =>
    Effect.gen(function* () {
      const place = { workspace: session.workspace, project: session.project, task };
      const head = yield* rooms.read({ ...place, limit: 1 });
      const after = Math.max(0, head.seq - SHOWN);
      const { messages } = yield* rooms.read({ ...place, after, limit: SHOWN });
      const email = yield* state.email;
      const waiting = messages.filter((message) =>
        message.to.some(
          (target) =>
            target.kind === "agent" &&
            target.email === email &&
            ["passed", "taken", "heard"].includes(target.state ?? "") &&
            (target.run === undefined || target.run === session.run),
        ),
      );
      return roomText({
        taskName: yield* work.taskName(session.workspace, session.project, task),
        messages,
        waiting,
        nameOf: nameOf(session),
      });
    }).pipe(Effect.mapError((error) => failure(error, false)));

  const say = (session: PeerSessionView, args: ReadonlyArray<string>, words: string) =>
    Effect.gen(function* () {
      if (session.run === undefined)
        return yield* Effect.fail(
          refused(
            "this session has no run, so it cannot post as your person's agent",
            "ask your person to put this session on the task, then repeat the command.",
          ),
        );
      const { project } = yield* state
        .project(session.workspace, session.project)
        .pipe(Effect.mapError((error) => failure(error, false)));
      const named: string[] = [];
      let reply: string | undefined;
      let at: string | undefined;
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]!;
        if (!arg.startsWith("--")) continue;
        const value = args[i + 1];
        if (!SAY_FLAGS.has(arg) || value === undefined || value.startsWith("--"))
          return yield* Effect.fail(usage(`invalid or incomplete flag ${arg}`, `run ${FORM}.`));
        if (arg === "--to") named.push(value);
        else if (arg === "--reply") reply = value;
        else at = value;
        i += 1;
      }
      const text = words.trim();
      if (text === "")
        return yield* Effect.fail(usage("peer room say needs a text", `run ${FORM}.`));
      if (reply !== undefined && !/^[1-9]\d*$/.test(reply))
        return yield* Effect.fail(usage("--reply takes a message's number", `run ${FORM}.`));
      const parsed = yield* Effect.try({
        try: () => ({
          anchor: anchorOf(at),
          to: named.map((name): PeerRoomTargetInput => ({
            kind: "person",
            email: personOf(project.members, name),
          })),
        }),
        catch: (error) =>
          error instanceof CliError ? error : usage(String(error), `run ${FORM}.`),
      });
      const replyTo = reply === undefined ? undefined : Number(reply);
      const op = toldDigest(
        [session.run, text, reply ?? "", at ?? "", ...named.toSorted()].join("\u0000"),
      );
      const message = yield* rooms
        .postAs(session, session.run, { op, text, to: parsed.to, anchor: parsed.anchor, replyTo })
        .pipe(Effect.mapError((error) => failure(error, true)));
      const own = localOf(session);
      if (replyTo !== undefined) rooms.settled(session.run, refOf(session.task ?? "", replyTo));
      own.unanswered.clear();
      return `Posted #${message.seq} in the room. Everyone on the project reads it.`;
    });

  return {
    name: "room",
    usage: 'room | room say "<text>" [--reply <n>] [--to <person>]... [--at <path>:<line>]',
    summary: "read your task's room, or post in it as your person's agent",
    run: ({ session, args, plain }) =>
      Effect.gen(function* () {
        const task = session.task;
        if (task === undefined)
          return yield* Effect.fail(
            usage(NO_TASK, "ask your person to put this session on a task."),
          );
        const [verb, ...rest] = plain;
        if (verb === undefined) {
          if (args.length > 0)
            return yield* Effect.fail(usage("peer room takes no flags", `run ${FORM}.`));
          return yield* read(session, task);
        }
        if (verb !== "say")
          return yield* Effect.fail(
            usage(`there is no peer room ${verb.slice(0, 40)}`, `run ${FORM}.`),
          );
        return yield* say(session, args, rest.join(" "));
      }),
  };
};
