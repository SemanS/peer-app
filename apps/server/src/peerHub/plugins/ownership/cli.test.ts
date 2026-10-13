// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDate:off - paths in the broker's checkout, the bodies the Hub was sent, and a call made 40 minutes ago.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CliError, render } from "../../core/plugin.ts";
import {
  ANA,
  BOB,
  CALLS,
  callOf,
  CYRIL,
  logged,
  NOW,
  projectOf,
  ready,
  type Route,
  VIEW,
  viewOf,
} from "./fixtures.test.ts";
import { ownerTools } from "./client/transport.ts";

type Ready = Effect.Success<ReturnType<typeof ready>>;

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const AS = { "x-peer-session": "claude:one" };
/** The plugin tells time by the clock of the runtime that runs it, which is the real one here. */
const FORTY_MINUTES_AGO = new Date(Date.now() - 40 * 60_000).toISOString();
const FEES = "src/payments/fees.ts";
const WHY = "add a refund fee field for ORD-9";
const ASK_FORM =
  'peer owner ask <path>... "<why>" (every path must be owner-decides and owned by someone else; at most 20 paths, why up to 300 characters)';

/** What a command printed, or what its refusal prints. */
const printed = async (command: Promise<string>) => {
  try {
    return await command;
  } catch (error) {
    if (error instanceof CliError) return render(error);
    throw error;
  }
};
const failure = async (command: Promise<string>) => {
  try {
    await command;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  return assert.fail("the command ended done");
};

/** `peer owner` with `args`, run by Bob's agent `one` in the checkout unless `headers` say otherwise. */
const command = async (
  peer: Ready,
  args: ReadonlyArray<string>,
  headers: Record<string, string> = AS,
) => {
  if (headers["x-peer-session"] !== undefined) await peer.fixture.register("one");
  return peer.fixture.broker["runCli"]("owner", args, {
    "x-peer-cwd": peer.fixture.root,
    ...headers,
  });
};
/** What it printed. */
const owner = (peer: Ready, args: ReadonlyArray<string>, headers?: Record<string, string>) =>
  Effect.promise(() => command(peer, args, headers));
/** The refusal it ended with. */
const ended = (peer: Ready, args: ReadonlyArray<string>, headers?: Record<string, string>) =>
  Effect.promise(() => failure(command(peer, args, headers)));
/** What it printed, or what its refusal prints. */
const shown = (peer: Ready, args: ReadonlyArray<string>) =>
  Effect.promise(() => printed(command(peer, args)));
const posts = (peer: Ready) => peer.hub.calls.filter((call) => call.method === "POST");

const opened = (over: Parameters<typeof callOf>[0] = {}) => ({
  calls: [callOf(over)],
  merged: [] as ReadonlyArray<string>,
  at: NOW,
});
/** A Hub that answers an ask with `answer` and nothing else of its own. */
const asking =
  (status: number, answer: unknown): Route =>
  (url) =>
    url === CALLS ? [status, answer] : undefined;
const refusal = (status: number, code: string, message: string) =>
  asking(status, { error: { code, message } });

describe("peer owner, for an agent", () => {
  const view = viewOf(
    projectOf({
      tasks: {
        "ord-9": { project: "app", task: "ord-9", owner: BOB, since: NOW, reason: "request" },
      },
      calls: [callOf({ state: "accepted", decidedBy: ANA })],
    }),
  );
  const changed = (peer: Ready, ...files: ReadonlyArray<string>) =>
    Effect.promise(async () => {
      await peer.fixture.register("one");
      peer.fixture.broker["sessions"].get("claude:one")!.files = [...files];
    });

  it.effect(
    "prints its task's owner, the owners of what it changed, its calls and the patterns",
    () =>
      run(
        Effect.gen(function* () {
          const peer = yield* ready({ view });
          yield* changed(peer, FEES, "tests/refunds.test.ts", "package-lock.json");
          assert.strictEqual(
            yield* owner(peer, []),
            [
              "ORD-9 Refund fee field",
              "  Owner: Bob (you), by request",
              "  Area: Payments, area owner Ana",
              "Paths your session changed:",
              `  ${FEES}    Ana · owner decides · call oc-7f2a accepted`,
              "  tests/refunds.test.ts   no owner",
              "Owner-decides patterns here: src/payments/** (Ana)",
            ].join("\n"),
          );
          // It records nothing, and asks the Hub only for what it prints.
          assert.deepStrictEqual(posts(peer), []);
        }),
      ),
  );

  it.effect("lists the calls that name nothing it changed, with how long a pending one waits", () =>
    run(
      Effect.gen(function* () {
        const waiting = callOf({
          id: "oc-9b01",
          createdAt: FORTY_MINUTES_AGO,
          paths: ["src/payments/limits.ts", "src/payments/vat.ts"],
        });
        const declined = callOf({ state: "declined", decidedBy: ANA });
        const peer = yield* ready({ view: viewOf(projectOf({ calls: [waiting, declined] })) });
        yield* changed(peer, "tests/refunds.test.ts");
        assert.include(
          yield* owner(peer, []),
          [
            "Your calls:",
            "  oc-9b01  to Ana  pending, 40 min  src/payments/limits.ts and src/payments/vat.ts",
            `  oc-7f2a  to Ana  declined  ${FEES}`,
          ].join("\n"),
        );
      }),
    ),
  );

  it.effect("says how a task came by its owner, through its area or not at all", () =>
    run(
      Effect.gen(function* () {
        const row = (reason: string, by?: string) =>
          viewOf(
            projectOf({
              tasks: {
                "ord-9": {
                  project: "app",
                  task: "ord-9",
                  owner: ANA,
                  since: NOW,
                  reason,
                  ...(by ? { by } : {}),
                },
              },
            }),
          );
        for (const [reason, by, said] of [
          ["first-agent", undefined, "by first agent"],
          ["handover", BOB, "handed over by Bob"],
          ["named", CYRIL, "named by Cyril"],
        ] as const) {
          const peer = yield* ready({ view: row(reason, by) });
          assert.include(yield* owner(peer, []), `  Owner: Ana, ${said}\n`);
        }
        const area = yield* ready({ view: viewOf() });
        assert.include(yield* owner(area, []), "  Owner: Ana, through the area Payments\n");
        const none = yield* ready({
          view: viewOf(projectOf({ map: { ...projectOf().map, areas: {} } })),
        });
        const text = yield* owner(none, []);
        assert.include(text, "ORD-9 Refund fee field\n  No owner\n");
        assert.include(text, "Area: Payments, no area owner");
        assert.include(text, "Owner-decides patterns here: src/payments/** (Ana)");
      }),
    ),
  );

  it.effect("reads the Hub, and ends refused with a step to retry while it cannot be reached", () =>
    run(
      Effect.gen(function* () {
        const current: { view: typeof view; route?: Route } = { view };
        const peer = yield* ready(current);
        yield* changed(peer);
        current.route = (url) =>
          url.startsWith(VIEW)
            ? [503, { error: { code: "down", message: "The Hub is down." } }]
            : undefined;
        const error = yield* ended(peer, []);
        assert.strictEqual(error.outcome, "refused");
        assert.strictEqual(error.next, "retry peer owner when the Hub is reachable.");
      }),
    ),
  );
});

describe("peer owner, without a session", () => {
  const MAP = [
    "Ordering demo · owner map v7",
    "Areas:  Payments  Ana",
    "Paths:  src/payments/**  Ana  owner decides",
    "        src/menu/**      Cyril",
    "Nothing was recorded.",
  ].join("\n");

  it.effect("prints the project's owner map read-only, and records nothing", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf() });
        const before = peer.fixture.broker["sessions"].size;
        assert.strictEqual(yield* owner(peer, [], {}), MAP);
        assert.strictEqual(peer.fixture.broker["sessions"].size, before);
        assert.deepStrictEqual(posts(peer), []);
        assert.strictEqual(
          (yield* Effect.promise(() => logged(peer.fixture))).filter(
            (line) => line.event === "ownership.call",
          ).length,
          0,
        );
      }),
    ),
  );

  it.effect("refuses ask and withdraw as it does a call that names no session", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf() });
        for (const args of [
          ["ask", FEES, WHY],
          ["withdraw", "oc-7f2a"],
        ]) {
          const error = yield* ended(peer, args, {});
          assert.strictEqual(error.outcome, "refused");
          assert.strictEqual(
            error.reason,
            "this call does not come from an agent session, so Peer cannot tell who is acting",
          );
          assert.include(error.next, "run peer from the shell of an agent session");
        }
        assert.deepStrictEqual(posts(peer), []);
      }),
    ),
  );

  it.effect("is refused outside a workspace project", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf() }, BOB, (host) => ({
          placeOf: async (cwd) => (cwd === "/outside" ? null : host.placeOf(cwd)),
        }));
        const error = yield* Effect.promise(() =>
          failure(peer.fixture.broker["runCli"]("owner", [], { "x-peer-cwd": "/outside" })),
        );
        assert.strictEqual(error.outcome, "refused");
      }),
    ),
  );
});

