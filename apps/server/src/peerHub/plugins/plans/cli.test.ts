// @effect-diagnostics preferSchemaOverJson:off - the log lines are compared as text.
import { assert, describe, expect, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { CliError, refused, render, type PeerCommandInput } from "../../core/plugin.ts";
import { FORM_NEXT, hubOutcome, parsePlan, planCommand, type PlansCommands } from "./cli.ts";
import { ROOT, plan, relation, sessionView, voice } from "./fixtures.test.ts";
import { NO_NOTES } from "./client/resolve.ts";
import { CHALLENGE_FORM } from "./client/challenges.ts";
import { WITHDRAWN, type DeclareAnswer } from "./text.ts";

const parse = (...args: ReadonlyArray<string>) => parsePlan(args, ROOT);

describe("the peer plan grammar", () => {
  it("reads every flag, once per item", () => {
    expect(
      parse(
        "--change",
        "src/payments/fees.ts#Fee.refundCents",
        "--maybe",
        "src/payments/",
        "--uses",
        "src/tax.ts#applyTax",
        "--provides",
        "Fee.refundCents (src/payments/fees.ts): integer cents, never negative",
      ),
    ).toEqual({
      _tag: "declare",
      mode: "replace",
      items: {
        changes: [{ path: "src/payments/fees.ts", name: "Fee.refundCents" }],
        maybes: [{ path: "src/payments/" }],
        uses: [{ path: "src/tax.ts", name: "applyTax" }],
        provides: [
          {
            name: "Fee.refundCents",
            path: "src/payments/fees.ts",
            contract: "integer cents, never negative",
          },
        ],
      },
    });
  });

  it("amends, withdraws and shows", () => {
    expect(parse("--amend", "--uses", "src/tax.ts#applyTax")).toMatchObject({
      _tag: "declare",
      mode: "amend",
    });
    expect(parse("--withdraw")).toEqual({ _tag: "withdraw" });
    expect(parse()).toEqual({ _tag: "show" });
  });

  it("takes a symbol after the first #, a directory with its slash, and paths in any honest spelling", () => {
    expect(
      parse(
        "--change",
        "./src//a.ts#Order#total",
        "--maybe",
        "src/b/",
        "--uses",
        `${ROOT}/src/c.ts`,
      ),
    ).toMatchObject({
      items: {
        changes: [{ path: "src/a.ts", name: "Order#total" }],
        maybes: [{ path: "src/b/" }],
        uses: [{ path: "src/c.ts" }],
      },
    });
  });

  it("collapses exact duplicates, and of two contract lines for one symbol keeps the later", () => {
    expect(
      parse(
        "--change",
        "src/a.ts",
        "--change",
        "src/a.ts",
        "--provides",
        "f (src/a.ts): one",
        "--provides",
        "f (src/a.ts): two",
      ),
    ).toMatchObject({
      items: {
        changes: [{ path: "src/a.ts" }],
        provides: [{ name: "f", path: "src/a.ts", contract: "two" }],
      },
    });
  });

  it("accepts a contract line with backticks around its symbol, as a Provides bullet writes it", () => {
    const line = "- `Invoice.amountCents` (src/invoice.ts): integer cents, replaces amount";
    for (const value of [
      line,
      line.slice(2),
      "`Invoice.amountCents` (src/invoice.ts): integer cents, replaces amount",
    ])
      expect(parse("--provides", value)).toMatchObject({
        items: {
          provides: [
            {
              name: "Invoice.amountCents",
              path: "src/invoice.ts",
              contract: "integer cents, replaces amount",
            },
          ],
        },
      });
    expect(parse("--provides", "f (app/(group)/page.tsx): a route")).toMatchObject({
      items: { provides: [{ path: "app/(group)/page.tsx" }] },
    });
  });

  it.each([
    [["--change", "../shared/money.ts"], "../shared/money.ts is outside the repository"],
    [["--change", "../other/a.ts"], "../other/a.ts is outside the repository"],
    [["--uses", "/etc/passwd#x"], "/etc/passwd is outside the repository"],
    [["--maybe", "C:\\work\\a.ts"], "outside the repository"],
    [["--change", "src/a.ts#"], "needs a symbol of 1 to 200 characters after the #"],
    [["--change", `src/a.ts#${"n".repeat(201)}`], "needs a symbol of 1 to 200 characters"],
    [["--change", "src/dir/#x"], "is a directory, which names no symbol"],
    [["--provides", "x (../a.ts): y"], "../a.ts is outside the repository"],
    [["--provides", "x (src/dir/): y"], "a contract names a file"],
    [["--change"], "--change needs an item"],
    [["--change", "--maybe", "a.ts"], "--change needs an item"],
    [["--provides"], "--provides needs a contract line"],
    [["--bogus", "x"], "--bogus is not a flag of peer plan"],
    [["src/a.ts"], '"src/a.ts" is not a flag or the value of one'],
    [["--withdraw", "--change", "src/a.ts"], "--withdraw stands alone"],
    [["--withdraw", "--amend"], "--withdraw stands alone"],
    [["--amend"], "--amend needs at least one item to add"],
    [["--withdraw=now"], "--withdraw=now is not a flag of peer plan"],
  ] as const)("refuses %j: %s", (args, reason) => {
    const refused = parse(...args);
    assert.property(refused, "reason");
    expect("reason" in refused ? refused.reason : "").toContain(reason);
  });

  it("refuses a contract that names no path, and shows how to write one", () => {
    expect(parse("--provides", "Invoice.amountCents: integer cents")).toEqual({
      reason: 'a contract names its path: "<symbol> (<path>): <contract>"',
      next: 'pass --provides "Fee.refundCents (src/payments/fees.ts): integer cents"',
    });
  });

  it("refuses 41 changes and states the limit, but takes 40", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, at) => ["--change", `src/file${at}.ts`]).flat();
    expect(parse(...many(40))).toMatchObject({ _tag: "declare" });
    const refused = parse(...many(41));
    expect("reason" in refused ? refused.reason : "").toBe(
      "a plan holds at most 40 changes and maybes together, 40 uses and 10 contract lines; this one names 41, 0 and 0",
    );
    expect(
      parse(
        ...many(20),
        ...Array.from({ length: 21 }, (_, at) => ["--maybe", `src/m${at}.ts`]).flat(),
      ),
    ).toHaveProperty("reason");
    const lines = Array.from({ length: 11 }, (_, at) => [
      "--provides",
      `f${at} (src/a.ts): c`,
    ]).flat();
    expect(parse(...lines)).toHaveProperty("reason");
  });
});

