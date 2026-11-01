/**
 * `peer room` and `peer room say`, and their tools `peer_room_read` and `peer_room_say`. Outcomes
 * follow the peer-cli-contract: a wrong line is usage, a Hub's refusal is refused, no answer is
 * uncertain, and repeating the same `say` within a minute posts once, as its operation id comes from
 * what it says and when; a later "Done." is a new message.
 *
 * @module peerHub/plugins/rooms/cli
 */
import {
  PeerHubError,
  type PeerRoomMark,
  type PeerRoomMessage,
  type PeerRoomTargetInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
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
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type * as PeerState from "../../core/state/PeerState.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import { anchorOf, FORM, personOf } from "./client/parse.ts";
import { isLocalRoom, LOCAL_ROOM } from "./client/local.ts";
import { hearsWhileWaiting } from "./client/queue.ts";
import { oneMessageText, roomText } from "./client/render.ts";
import type { Rooms } from "./Rooms.ts";
import { localOf } from "./hooks.ts";
import {
  BLOCKED_TEXT,
  NO_ROOM,
  NO_TASK,
  READY_NOTES,
  READY_TEXT,
  refOf,
  TOO_MANY_NOTES,
} from "./text.ts";

const REPEAT = "repeat the same command now; its operation id makes a second send do nothing.";
const SHOWN = 20;
const SAY_FLAGS = new Set(["--reply", "--to", "--agent", "--in", "--at"]);
const READY_WORDS = "Ready to look at.";
/** The most a message names on the Hub. */
const MAX_NAMED = 8;

/** Who an agent's post reaches, in words: it should know whether anyone will hear it. */
const reachedText = (message: PeerRoomMessage, nameOf: (email: string) => string) =>
  message.to
    .filter((target) => target.kind === "agent")
    .map(
      (target) =>
        `${nameOf(target.email)}'s agent ${
          hearsWhileWaiting(target)
            ? "hears it at its next step"
            : target.state === "waiting"
              ? "is not running, so it waits for its person"
              : "has it"
        }.`,
    )
    .join(" ");

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

export const roomCommands = (
  rooms: Rooms["Service"],
  work: PeerWork.PeerWork["Service"],
  state: PeerState.PeerState["Service"],
  agents: PeerAgents.PeerAgents["Service"],
): ReadonlyArray<PeerCommand> => {
  const nameOf = (session: PeerSessionView) => (email: string) =>
    isLocalRoom(session.workspace) ? "Your person" : state.nameOf(session.workspace, email);

  const taskNameOf = (session: PeerSessionView, task: string) =>
    isLocalRoom(session.workspace)
      ? Effect.succeed("this project")
      : work.taskName(session.workspace, session.project, task);

  const taskNamed = (session: PeerSessionView, word: string) =>
    Effect.flatMap(work.tasks(session.workspace, session.project), (tasks) => {
      const found = tasks.find(
        (candidate) => candidate.id === word || candidate.key?.toLowerCase() === word.toLowerCase(),
      );
      return found === undefined
        ? Effect.fail(usage(`there is no task ${word.slice(0, 40)} here`, "run peer task list."))
        : Effect.succeed(found);
    });

  /** The session with its room, which the first thing it says opens. */
  const withRoom = (session: PeerSessionView) =>
    isLocalRoom(session.workspace)
      ? Effect.succeed({ session, run: session.id, task: LOCAL_ROOM })
      : rooms
          .roomOf(session)
          .pipe(
            Effect.flatMap((opened) =>
              opened.run === undefined || opened.task === undefined
                ? Effect.fail(
                    refused(NO_ROOM, "ask your person to share this project in a workspace."),
                  )
                : Effect.succeed({ session: opened, run: opened.run, task: opened.task }),
            ),
          );

  const posted = (
    session: PeerSessionView,
    run: string,
    body: Parameters<Rooms["Service"]["postAs"]>[2],
    elsewhere?: string,
  ) =>
    rooms
      .postAs(session, run, body, elsewhere)
      .pipe(Effect.mapError((error) => failure(error, true)));

  const opOf = (run: string, ...parts: ReadonlyArray<string>) =>
    Effect.map(Clock.currentTimeMillis, (now) =>
      toldDigest([run, Math.floor(now / 60_000), ...parts].join("\u0000")),
    );

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
            (["passed", "taken", "heard"].includes(target.state ?? "") ||
              hearsWhileWaiting(target)) &&
            (target.run === undefined || target.run === session.run),
        ),
      );
      return roomText({
        taskName: yield* taskNameOf(session, task),
        messages,
        waiting,
        me: email ?? "",
        nameOf: nameOf(session),
      });
    }).pipe(Effect.mapError((error) => failure(error, false)));

  const readOne = (session: PeerSessionView, task: string, seq: number) =>
    Effect.gen(function* () {
      const place = { workspace: session.workspace, project: session.project, task };
      const { messages } = yield* rooms
        .read({ ...place, after: seq - 1, limit: 1 })
        .pipe(Effect.mapError((error) => failure(error, false)));
      const message = messages.find((candidate) => candidate.seq === seq);
      if (message === undefined)
        return yield* Effect.fail(
          refused(`this room has no message #${seq}`, "run peer room to see its numbers."),
        );
      return oneMessageText({
        taskName: yield* taskNameOf(session, task),
        message,
        me: (yield* state.email) ?? "",
        nameOf: nameOf(session),
      });
    });

  const say = Effect.fn("PeerRoomCli.say")(function* (
    asked: PeerSessionView,
    args: ReadonlyArray<string>,
    words: string,
  ) {
    const members = isLocalRoom(asked.workspace)
      ? []
      : (yield* state
          .project(asked.workspace, asked.project)
          .pipe(Effect.mapError((error) => failure(error, false)))).project.members;
    const people: string[] = [];
    const named: string[] = [];
    let reply: string | undefined;
    let at: string | undefined;
    let there: string | undefined;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]!;
      if (!arg.startsWith("--")) continue;
      const value = args[i + 1];
      if (!SAY_FLAGS.has(arg) || value === undefined || value.startsWith("--"))
        return yield* Effect.fail(usage(`invalid or incomplete flag ${arg}`, `run ${FORM}.`));
      if (arg === "--to") people.push(value);
      else if (arg === "--agent") named.push(value);
      else if (arg === "--reply") reply = value;
      else if (arg === "--in") there = value;
      else at = value;
      i += 1;
    }
    const text = words.trim();
    if (text === "") return yield* Effect.fail(usage("peer room say needs a text", `run ${FORM}.`));
    if (reply !== undefined && !/^[1-9]\d*$/.test(reply))
      return yield* Effect.fail(usage("--reply takes a message's number", `run ${FORM}.`));
    const parsed = yield* Effect.try({
      try: () => ({
        anchor: anchorOf(at),
        to: [
          ...people.map((name): PeerRoomTargetInput => ({
            kind: "person",
            email: personOf(members, name),
          })),
          ...named.map((name): PeerRoomTargetInput => ({
            kind: "agent",
            email: personOf(members, name),
          })),
        ],
      }),
      catch: (error) => (error instanceof CliError ? error : usage(String(error), `run ${FORM}.`)),
    });
    const { session, run, task } = yield* withRoom(asked);
    const own = localOf(session);
    if (parsed.anchor !== undefined && (own.readyNotes ?? 0) >= READY_NOTES)
      return yield* Effect.fail(
        refused(TOO_MANY_NOTES, "put what is left in one last note on the line that matters most."),
      );
    const elsewhere = there === undefined ? undefined : (yield* taskNamed(session, there)).id;
    const room = elsewhere ?? task;
    const replyTo = reply === undefined ? undefined : Number(reply);
    const op = yield* opOf(
      run,
      room,
      text,
      reply ?? "",
      at ?? "",
      ...[...people, ...named].toSorted(),
    );
    const message = yield* posted(
      session,
      run,
      { op, text, to: parsed.to, anchor: parsed.anchor, replyTo },
      elsewhere,
    );
    if (replyTo !== undefined) rooms.settled(run, refOf(room, replyTo));
    if (room === task) {
      own.unanswered.clear();
      own.remind.clear();
    }
    if (parsed.anchor !== undefined && own.readyNotes !== undefined) own.readyNotes += 1;
    const reached = reachedText(message, nameOf(session));
    return `Posted #${message.seq} in the room. Everyone on the project reads it.${reached === "" ? "" : ` ${reached}`}`;
  });

  /** Says what the work has come to, with no check of any kind: the person reads it when they choose. */
  const markWork = Effect.fn("PeerRoomCli.markWork")(function* (
    asked: PeerSessionView,
    mark: PeerRoomMark,
    text: string,
  ) {
    const { session, run, task } = yield* withRoom(asked);
    const op = yield* opOf(run, mark, text);
    yield* posted(session, run, { op, text, to: [], mark });
    if (mark === "ready") localOf(session).readyNotes = 0;
    if (mark === "ready" && !isLocalRoom(session.workspace))
      yield* work
        .updateTask({
          workspace: session.workspace,
          projectId: session.project,
          taskId: task,
          status: "review",
        })
        .pipe(Effect.ignore);
  });

  const ask = Effect.fn("PeerRoomCli.ask")(function* (
    asked: PeerSessionView,
    handle: string,
    question: string,
  ) {
    if (isLocalRoom(asked.workspace))
      return yield* Effect.fail(
        usage("a project on this computer has one room", 'run peer room say "<text>".'),
      );
    const { session, run, task } = yield* withRoom(asked);
    const target = yield* taskNamed(session, handle);
    const view = yield* agents.view(session.workspace);
    const others = view.sessions.filter(
      (other) =>
        other.project === session.project && other.task === target.id && other.id !== session.id,
    );
    const to = [...new Set(others.map((other) => other.email))]
      .slice(0, MAX_NAMED)
      .map((email): PeerRoomTargetInput => ({ kind: "agent", email }));
    const op = yield* opOf(run, target.id, question);
    const message = yield* posted(
      session,
      run,
      { op, text: question, to },
      target.id === task ? undefined : target.id,
    );
    const reached = reachedText(message, nameOf(session));
    return reached === ""
      ? `Asked in the room of ${target.key ?? target.title} (#${message.seq}). Nobody's agent works on it now, so the question stays there for its people.`
      : `Asked in the room of ${target.key ?? target.title} (#${message.seq}). ${reached} Their answer reaches you as a room message.`;
  });

  /**
   * Words for the agents that share this one's files sit in their rooms: that is where those agents
   * answer, and where whoever lands that work reads them. With nobody to tell they stay in its own.
   */
  const note = Effect.fn("PeerRoomCli.note")(function* (asked: PeerSessionView, text: string) {
    const { session, run, task } = yield* withRoom(asked);
    const view = yield* agents.view(session.workspace);
    const mine = view.overlaps.filter(
      (overlap) => overlap.state === "open" && overlap.sessions.includes(session.id),
    );
    const others = view.sessions.filter(
      (other) =>
        other.id !== session.id && mine.some((overlap) => overlap.sessions.includes(other.id)),
    );
    const targets = new Map<string, Set<string>>();
    for (const other of others) {
      const room = other.task ?? task;
      targets.set(room, (targets.get(room) ?? new Set()).add(other.email));
    }
    if (targets.size === 0) targets.set(task, new Set());
    const said: string[] = [];
    for (const [room, emails] of targets) {
      const to = [...emails].map((email): PeerRoomTargetInput => ({ kind: "agent", email }));
      const op = yield* opOf(run, room, text);
      const message = yield* posted(
        session,
        run,
        { op, text, to },
        room === task ? undefined : room,
      );
      said.push(reachedText(message, nameOf(session)));
    }
    return ["Posted. Everyone on the project reads it.", ...said.filter((one) => one !== "")].join(
      " ",
    );
  });

  const roomCommand: PeerCommand = {
    name: "room",
    usage:
      'room | room <n> | room <task> [<n>] | room say "<text>" [--reply <n>] [--to <person>]... [--agent <person>]... [--in <task>] [--at <path>:<line>]',
    summary: "read your task's room or another's, or post as your person's agent",
    run: ({ session, args, plain }) =>
      Effect.gen(function* () {
        const task = isLocalRoom(session.workspace) ? LOCAL_ROOM : session.task;
        const [verb, ...rest] = plain;
        // Another task's room reads as one's own: a review or a decision made there is for the
        // agents who build on that task too, and it is the only place it may be written.
        if (verb !== undefined && verb !== "say" && !/^[1-9]\d*$/.test(verb)) {
          const tasks = isLocalRoom(session.workspace)
            ? []
            : yield* work.tasks(session.workspace, session.project);
          const other = tasks.find(
            (candidate) =>
              candidate.id === verb || candidate.key?.toLowerCase() === verb.toLowerCase(),
          );
          if (other === undefined)
            return yield* Effect.fail(
              usage(`there is no peer room ${verb.slice(0, 40)}`, `run ${FORM}.`),
            );
          const [seq] = rest;
          return seq === undefined
            ? yield* read(session, other.id)
            : /^[1-9]\d*$/.test(seq)
              ? yield* readOne(session, other.id, Number(seq))
              : yield* Effect.fail(usage(`${seq.slice(0, 40)} is no message`, `run ${FORM}.`));
        }
        if (verb === "say") return yield* say(session, args, rest.join(" "));
        if (task === undefined)
          return yield* Effect.fail(usage(NO_TASK, 'peer room say "<text>" opens its room.'));
        if (verb === undefined) {
          if (args.length > 0)
            return yield* Effect.fail(usage("peer room takes no flags", `run ${FORM}.`));
          return yield* read(session, task);
        }
        return yield* readOne(session, task, Number(verb));
      }),
  };

  return [
    roomCommand,
    {
      name: "ready",
      usage: 'ready ["<what is ready>"]',
      summary: "say your work is done; your person reads it in the room",
      run: ({ session, plain }) =>
        Effect.map(
          markWork(session, "ready", plain.join(" ").trim() || READY_WORDS),
          () => READY_TEXT,
        ),
    },
    {
      name: "blocked",
      usage: 'blocked "<what you need>"',
      summary: "say that only a person can go on, and what you need from them",
      run: ({ session, plain }) => {
        const text = plain.join(" ").trim();
        return text === ""
          ? Effect.fail(
              usage("say what you need", 'run peer blocked "<what you need from your person>".'),
            )
          : Effect.map(markWork(session, "blocked", text), () => BLOCKED_TEXT);
      },
    },
    {
      name: "ask",
      usage: 'ask <task> "<question>"',
      summary: "ask the agents at work on another task, in its room",
      run: ({ session, plain }) => {
        const [handle, ...rest] = plain;
        const question = rest.join(" ").trim();
        return handle === undefined || question === ""
          ? Effect.fail(
              usage(
                "say which task and what to ask",
                'run peer ask <task> "<question>", e.g. peer ask VL1 "Where do you keep the speaker names?".',
              ),
            )
          : ask(session, handle, question);
      },
    },
    {
      name: "note",
      usage: 'note "<text>"',
      summary: "tell the agents that share your files, in your room",
      run: ({ session, plain }) => {
        const text = plain.join(" ").trim();
        return text === ""
          ? Effect.fail(
              usage("say what to note", 'run peer note "I only change submit() in pay.ts".'),
            )
          : note(session, text);
      },
    },
  ];
};
