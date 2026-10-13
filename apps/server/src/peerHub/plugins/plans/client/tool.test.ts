import { assert, describe, it } from "@effect/vitest";
import { CliError } from "../../../core/plugin.ts";
import { parsePlan } from "../cli.ts";
import { PlansPlugin } from "../index.ts";
import { ROOT } from "../fixtures.test.ts";
import { planTool } from "./tool.ts";
import { MAX_CHANGES, MAX_PROVIDES, MAX_USES } from "./rules.ts";

const args = (input: Record<string, unknown>) => planTool.arguments(input);
/** The usage error a bad input ends with, as the tool's caller reads it. */
const refusal = (input: Record<string, unknown>) => {
  try {
    args(input);
  } catch (error) {
    assert.instanceOf(error, CliError);
    assert.strictEqual((error as CliError).outcome, "usage");
    return (error as CliError).reason;
  }
  return assert.fail(`${JSON.stringify(input)} was not refused`);
};

describe("the peer_plan tool", () => {
  it("is the plan command, with no input it shows the plan, and takes nothing else", () => {
    assert.strictEqual(planTool.name, "peer_plan");
    assert.strictEqual(planTool.command, "plan");
    assert.deepStrictEqual(PlansPlugin.commandNames, [planTool.command]);
    assert.deepStrictEqual(args({}), []);
    const schema = planTool.inputSchema as {
      readonly additionalProperties: boolean;
      readonly properties: Record<string, { readonly maxItems?: number }>;
    };
    assert.isFalse(schema.additionalProperties);
    assert.deepStrictEqual(Object.keys(schema.properties), [
      "changes",
      "maybes",
      "uses",
      "provides",
      "amend",
      "withdraw",
    ]);
    assert.deepStrictEqual(
      [schema.properties.changes, schema.properties.uses, schema.properties.provides].map(
        (list) => list?.maxItems,
      ),
      [MAX_CHANGES, MAX_USES, MAX_PROVIDES],
    );
    // The schema is read with the tool list of every MCP session of the project.
    assert.isAtMost(JSON.stringify({ ...planTool, arguments: undefined }).length, 1_400);
  });

  it("maps its input to the command's arguments, in the order the form has them", () => {
    assert.deepStrictEqual(
      args({
        withdraw: false,
        provides: ["Fee.refundCents (src/fees.ts): integer cents"],
        uses: ["src/tax.ts#applyTax"],
        maybes: ["src/payments/"],
        changes: ["src/fees.ts#Fee.refundCents", "src/refund.ts"],
        amend: true,
      }),
      [
        "--amend",
        "--change",
        "src/fees.ts#Fee.refundCents",
        "--change",
        "src/refund.ts",
        "--maybe",
        "src/payments/",
        "--uses",
        "src/tax.ts#applyTax",
        "--provides",
        "Fee.refundCents (src/fees.ts): integer cents",
      ],
    );
    assert.deepStrictEqual(args({ withdraw: true }), ["--withdraw"]);
    assert.deepStrictEqual(args({ amend: false, changes: [] }), []);
  });

  it("gives the command what it reads as the same plan, and as a withdrawal", () => {
    const planned = parsePlan(
      args({
        amend: true,
        changes: ["src/fees.ts#Fee.refundCents"],
        uses: ["src/tax.ts#applyTax"],
        provides: ["Fee.refundCents (src/fees.ts): integer cents"],
      }),
      ROOT,
    );
    assert.deepStrictEqual(planned, {
      _tag: "declare",
      mode: "amend",
      items: {
        changes: [{ path: "src/fees.ts", name: "Fee.refundCents" }],
        maybes: [],
        uses: [{ path: "src/tax.ts", name: "applyTax" }],
        provides: [{ name: "Fee.refundCents", path: "src/fees.ts", contract: "integer cents" }],
      },
    });
    assert.deepStrictEqual(parsePlan(args({ withdraw: true }), ROOT), { _tag: "withdraw" });
    assert.deepStrictEqual(parsePlan(args({}), ROOT), { _tag: "show" });
    // An item that merely resembles a flag never reaches the command as one.
    assert.include(refusal({ changes: ["--withdraw"] }), "starts with a flag");
    assert.include(refusal({ uses: ["  --change"] }), "starts with a flag");
  });

  it("refuses what the schema does not allow, as usage, naming the input and not echoing it whole", () => {
    assert.include(refusal({ change: ["src/a.ts"] }), "change is not an input of peer_plan");
    assert.include(refusal({ changes: "src/a.ts" }), "changes is a list of text");
    assert.include(refusal({ uses: [1] }), "uses is a list of text");
    assert.include(refusal({ provides: [{ name: "x" }] }), "provides is a list of text");
    assert.include(refusal({ amend: "yes" }), "amend is true or false");
    assert.include(refusal({ withdraw: 1 }), "withdraw is true or false");
    const long = refusal({ ["x".repeat(500)]: true });
    assert.isBelow(long.length, 80);
  });
});