/** A service that answers as `answers` says, and keeps what it was asked. */
const service = (answers: Partial<PlansCommands> = {}) => {
  const asked: string[] = [];
  const never = (name: string) => () => {
    asked.push(name);
    return Effect.die(`${name} was not expected`);
  };
  const commands: PlansCommands = {
    declare: never("declare"),
    show: never("show"),
    withdraw: never("withdraw"),
    publicView: never("publicView"),
    challenge: never("challenge"),
    ...answers,
  };
  const wrapped = Object.fromEntries(
    Object.entries(commands).map(([name, method]) => [
      name,
      (...input: never[]) => {
        asked.push(name);
        return (method as (...rest: never[]) => Effect.Effect<unknown>)(...input);
      },
    ]),
  ) as unknown as PlansCommands;
  return { commands: wrapped, asked };
};

/** The lines the command wrote to the coordination log. */
const logged: Array<{
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
}> = [];
const record = (event: string, fields: Readonly<Record<string, unknown>>) =>
  Effect.sync(() => void logged.push({ event, fields }));

const run = (commands: PlansCommands, args: ReadonlyArray<string>, session = sessionView()) =>
  planCommand(commands, record)
    .run({
      session,
      args,
      plain: [],
      text: "",
      flag: () => undefined,
      cwd: undefined,
    } as PeerCommandInput)
    .pipe(Effect.result);

const failure = (result: Result.Result<string, unknown>) => {
  assert.isTrue(Result.isFailure(result));
  const error = Result.isFailure(result) ? result.failure : undefined;
  assert.instanceOf(error, CliError);
  return error as CliError;
};

const recorded: DeclareAnswer = {
  plan: plan(),
  changed: true,
  mode: "replace",
  named: plan(),
  relations: [relation("r", { contract: "takes cents, returns cents" })],
  total: 1,
  notes: NO_NOTES,
  voice: voice(),
};