describe("peer owner ask", () => {
  it.effect("opens a call for its task, one per owner, and says what it waits for", () =>
    run(
      Effect.gen(function* () {
        const current = { view: viewOf(), route: asking(201, opened()) };
        const peer = yield* ready(current);
        assert.strictEqual(
          yield* owner(peer, ["ask", FEES, WHY]),
          `Asked Ana (call oc-7f2a, ORD-9). Your edits of ${FEES} wait for Ana’s call; it is in Ana’s Needs you, and you will hear the answer.`,
        );
        assert.deepStrictEqual(
          posts(peer).map((call) => [call.url, JSON.parse(call.body)]),
          [
            [
              CALLS,
              { environment: "ana-laptop", session: "claude:one", paths: [FEES], reason: WHY },
            ],
          ],
        );

        // Two owners, one command: a call each.
        const map = { ...projectOf().map, decide: ["src/payments/**", "src/menu/**"] };
        const both = yield* ready({
          view: viewOf(projectOf({ map })),
          route: asking(201, {
            calls: [
              callOf({ id: "oc-a" }),
              callOf({ id: "oc-c", owner: CYRIL, paths: ["src/menu/list.ts"] }),
            ],
            merged: [],
            at: NOW,
          }),
        });
        assert.strictEqual(
          yield* owner(both, ["ask", FEES, "src/menu/list.ts", WHY]),
          `Asked Ana (call oc-a, ORD-9). Asked Cyril (call oc-c, ORD-9). Your edits of ${FEES} and src/menu/list.ts wait for their calls; each is in its owner’s Needs you, and you will hear the answer.`,
        );

        const log = yield* Effect.promise(() => logged(peer.fixture));
        assert.deepStrictEqual(
          log.filter((line) => line.event === "ownership.call").map((line) => line.outcome),
          ["asked"],
        );
      }),
    ),
  );

  it.effect("says a call that already waits took the paths, and logs it as merged", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          view: viewOf(),
          route: asking(200, { ...opened(), merged: ["oc-7f2a"] }),
        });
        assert.strictEqual(
          yield* owner(peer, ["ask", FEES, WHY]),
          `Your call oc-7f2a to Ana already waits and names ${FEES}. Your edits of ${FEES} wait for Ana’s call; it is in Ana’s Needs you, and you will hear the answer.`,
        );
        const log = yield* Effect.promise(() => logged(peer.fixture));
        assert.deepStrictEqual(
          log.filter((line) => line.event === "ownership.call").map((line) => line.outcome),
          ["merged"],
        );
      }),
    ),
  );

  it.effect("reads paths as the agent types them: from a folder, absolute, a directory", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf(), route: asking(201, opened()) });
        const root = peer.fixture.root;
        const sent = () => posts(peer).map((call) => JSON.parse(call.body).paths as string[]);
        yield* owner(peer, ["ask", NodePath.join(root, FEES), "src/payments/", "why"]);
        yield* Effect.promise(() =>
          peer.fixture.broker["runCli"]("owner", ["ask", "fees.ts", "why"], {
            ...AS,
            "x-peer-cwd": NodePath.join(root, "src/payments"),
          }),
        );
        assert.deepStrictEqual(sent(), [[FEES, "src/payments/"], [FEES]]);
      }),
    ),
  );

  it.effect.each([
    [["ask"], "name the paths and say why"],
    [["ask", FEES], "name the paths and say why"],
    [["ask", FEES, "  "], "name the paths and say why"],
    [
      ["ask", FEES, "x".repeat(301)],
      "an ask names at most 20 paths, and why is up to 300 characters",
    ],
    [
      ["ask", ...Array.from({ length: 21 }, (_, at) => `src/payments/f${at}.ts`), "why"],
      "an ask names at most 20 paths, and why is up to 300 characters",
    ],
    [["ask", "../elsewhere.ts", "why"], "../elsewhere.ts is not inside this repository"],
    [["ask", "/etc/passwd", "why"], "/etc/passwd is not inside this repository"],
    [
      ["ask", "src/menu/list.ts", "why"],
      "no call is needed for src/menu/list.ts: its owner does not decide changes by others",
    ],
    [
      ["ask", "tests/refunds.test.ts", "why"],
      "no call is needed for tests/refunds.test.ts: nobody owns it",
    ],
    [
      ["ask", "--op", "again", FEES, "why"],
      "peer owner takes no flags, and ask and withdraw are its only words",
    ],
    [["frobnicate"], "peer owner takes no flags, and ask and withdraw are its only words"],
  ] as const)("ends with a usage error that sends nothing: %j", ([args, reason]) =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf(), route: asking(201, opened()) });
        const error = yield* ended(peer, args);
        assert.strictEqual(error.outcome, "usage");
        assert.strictEqual(error.reason, reason);
        assert.include(error.next, ASK_FORM);
        assert.deepStrictEqual(posts(peer), []);
      }),
    ),
  );

  it.effect("tells the owner's own agent that its own path needs no call", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf() }, ANA);
        const error = yield* ended(peer, ["ask", FEES, "why"]);
        assert.strictEqual(error.reason, `no call is needed for ${FEES}: it is yours`);
      }),
    ),
  );

  it.effect("renders a usage error as the contract says", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf() });
        const text = yield* shown(peer, ["ask", "src/menu/list.ts", "menu notes"]);
        assert.strictEqual(
          text,
          `peer: usage: no call is needed for src/menu/list.ts: its owner does not decide changes by others.\nNext: ${ASK_FORM}`,
        );
      }),
    ),
  );

  it.effect(
    "asks only for what no accepted call covers, and says nothing is needed when all is",
    () =>
      run(
        Effect.gen(function* () {
          const accepted = callOf({ state: "accepted", decidedBy: ANA });
          const peer = yield* ready({
            view: viewOf(projectOf({ calls: [accepted] })),
            route: asking(201, opened({ paths: ["src/payments/limits.ts"] })),
          });
          yield* owner(peer, ["ask", FEES, "src/payments/limits.ts", "why"]);
          assert.deepStrictEqual(
            posts(peer).map((call) => JSON.parse(call.body).paths),
            [["src/payments/limits.ts"]],
          );
          const error = yield* ended(peer, ["ask", FEES, "again"]);
          assert.strictEqual(error.outcome, "refused");
          assert.strictEqual(error.reason, `${FEES} is covered by an accepted call already`);
          assert.strictEqual(error.next, "change it; peer owner shows the call.");
          assert.strictEqual(posts(peer).length, 1);
        }),
      ),
  );

  it.effect.each([
    [
      403,
      "not_your_session",
      "report this session in your environment first",
      "refused",
      "run the command again in a moment",
    ],
    [
      409,
      "too_many_calls",
      "you have 16 owner's calls waiting; withdraw one or wait for an answer",
      "refused",
      "withdraw one with peer owner withdraw <id>",
    ],
    [
      409,
      "owner_full",
      "ana@acme.test has 64 owner's calls waiting; wait for them to answer",
      "refused",
      "wait for their calls to be answered",
    ],
    [
      403,
      "ownership_forbidden",
      "only the owner decides",
      "refused",
      "tell your person; repeating this command will not help.",
    ],
    [404, "not_found", "no such project", "refused", "run peer owner to see your calls."],
    [401, "unauthenticated", "Sign in first.", "refused", "ask your person to sign in to Peer"],
    [
      400,
      "bad_request",
      "paths: `src/menu/list.ts` needs no call: it is not a path where the owner decides",
      "usage",
      ASK_FORM,
    ],
    [503, "down", "The Hub is down.", "uncertain", "peer owner"],
  ] as const)("ends %s %s as %s, with a next step", ([status, code, message, outcome, next]) =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf(), route: refusal(status, code, message) });
        const error = yield* ended(peer, ["ask", FEES, WHY]);
        assert.strictEqual(error.outcome, outcome);
        assert.include(error.next, next);
        assert.strictEqual(
          error.reason,
          outcome === "uncertain"
            ? "the Hub did not answer, so the call may or may not have been opened"
            : error.reason,
        );
        const log = yield* Effect.promise(() => logged(peer.fixture));
        const calls = log
          .filter((line) => line.event === "ownership.call")
          .map((line) => line.outcome);
        assert.deepStrictEqual(calls, outcome === "usage" ? ["refused"] : [outcome]);
      }),
    ),
  );

  it.effect("ends uncertain, as the contract renders it, when the Hub says nothing usable", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          view: viewOf(),
          route: asking(502, "<html>bad gateway</html>"),
        });
        const text = yield* shown(peer, ["ask", FEES, WHY]);
        assert.strictEqual(
          text,
          "peer: uncertain: the Hub did not answer, so the call may or may not have been opened.\nNext: peer owner",
        );
      }),
    ),
  );
});

