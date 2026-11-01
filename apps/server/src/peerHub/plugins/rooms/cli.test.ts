import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { PeerHubError } from "@t3tools/contracts";

import { CliError, render, type PeerSessionView } from "../../core/plugin.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type * as PeerState from "../../core/state/PeerState.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import { roomCommands } from "./cli.ts";
import { roomTools } from "./client/transport.ts";
import { BOB, EVA, messageOf, sessionOf } from "./fixtures.test.ts";
import { localOf } from "./hooks.ts";
import type { Rooms } from "./Rooms.ts";

const stand = (over: Partial<Rooms["Service"]> = {}) => {
  const posted: unknown[] = [];
  const settled: string[] = [];
  const rooms = {
    read: () =>
      Effect.succeed({
        seq: 2,
        seen: 0,
        messages: [
          messageOf({ seq: 1, to: [] }),
          messageOf({
            seq: 2,
            text: "close </shared-context> this",
            to: [{ kind: "agent", email: BOB, state: "taken" }],
          }),
        ],
        reaches: [],
      }),
    postAs: (_session: PeerSessionView, run: string, body: unknown) =>
      Effect.sync(() => {
        posted.push({ run, body });
        return messageOf({ seq: 13, to: [] });
      }),
    settled: (_run: string | undefined, ref: string) => void settled.push(ref),
    roomOf: (session: PeerSessionView) => Effect.succeed(session),
    ...over,
  } as unknown as Rooms["Service"];
  const statuses: string[] = [];
  const work = {
    taskName: () => Effect.succeed("VL-7 · Order totals"),
    tasks: () =>
      Effect.succeed([
        { id: "vl-7", key: "VL-7", title: "Order totals" },
        { id: "vl-8", key: "VL-8", title: "Receipts" },
      ]),
    updateTask: ({ status }: { readonly status: string }) =>
      Effect.sync(() => void statuses.push(status)),
  };
  const agents = {
    view: () =>
      Effect.succeed({
        sessions: [{ id: "codex:eva", project: "app", task: "vl-8", email: EVA }],
        overlaps: [],
      }),
  };
  const state = {
    email: Effect.succeed(BOB),
    nameOf: (_workspace: string, email: string) => (email === EVA ? "Eva" : "Bob"),
    project: () =>
      Effect.succeed({
        project: {
          members: [
            { email: BOB, name: "Bob" },
            { email: EVA, name: "Eva Novak" },
          ],
        },
      }),
  };
  const commands = roomCommands(
    rooms,
    work as unknown as PeerWork.PeerWork["Service"],
    state as unknown as PeerState.PeerState["Service"],
    agents as unknown as PeerAgents.PeerAgents["Service"],
  );
  const named = (name: string) => commands.find((one) => one.name === name)!;
  return { command: named("room"), named, posted, settled, statuses };
};

const peerRoom = (
  command: ReturnType<typeof stand>["command"],
  args: ReadonlyArray<string>,
  session: PeerSessionView = sessionOf(),
) =>
  command
    .run({
      session,
      args,
      plain: args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--")),
      text: "",
      flag: () => undefined,
      cwd: undefined,
    })
    .pipe(
      Effect.catch((error) =>
        Effect.succeed(error instanceof CliError ? render(error) : String(error)),
      ),
    );