describe("the peer plan command", () => {
  it.effect("is one command, public, that shows how to run it in peer help", () =>
    Effect.sync(() => {
      const command = planCommand(service().commands, record);
      assert.strictEqual(command.name, "plan");
      assert.isTrue(command.public);
      for (const flag of ["--amend", "--change", "--maybe", "--uses", "--provides", "--withdraw"])
        assert.include(command.usage, flag);
    }),
  );

  it.effect("ends a bad item in a usage error that shows the form, and sends nothing", () =>
    Effect.gen(function* () {
      const { commands, asked } = service();
      const error = failure(yield* run(commands, ["--change", "../shared/money.ts"]));
      assert.strictEqual(error.outcome, "usage");
      assert.strictEqual(
        render(error),
        `peer: usage: ../shared/money.ts is outside the repository.\nNext: ${FORM_NEXT}`,
      );
      assert.deepStrictEqual(asked, []);
      const example = failure(
        yield* run(commands, ["--provides", "Fee.refundCents: integer cents"]),
      );
      assert.strictEqual(
        render(example),
        'peer: usage: a contract names its path: "<symbol> (<path>): <contract>".\nNext: pass --provides "Fee.refundCents (src/payments/fees.ts): integer cents"',
      );
    }),
  );

  it.effect("declares through the service and answers with its text", () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const { commands } = service({
        declare: (_session, input) => {
          seen.push(input);
          return Effect.succeed(recorded);
        },
      });
      const result = yield* run(commands, ["--amend", "--uses", "src/tax.ts#applyTax"]);
      assert.isTrue(Result.isSuccess(result));
      assert.include(Result.isSuccess(result) ? result.success : "", "Plan v2 recorded");
      assert.deepStrictEqual(seen, [
        {
          mode: "amend",
          items: {
            changes: [],
            maybes: [],
            uses: [{ path: "src/tax.ts", name: "applyTax" }],
            provides: [],
          },
        },
      ]);
    }),
  );

  it.effect("logs the size of a declaration's answer and the counts, never what it names", () =>
    Effect.gen(function* () {
      logged.length = 0;
      const { commands } = service({ declare: () => Effect.succeed(recorded) });
      const result = yield* run(commands, ["--change", "src/tax.ts#applyTax"]);
      const text = Result.isSuccess(result) ? result.success : "";
      assert.deepStrictEqual(
        logged.map(({ event }) => event),
        ["plans.declared"],
      );
      assert.deepStrictEqual(logged[0]?.fields, {
        session: "claude:b",
        version: 2,
        changes: 1,
        maybes: 1,
        uses: 1,
        provides: 1,
        relations: 1,
        unresolved: 0,
        chars: text.length,
        ms: 0,
      });
      assert.notInclude(JSON.stringify(logged), "src/");
      assert.notInclude(JSON.stringify(logged), "applyTax");
      // A declaration that failed logs nothing: there is no answer to size.
      logged.length = 0;
      yield* run(service({ declare: () => Effect.fail(refused("no", "no")) }).commands, [
        "--change",
        "src/a.ts",
      ]);
      assert.deepStrictEqual(logged, []);
    }),
  );

  it.effect("ends as the service decided when it fails with a CLI outcome", () =>
    Effect.gen(function* () {
      const outcome = refused("plans need a newer Peer Hub; nothing was recorded", "ask someone");
      const error = failure(
        yield* run(service({ declare: () => Effect.fail(outcome) }).commands, [
          "--change",
          "src/a.ts",
        ]),
      );
      assert.strictEqual(error, outcome);
      assert.strictEqual(hubOutcome(outcome, true), outcome);
    }),
  );

  it.effect("maps the Hub's errors as peer-cli-contract does", () =>
    Effect.gen(function* () {
      const hub = (over: ConstructorParameters<typeof PeerHubError>[0]) =>
        run(service({ declare: () => Effect.fail(new PeerHubError(over)) }).commands, [
          "--change",
          "src/a.ts",
        ]);
      assert.strictEqual(
        failure(yield* hub({ detail: "a plan holds at most 40", status: 400, refused: true }))
          .outcome,
        "usage",
      );
      for (const status of [403, 404, 409])
        assert.strictEqual(
          failure(yield* hub({ detail: "no", status, refused: true, code: "x" })).outcome,
          "refused",
        );
      for (const over of [
        { detail: "Could not reach the hub.", kind: "unreachable" },
        { detail: "The hub is down.", status: 503 },
        { detail: "odd answer", kind: "invalid" },
      ])
        assert.strictEqual(
          failure(
            yield* run(service({ withdraw: () => Effect.fail(new PeerHubError(over)) }).commands, [
              "--withdraw",
            ]),
          ).outcome,
          "uncertain",
        );
      const signedOut = failure(
        yield* hub({ detail: "Sign in first.", refused: true, kind: "signedOut" }),
      );
      assert.strictEqual(signedOut.outcome, "refused");
      assert.include(signedOut.next, "sign in");
    }),
  );

  it.effect("only ever refuses a read, which has nothing to repeat", () =>
    Effect.gen(function* () {
      const error = failure(
        yield* run(
          service({
            show: () => Effect.fail(new PeerHubError({ detail: "Could not reach the hub." })),
          }).commands,
          [],
        ),
      );
      assert.strictEqual(error.outcome, "refused");
      assert.strictEqual(hubOutcome(error, true), error);
    }),
  );

  it.effect("withdraws, and refuses to withdraw what is not there", () =>
    Effect.gen(function* () {
      const ended = (count: number) =>
        service({ withdraw: () => Effect.succeed({ ended: count }) }).commands;
      assert.deepStrictEqual(yield* run(ended(1), ["--withdraw"]), Result.succeed(WITHDRAWN));
      const none = failure(yield* run(ended(0), ["--withdraw"]));
      assert.strictEqual(
        render(none),
        "peer: refused: this session has no plan to withdraw.\nNext: declare one with peer plan --change <path[#symbol]>.",
      );
      const silent = failure(
        yield* run(
          service({
            withdraw: () => Effect.fail(new PeerHubError({ detail: "Could not reach the hub." })),
          }).commands,
          ["--withdraw"],
        ),
      );
      assert.strictEqual(silent.outcome, "uncertain");
    }),
  );

  it.effect(
    "lists the project's live plans for a shell that is no agent, and records nothing",
    () =>
      Effect.gen(function* () {
        const { commands, asked } = service({
          publicView: () => Effect.succeed({ project: "pay", plans: [plan()], voice: voice() }),
        });
        const result = yield* run(commands, [], sessionView({ public: true, id: "" }));
        assert.isTrue(Result.isSuccess(result));
        assert.include(
          Result.isSuccess(result) ? result.success : "",
          "Live plans in pay (read-only):",
        );
        assert.deepStrictEqual(asked, ["publicView"]);
        for (const args of [["--change", "src/a.ts"], ["--withdraw"]]) {
          const refused = failure(
            yield* run(commands, args, sessionView({ public: true, id: "" })),
          );
          assert.strictEqual(refused.outcome, "refused");
        }
        assert.deepStrictEqual(asked, ["publicView"]);
      }),
  );

  it.effect("shows an agent its own plan", () =>
    Effect.gen(function* () {
      const { commands } = service({
        show: () => Effect.succeed({ plan: plan(), relations: [], total: 0, voice: voice() }),
      });
      const result = yield* run(commands, []);
      assert.isTrue(Result.isSuccess(result));
      assert.include(
        Result.isSuccess(result) ? result.success : "",
        "Plan v2 · declared 12 min ago",
      );
    }),
  );
});

