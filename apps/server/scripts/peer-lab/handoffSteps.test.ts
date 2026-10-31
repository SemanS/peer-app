import { describe, expect, it } from "vite-plus/test";

import { handoffSeed, measure, problemOf, transcriptCost, type LabItem } from "./handoffSteps.ts";

const typecheck: LabItem = {
  kind: "pass",
  text: "bin/typecheck is clean",
  seen: { failed: false },
};
const fees: LabItem = { kind: "pass", text: "node --test test/fees.test.ts passes" };
const receipt: LabItem = { kind: "fail", text: "receipt test fails: cents shown as euros" };
const conflict: LabItem = { kind: "unverified", text: "spec rounds up, design rounds to nearest" };

describe("problemOf", () => {
  it("tells the scenario's three problems apart", () => {
    expect(problemOf(receipt.text)).toBe("receipt");
    expect(problemOf("TS2322 in src/fees.ts")).toBe("typecheck");
    expect(problemOf(conflict.text)).toBe("conflict");
    expect(problemOf("node --test test/fees.test.ts passes")).toBe("other");
    expect(problemOf("note.test.ts: receiptLine ignores note arg")).toBe("receipt");
  });
});

describe("measure", () => {
  it("scores the intended path: all owed cleared, one question, nothing wrong", () => {
    expect(
      measure({
        items: [
          typecheck,
          fees,
          { ...receipt, task: "inv-2" },
          { ...conflict, owner: "ana@acme.test" },
        ],
        delivered: true,
        typecheckClean: true,
      }),
    ).toEqual({
      owedCleared: 4,
      owedOf: 4,
      questions: 1,
      wrongEscapes: 0,
      wrongCalls: 0,
      seen: { items: 1, of: 3 },
    });
  });

  it("counts a failure with no home, an unnamed conflict and work not pushed as a person's", () => {
    const got = measure({
      items: [typecheck, receipt, conflict],
      delivered: false,
      typecheckClean: true,
    });
    expect(got.owedCleared).toBe(2);
    expect(got.questions).toBe(3);
    expect(got.wrongCalls).toBe(1);
  });

  it("calls a machine failure sent to a person or parked on a task wrong", () => {
    const got = measure({
      items: [
        { kind: "fail", text: "typecheck fails", task: "inv-2" },
        { kind: "unverified", text: "receipt test", owner: "ana@acme.test" },
        { ...conflict, owner: "ana@acme.test" },
      ],
      delivered: true,
      typecheckClean: false,
    });
    expect(got.wrongEscapes).toBe(1);
    expect(got.wrongCalls).toBe(1);
  });

  it("counts no report as owed and asked", () => {
    const got = measure({ items: undefined, delivered: true, typecheckClean: true });
    expect(got.owedCleared).toBe(2);
    expect(got.questions).toBe(1);
    expect(got.seen).toEqual({ items: 0, of: 0 });
  });
});

describe("transcriptCost", () => {
  it("counts a reply once, at its last usage, and keeps cache reads apart", () => {
    const line = (id: string, output: number) =>
      JSON.stringify({
        type: "assistant",
        message: {
          id,
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 100,
            output_tokens: output,
          },
        },
      });
    const text = [line("a", 1), line("a", 5), line("b", 7), '{"type":"user"}', ""].join("\n");
    expect(transcriptCost(text)).toEqual({ replies: 2, input: 24, output: 12, cacheRead: 200 });
  });
});

describe("handoffSeed", () => {
  it("seeds both sides of the conflict and a test that settles neither", () => {
    const seed = handoffSeed("/bin/tsc");
    expect(seed["openspec/changes/fees/spec.md"]).toContain("rounded up");
    expect(seed["openspec/changes/fees/design.md"]).toContain("nearest whole cent");
    expect(seed["test/fees.test.ts"]).not.toMatch(/round/i);
  });
});