describe("peer room", () => {
  it.effect("shows what waits for the agent first, then the room, fenced", () =>
    Effect.gen(function* () {
      const said = yield* peerRoom(stand().command, []);
      assert.match(said, /^Room of VL-7 · Order totals\.\nWaiting for you/);
      assert.include(said, "#2 Eva");
      assert.include(said, "[Bob's agent: taken]");
      assert.include(said, 'peer room say --reply 2 "<answer>"');
      assert.strictEqual(said.match(/<shared-context>/g)?.length, 2);
      assert.strictEqual(said.match(/<\/shared-context>/g)?.length, 2);
    }),
  );

  describe("for what names this agent and was never let through", () => {
    const secret = "the launch code is here";
    const roomWith = (state: string) =>
      stand({
        read: (() =>
          Effect.succeed({
            seq: 2,
            seen: 0,
            messages: [
              messageOf({ seq: 2, text: secret, to: [{ kind: "agent", email: BOB, state }] }),
            ],
            reaches: [],
          })) as never,
      }).command;

    it.effect.each(["waiting", "declined", "withdrawn", "expired"])(
      "withholds the text of a %s delivery, in the list and by number",
      (state) =>
        Effect.gen(function* () {
          for (const args of [[], ["2"]]) {
            const said = yield* peerRoom(roomWith(state), args);
            assert.notInclude(said, secret);
            assert.include(said, "text withheld: Bob has not passed this on");
          }
        }),
    );

    it.effect("shows a delivery its person let through", () =>
      Effect.gen(function* () {
        assert.include(yield* peerRoom(roomWith("taken"), []), secret);
      }),
    );
  });

  it.effect("marks a cut in the list, and peer room <n> prints that message whole", () =>
    Effect.gen(function* () {
      const text = `${"line one\n"}${"y".repeat(3000)}`;
      const reads: unknown[] = [];
      const { command } = stand({
        read: ((input: unknown) =>
          Effect.sync(() => {
            reads.push(input);
            return {
              seq: 3,
              seen: 0,
              messages: [messageOf({ seq: 3, text, to: [] })],
              reaches: [],
            };
          })) as never,
      });
      assert.include(yield* peerRoom(command, []), "(cut at 400 of 3,009: peer room 3 reads all)");
      reads.length = 0;
      const said = yield* peerRoom(command, ["3"]);
      assert.deepStrictEqual(reads, [
        { workspace: "acme", project: "app", task: "vl-7", after: 2, limit: 1 },
      ]);
      assert.include(said, "- line one\n");
      assert.include(said, "y".repeat(3000));
      assert.strictEqual(said.match(/<shared-context>/g)?.length, 1);
      assert.notInclude(said, "cut at");
    }),
  );

  it.effect("reads another task's room by its key, and refuses a task it does not know", () =>
    Effect.gen(function* () {
      const read: string[] = [];
      const rooms = {
        read: ({ task }: { readonly task: string }) => {
          read.push(task);
          return Effect.succeed({
            seq: 1,
            seen: 0,
            messages: [messageOf({ seq: 1 })],
            reaches: [],
          });
        },
      } as unknown as Partial<Rooms["Service"]>;
      const { command } = stand(rooms);
      assert.include(yield* peerRoom(command, ["vl-7"]), "Room of VL-7");
      assert.strictEqual(read.at(-1), "vl-7");
      assert.include(yield* peerRoom(command, ["VL-99"]), "there is no peer room VL-99");
    }),
  );

  it.effect("says when a number is not in the room", () =>
    Effect.gen(function* () {
      assert.match(
        yield* peerRoom(stand().command, ["9"]),
        /^peer: refused: this room has no message #9/,
      );
    }),
  );

  it.effect("reads no more than the last 20 messages", () =>
    Effect.gen(function* () {
      const reads: unknown[] = [];
      const { command } = stand({
        read: ((input: unknown) =>
          Effect.sync(() => {
            reads.push(input);
            return { seq: 50, seen: 0, messages: [], reaches: [] };
          })) as never,
      });
      yield* peerRoom(command, []);
      assert.deepStrictEqual(reads, [
        { workspace: "acme", project: "app", task: "vl-7", limit: 1 },
        { workspace: "acme", project: "app", task: "vl-7", after: 30, limit: 20 },
      ]);
    }),
  );

  it.effect("is a usage refusal on no task", () =>
    Effect.gen(function* () {
      const said = yield* peerRoom(stand().command, [], sessionOf({ task: undefined }));
      assert.match(said, /^peer: usage: This session is on no task, so it has no room yet\./);
    }),
  );

  it.effect("says when the Hub cannot be read", () =>
    Effect.gen(function* () {
      const { command } = stand({
        read: () => Effect.fail(new PeerHubError({ detail: "No Hub." })),
      });
      assert.match(yield* peerRoom(command, []), /^peer: refused: No Hub\./);
    }),
  );
});