describe("peer owner withdraw", () => {
  const WITHDRAW = `${CALLS}/oc-7f2a/withdraw`;
  const withdrawn: Route = (url) =>
    url === WITHDRAW ? [200, { call: callOf({ state: "withdrawn" }) }] : undefined;
  const view = viewOf(
    projectOf({ calls: [callOf(), callOf({ id: "oc-9b01", session: "claude:two" })] }),
  );

  it.effect(
    "takes a call back by its id, or the start of it, naming the session and its computer",
    () =>
      run(
        Effect.gen(function* () {
          const peer = yield* ready({ view, route: withdrawn });
          const said = "Withdrew call oc-7f2a. It left Ana’s Needs you.";
          assert.strictEqual(yield* owner(peer, ["withdraw", "oc-7f2a"]), said);
          assert.strictEqual(yield* owner(peer, ["withdraw", "oc-7f"]), said);
          assert.deepStrictEqual(
            posts(peer).map((call) => [call.url, JSON.parse(call.body)]),
            [WITHDRAW, WITHDRAW].map((url) => [
              url,
              { environment: "ana-laptop", session: "claude:one" },
            ]),
          );
          const log = yield* Effect.promise(() => logged(peer.fixture));
          assert.deepStrictEqual(
            log.filter((line) => line.event === "ownership.call").map((line) => line.outcome),
            ["withdrawn", "withdrawn"],
          );
        }),
      ),
  );

  it.effect(
    "ends with a usage error for no id, several ids or an id that names several calls",
    () =>
      run(
        Effect.gen(function* () {
          const peer = yield* ready({ view, route: withdrawn });
          for (const [args, reason] of [
            [["withdraw"], "name the call to withdraw"],
            [["withdraw", "oc-7f2a", "oc-9b01"], "name the call to withdraw"],
            [["withdraw", "oc-"], "oc- names several calls"],
          ] as const) {
            const error = yield* ended(peer, args);
            assert.strictEqual(error.outcome, "usage");
            assert.strictEqual(error.reason, reason);
            assert.strictEqual(error.next, "peer owner withdraw <id>");
          }
          assert.deepStrictEqual(posts(peer), []);
        }),
      ),
  );

  it.effect.each([
    [
      409,
      "owner_call_closed",
      "this owner's call is accepted",
      "refused",
      "run peer owner to see how it ended.",
    ],
    [
      403,
      "ownership_forbidden",
      "only the person whose agent opened a call, or that agent, withdraws it",
      "refused",
      "tell your person",
    ],
    [404, "not_found", "no such owner's call", "refused", "run peer owner to see your calls."],
    [500, "broken", "The Hub failed.", "uncertain", "peer owner"],
  ] as const)("ends %s %s as %s", ([status, code, message, outcome, next]) =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          view,
          route: (url) => (url === WITHDRAW ? [status, { error: { code, message } }] : undefined),
        });
        const error = yield* ended(peer, ["withdraw", "oc-7f2a"]);
        assert.strictEqual(error.outcome, outcome);
        assert.include(error.next, next);
        if (outcome === "uncertain")
          assert.strictEqual(
            error.reason,
            "the Hub did not answer, so the call may or may not have been withdrawn",
          );
      }),
    ),
  );
});

