import { assert, describe, expect, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { CliError, refused, render, type PeerCommandInput } from "../../core/plugin.ts";
import { FORM_NEXT, hubOutcome, parsePlan, planCommand, type PlansCommands } from "./cli.ts";
import { ROOT, plan, relation, sessionView, voice } from "./fixtures.test.ts";
import { NO_NOTES } from "./client/resolve.ts";
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

const run = (commands: PlansCommands, args: ReadonlyArray<string>, session = sessionView()) =>
  planCommand(commands)
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
      const command = planCommand(service().commands);
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
