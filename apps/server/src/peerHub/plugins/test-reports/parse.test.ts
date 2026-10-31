import { assert, describe, it } from "@effect/vitest";

import { CliError } from "../../core/plugin.ts";
import { corrected, FORM, itemOf, parse } from "./parse.ts";

const usageOf = (args: ReadonlyArray<string>) => {
  try {
    parse(args);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  return assert.fail("parsed");
};

describe("peer tests, as typed", () => {
  it("reads the result, summary, task and repeated items, with an owner after @", () => {
    assert.deepStrictEqual(
      parse([
        "mixed",
        "Unit tests pass; the phone was not checked",
        "--pass",
        "cargo test features::handoff",
        "--unverified",
        "iPhone layout of the task page @slavo",
        "--unverified",
        "Android layout @eva@acme.test",
        "--unverified",
        "the actions consume the contract @task:3.1",
        "--unverified",
        "a note to self @Task:SEC-3-1",
        "--fail",
        "e2e @nobody",
        "--for",
        "VL7",
      ]),
      {
        kind: "file",
        result: "mixed",
        summary: "Unit tests pass; the phone was not checked",
        task: "VL7",
        items: [
          { kind: "pass", text: "cargo test features::handoff" },
          { kind: "unverified", text: "iPhone layout of the task page", owner: "slavo" },
          { kind: "unverified", text: "Android layout", owner: "eva@acme.test" },
          // `@task:` leaves the item to a dependent task instead of a person.
          { kind: "unverified", text: "the actions consume the contract", task: "3.1" },
          { kind: "unverified", text: "a note to self", task: "SEC-3-1" },
          // Only an unverified item names an owner.
          { kind: "fail", text: "e2e @nobody" },
        ],
      },
    );
    assert.deepStrictEqual(parse(["show"]), { kind: "show", task: undefined });
    assert.deepStrictEqual(parse(["show", "VL7"]), { kind: "show", task: "VL7" });
    // An unquoted summary still reads as one.
    assert.deepInclude(parse(["pass", "all", "green"]), { summary: "all green" });
  });

  it("leaves a failed item to a task, and keeps any other @ in its text", () => {
    assert.deepStrictEqual(itemOf("fail", "malformed revision @task:3.1"), {
      kind: "fail",
      text: "malformed revision",
      task: "3.1",
    });
    assert.deepStrictEqual(itemOf("fail", "login fails for @ana"), {
      kind: "fail",
      text: "login fails for @ana",
    });
    assert.include(FORM, '--fail "<text> [@task:<key>]"');
  });

  it("reads an @ just outside an item's quotes as that item's, not the summary's", () => {
    assert.deepStrictEqual(
      parse([
        "mixed",
        "one left",
        "--fail",
        "receipt test",
        "@task:INV-2",
        "--unverified",
        "rounding",
        "@ana",
      ]),
      {
        kind: "file",
        result: "mixed",
        summary: "one left",
        task: undefined,
        items: [
          { kind: "fail", text: "receipt test", task: "INV-2" },
          { kind: "unverified", text: "rounding", owner: "ana" },
        ],
      },
    );
    const summary = parse(["pass", "--for", "INV-1", "@ana", "words"]);
    assert.strictEqual(summary.kind === "file" && summary.summary, "@ana words");
  });

  it("is a usage error when the line is wrong", () => {
    assert.strictEqual(usageOf([]).outcome, "usage");
    assert.include(usageOf(["maybe", "x"]).reason, "pass, fail, mixed or show");
    assert.include(usageOf(["pass"]).reason, "needs a summary");
    assert.include(usageOf(["pass", "x", "--pass"]).reason, "--pass needs a value");
    assert.include(usageOf(["pass", "x", "--owner", "a"]).reason, "unknown flag --owner");
    assert.include(usageOf(["show", "a", "b"]).reason, "at most one task");
  });

  it("says why a result is stored as mixed", () => {
    assert.deepStrictEqual(corrected("pass", [{ kind: "fail" }]), {
      result: "mixed",
      why: "it has a failed item",
    });
    assert.deepStrictEqual(corrected("fail", [{ kind: "fail" }]), { result: "fail" });
    assert.deepStrictEqual(corrected("mixed", [{ kind: "pass" }]), { result: "mixed" });
  });
});