describe("peer owner among the commands", () => {
  it.effect("is in peer help, with its words, and is the one command of the plugin", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf() });
        const help = yield* Effect.promise(() => peer.fixture.broker["runCli"]("help", [], {}));
        const line = help.split("\n").find((entry) => entry.startsWith("  peer owner"));
        assert.strictEqual(
          line,
          '  peer owner | owner ask <path>... "<why>" | owner withdraw <id>  who owns your task and paths; ask the owner of a path where they decide; take a call back',
        );
        // `peer owner --help` is the same help, from any terminal and without a credential.
        assert.strictEqual(
          yield* Effect.promise(() => peer.fixture.broker["runCli"]("owner", ["--help"], {})),
          help,
        );
        for (const form of ["peer owner", "owner ask", "owner withdraw"])
          assert.include(help, form);
      }),
    ),
  );

  it.effect("is every command the user docs name for owners and owner's calls", () =>
    run(
      Effect.gen(function* () {
        const doc = NodeFS.readFileSync(
          NodePath.resolve(
            import.meta.dirname,
            "../../../../../..",
            "docs/user/peer-coordination.md",
          ),
          "utf8",
        );
        const start = doc.indexOf("## Owners and owner's calls");
        const section = doc.slice(start, doc.indexOf("\n## ", start + 1));
        assert.isAbove(start, 0);
        const named = [...new Set([...section.matchAll(/\bpeer ([a-z]+)\b/g)].map((m) => m[1]!))];
        // The commands the section names, with their words: ask and withdraw are `peer owner`'s.
        assert.deepStrictEqual(named.toSorted(), ["done", "owner", "review"]);
        const peer = yield* ready({ view: viewOf() });
        const help = yield* Effect.promise(() => peer.fixture.broker["runCli"]("help", [], {}));
        const same = yield* Effect.promise(() =>
          peer.fixture.broker["runCli"]("owner", ["--help"], {}),
        );
        for (const word of named) assert.match(help, new RegExp(`^  peer ${word}\\b`, "m"), word);
        assert.strictEqual(same, help);
        for (const form of section.matchAll(/\bpeer owner (ask|withdraw)\b/g))
          assert.include(help, `owner ${form[1]}`);
      }),
    ),
  );

  it.effect("is refused in one line, and left out of peer help, while the plugin is off", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ view: viewOf() });
        yield* peer.peer.plugins.setPlugin({ id: "ownership", enabled: false });
        const error = yield* ended(peer, []);
        assert.strictEqual(error.reason, "owner is turned off on this environment.");
        assert.notInclude(
          yield* Effect.promise(() => peer.fixture.broker["runCli"]("help", [], {})),
          "peer owner",
        );
      }),
    ),
  );
});

describe("the tool for agents that have no shell", () => {
  const [tool] = ownerTools;

  it("maps its arguments onto the command", () => {
    assert.strictEqual(tool?.name, "peer_owner");
    assert.strictEqual(tool?.command, "owner");
    assert.deepStrictEqual(tool?.arguments({}), []);
    assert.deepStrictEqual(tool?.arguments({ action: "show" }), []);
    assert.deepStrictEqual(
      tool?.arguments({ action: "ask", paths: [FEES, "src/payments/b.ts"], why: "fees" }),
      ["ask", FEES, "src/payments/b.ts", "fees"],
    );
    assert.deepStrictEqual(tool?.arguments({ action: "withdraw", id: "oc-7f2a" }), [
      "withdraw",
      "oc-7f2a",
    ]);
  });

  it("refuses what the command could not read", () => {
    for (const input of [
      { action: "ask", paths: [FEES] },
      { action: "ask", why: "fees" },
      { action: "withdraw" },
      { action: "shout" },
    ])
      assert.throws(() => tool?.arguments(input), "Invalid owner action.");
  });
});