describe("the peer plan challenge grammar", () => {
  const reason = (raw: ReadonlyArray<string>) => {
    const got = parse("challenge", ...raw);
    return "_tag" in got ? "" : got.reason;
  };

  it("reads a challenge, a close with or without a note, a show and a list", () => {
    expect(parse("challenge", "./src//money.ts#formatPrice", "--reason", " takes\teuros ")).toEqual(
      {
        _tag: "challenge",
        form: "record",
        item: { path: "src/money.ts", name: "formatPrice" },
        reason: "takes euros",
      },
    );
    expect(parse("challenge", "--close", "ch-1", "--note", "takes cents")).toEqual({
      _tag: "challenge",
      form: "close",
      id: "ch-1",
      note: "takes cents",
    });
    expect(parse("challenge", "--close", "ch-1")).toEqual({
      _tag: "challenge",
      form: "close",
      id: "ch-1",
    });
    expect(parse("challenge", "--show", "ch-1")).toEqual({
      _tag: "challenge",
      form: "show",
      id: "ch-1",
    });
    expect(parse("challenge")).toEqual({ _tag: "challenge", form: "list" });
  });

  it("refuses what is no challenge, naming the problem, with the challenge's form as Next", () => {
    expect(reason(["../other.ts", "--reason", "x"])).toBe("../other.ts is outside the repository");
    expect(reason(["src/a.ts", "--reason", ""])).toBe(
      "a challenge needs a reason of 1 to 400 characters",
    );
    // Only what a reader sees counts: a reason of invisible characters is empty.
    expect(reason(["src/a.ts", "--reason", "\u200b\u200b"])).toContain("a reason of 1 to 400");
    expect(reason(["src/a.ts", "--reason", "x".repeat(401)])).toBe(
      "the reason has 401 characters; a challenge takes at most 400",
    );
    expect(parse("challenge", "src/a.ts", "--reason", "x".repeat(400))).toHaveProperty("_tag");
    expect(reason(["--close", "ch-1", "--note", "n".repeat(401)])).toContain("the note has 401");
    expect(reason(["src/a.ts"])).toBe('a challenge of src/a.ts needs --reason "<why>"');
    expect(reason(["--reason", "x"])).toBe("--reason needs the item it is about before it");
    expect(reason(["src/a.ts", "src/b.ts", "--reason", "x"])).toContain("names one item");
    expect(reason(["--note", "x"])).toBe("--note goes with --close <id>");
    expect(reason(["--show", "ch-1", "--close", "ch-1"])).toBe("--show <id> stands alone");
    expect(reason(["--close", "ch-1", "src/a.ts"])).toContain("--close <id> takes only a --note");
    expect(reason(["--close"])).toBe("--close needs a challenge id");
    expect(reason(["--show", "x".repeat(101)])).toContain("a challenge id has 1 to 100");
    expect(reason(["--force"])).toBe("--force is not a flag of peer plan challenge");
    expect(parse("challenge", "--show", "ch-1")).not.toHaveProperty("next");
    expect(parse("challenge", "--nope")).toHaveProperty("next", CHALLENGE_FORM);
  });
});