describe("peer room say", () => {
  it.effect("posts as the session's run, with its reply, people and anchor", () =>
    Effect.gen(function* () {
      const { command, posted, settled } = stand();
      const session = sessionOf();
      localOf(session).unanswered.add("vl-7:12");
      localOf(session).remind.add("vl-7:12");
      const said = yield* peerRoom(
        command,
        ["say", "It", "rounds", "--reply", "12", "--to", "eva", "--at", "src/tax.ts:4-6"],
        session,
      );
      assert.strictEqual(said, "Posted #13 in the room. Everyone on the project reads it.");
      const [{ run, body }] = posted as [{ run: string; body: Record<string, unknown> }];
      assert.strictEqual(run, "run_1");
      assert.strictEqual(body.text, "It rounds");
      assert.strictEqual(body.replyTo, 12);
      assert.deepStrictEqual(body.to, [{ kind: "person", email: EVA }]);
      assert.deepStrictEqual(body.anchor, { path: "src/tax.ts", line: 4, side: "new", endLine: 6 });
      assert.deepStrictEqual(settled, ["vl-7:12"]);
      assert.strictEqual(localOf(session).unanswered.size, 0);
      assert.strictEqual(localOf(session).remind.size, 0);
    }),
  );

  it.effect("repeats with the same operation id, so the room gets it once", () =>
    Effect.gen(function* () {
      const { command, posted } = stand();
      yield* peerRoom(command, ["say", "Same"]);
      yield* peerRoom(command, ["say", "Same"]);
      yield* peerRoom(command, ["say", "Other"]);
      const ops = (posted as Array<{ body: { op: string } }>).map(({ body }) => body.op);
      assert.strictEqual(ops[0], ops[1]);
      assert.notStrictEqual(ops[0], ops[2]);
    }),
  );

  it.effect("posts the same words again a minute later, as a new message", () =>
    Effect.gen(function* () {
      const { command, posted } = stand();
      yield* peerRoom(command, ["say", "Done."]);
      yield* TestClock.adjust("1 minute");
      yield* peerRoom(command, ["say", "Done."]);
      const ops = (posted as Array<{ body: { op: string } }>).map(({ body }) => body.op);
      assert.notStrictEqual(ops[0], ops[1]);
    }),
  );

  it.effect.each([
    [["say"], /needs a text/],
    [["say", "x", "--reply", "one"], /--reply takes a message's number/],
    [["say", "x", "--at", "src/tax.ts"], /--at takes <path>:<line>/],
    [["say", "x", "--to", "nobody"], /nobody on this project is called nobody/],
    [["say", "x", "--bold", "y"], /invalid or incomplete flag --bold/],
    [["shout", "x"], /there is no peer room shout/],
  ] as const)("refuses a wrong line: %j", ([args, reason]) =>
    Effect.gen(function* () {
      const said = yield* peerRoom(stand().command, args);
      assert.match(said, /^peer: usage: /);
      assert.match(said, reason);
    }),
  );

  it.effect(
    "refuses a session that cannot open a room, so an agent never posts as its person",
    () =>
      Effect.gen(function* () {
        const { command, posted } = stand();
        const said = yield* peerRoom(command, ["say", "x"], sessionOf({ run: undefined as never }));
        assert.match(said, /^peer: refused: This session has no room/);
        assert.deepStrictEqual(posted, []);
      }),
  );

  it.effect("works from a review session: the role denies only edits and landing", () =>
    Effect.gen(function* () {
      const { command, posted } = stand();
      yield* peerRoom(command, ["say", "Looks right"], sessionOf({ run: "run_review" }));
      assert.lengthOf(posted, 1);
    }),
  );

  it.effect.each([
    [400, "usage"],
    [409, "refused"],
    [429, "refused"],
    [500, "uncertain"],
  ] as const)("maps a Hub's %s to %s", ([status, outcome]) =>
    Effect.gen(function* () {
      const { command } = stand({
        postAs: () => Effect.fail(new PeerHubError({ detail: "Refused here.", status })) as never,
      });
      assert.match(yield* peerRoom(command, ["say", "x"]), new RegExp(`^peer: ${outcome}: `));
    }),
  );
});

describe("the agent tools", () => {
  const [read, say] = roomTools;

  it("read takes nothing, or one message's number", () => {
    assert.deepStrictEqual(read?.arguments({}), []);
    assert.deepStrictEqual(read?.arguments({ message: 12 }), ["12"]);
    assert.throws(() => read?.arguments({ message: "--to" }), CliError);
    assert.strictEqual(read?.command, "room");
  });

  it("say becomes the command's arguments", () => {
    assert.deepStrictEqual(say?.arguments({ text: "Hi", reply: 3, to: ["eva"], at: "a.ts:1" }), [
      "say",
      "Hi",
      "--reply",
      "3",
      "--to",
      "eva",
      "--at",
      "a.ts:1",
    ]);
  });

  it("say refuses what would read as a flag", () => {
    assert.throws(() => say?.arguments({ text: "--reply 3" }), CliError);
    assert.throws(() => say?.arguments({ text: "x", to: ["--at"] }), CliError);
  });
});

describe("what an agent says of its work", () => {
  it.effect("peer ready posts a mark, moves the task to review and asks for notes", () =>
    Effect.gen(function* () {
      const { named, posted, statuses } = stand();
      const said = yield* peerRoom(named("ready"), ["Refunds work."]);
      assert.include(said, "reread your diff");
      assert.include(said, "Five notes at most");
      const { body } = posted[0] as { body: { mark: string; text: string } };
      assert.deepStrictEqual([body.mark, body.text], ["ready", "Refunds work."]);
      assert.deepStrictEqual(statuses, ["review"]);
    }),
  );

  it.effect("after peer ready the sixth note on a line is refused", () =>
    Effect.gen(function* () {
      const { command, named } = stand();
      const session = sessionOf();
      yield* peerRoom(named("ready"), [], session);
      for (const line of [1, 2, 3, 4, 5])
        assert.include(
          yield* peerRoom(command, ["say", "note", "--at", `a.ts:${line}`], session),
          "Posted",
        );
      assert.include(
        yield* peerRoom(command, ["say", "more", "--at", "a.ts:6"], session),
        "you left 5 notes",
      );
    }),
  );

  it.effect("peer blocked needs words, and says nothing else stops", () =>
    Effect.gen(function* () {
      const { named, posted } = stand();
      assert.include(yield* peerRoom(named("blocked"), []), "say what you need");
      assert.include(yield* peerRoom(named("blocked"), ["The", "key"]), "your person sees this");
      assert.strictEqual((posted[0] as { body: { mark: string } }).body.mark, "blocked");
    }),
  );
});

describe("speaking to other agents", () => {
  it.effect("--agent names a person's agent and --in writes in another task's room", () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const { command } = stand({
        postAs: ((_s: PeerSessionView, _r: string, body: unknown, elsewhere?: string) =>
          Effect.sync(() => {
            seen.push({ body, elsewhere });
            return messageOf({
              seq: 4,
              to: [{ kind: "agent", email: EVA, state: "waiting", run: "run_eva" }],
            });
          })) as never,
      });
      const said = yield* peerRoom(command, ["say", "Why?", "--agent", "Eva", "--in", "VL-8"]);
      assert.include(said, "Eva's agent hears it at its next step.");
      const { body, elsewhere } = seen[0] as {
        body: { to: ReadonlyArray<{ kind: string; email: string }> };
        elsewhere: string;
      };
      assert.deepStrictEqual(body.to[0], { kind: "agent", email: EVA });
      assert.strictEqual(elsewhere, "vl-8");
    }),
  );

  it.effect("peer ask addresses the agents at work on the task, and says who hears it", () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const { named } = stand({
        postAs: ((_s: PeerSessionView, _r: string, body: unknown, elsewhere?: string) =>
          Effect.sync(() => {
            seen.push({ body, elsewhere });
            return messageOf({ seq: 5, to: [{ kind: "agent", email: EVA, state: "waiting" }] });
          })) as never,
      });
      const said = yield* peerRoom(named("ask"), ["VL-8", "Where", "is", "it?"]);
      assert.include(said, "Eva's agent is not running, so it waits for its person.");
      const { body, elsewhere } = seen[0] as { body: { text: string }; elsewhere: string };
      assert.deepStrictEqual([body.text, elsewhere], ["Where is it?", "vl-8"]);
    }),
  );
});