describe("the peer plan challenge command", () => {
  it.effect("is in peer plan's form", () =>
    Effect.sync(() => {
      const command = planCommand(service().commands, record);
      for (const part of ["challenge", "--reason", "--close", "--note", "--show"])
        assert.include(command.usage, part);
    }),
  );

  it.effect(
    "ends a bad challenge in a usage error with the challenge's form, and asks nothing",
    () =>
      Effect.gen(function* () {
        const { commands, asked } = service();
        const error = failure(yield* run(commands, ["challenge", "../other.ts", "--reason", "x"]));
        assert.strictEqual(
          render(error),
          `peer: usage: ../other.ts is outside the repository.\nNext: ${CHALLENGE_FORM}`,
        );
        assert.deepStrictEqual(asked, []);
      }),
  );

  it.effect("asks the service and answers with its text", () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const { commands } = service({
        challenge: (_session, request) => {
          seen.push(request);
          return Effect.succeed("Challenge ch-1 recorded");
        },
      });
      assert.deepStrictEqual(
        yield* run(commands, ["challenge", "src/a.ts", "--reason", "why"]),
        Result.succeed("Challenge ch-1 recorded"),
      );
      assert.deepStrictEqual(seen, [
        { _tag: "challenge", form: "record", item: { path: "src/a.ts" }, reason: "why" },
      ]);
    }),
  );

  it.effect(
    "ends uncertain when the Hub does not answer, saying how to check and that repeating is safe",
    () =>
      Effect.gen(function* () {
        const silent = service({
          challenge: () => Effect.fail(new PeerHubError({ detail: "Could not reach the hub." })),
        }).commands;
        for (const args of [
          ["challenge", "src/a.ts", "--reason", "why"],
          ["challenge", "--close", "ch-1"],
        ])
          assert.strictEqual(
            render(failure(yield* run(silent, args))),
            "peer: uncertain: the Hub did not answer, so peer plan challenge may or may not have taken effect.\nNext: peer plan challenge shows whether it did; repeating peer plan challenge is safe",
          );
        // A read has nothing to repeat: it is refused.
        assert.strictEqual(failure(yield* run(silent, ["challenge"])).outcome, "refused");
        const limit = failure(
          yield* run(
            service({
              challenge: () =>
                Effect.fail(
                  new PeerHubError({
                    detail: "a project holds at most 20 open challenges",
                    status: 409,
                    refused: true,
                  }),
                ),
            }).commands,
            ["challenge", "src/a.ts", "--reason", "why"],
          ),
        );
        assert.strictEqual(
          render(limit),
          "peer: refused: a project holds at most 20 open challenges.\nNext: peer plan challenge lists the project's challenges.",
        );
      }),
  );

  it.effect("lets a person's shell read challenges, never record or close one", () =>
    Effect.gen(function* () {
      const { commands, asked } = service({
        challenge: () => Effect.succeed("Nothing in the project is challenged."),
      });
      const person = sessionView({ public: true, id: "" });
      assert.isTrue(Result.isSuccess(yield* run(commands, ["challenge"], person)));
      assert.isTrue(
        Result.isSuccess(yield* run(commands, ["challenge", "--show", "ch-1"], person)),
      );
      for (const args of [
        ["challenge", "src/a.ts", "--reason", "x"],
        ["challenge", "--close", "ch-1"],
      ])
        assert.strictEqual(failure(yield* run(commands, args, person)).outcome, "refused");
      assert.deepStrictEqual(asked, ["challenge", "challenge"]);
    }),
  );
});
