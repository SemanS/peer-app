import { assert, describe, it } from "@effect/vitest";

import { type BoardEntry, boardLine, indexText } from "./text.ts";

const work = (handle: string, name: string, over: Partial<BoardEntry> = {}): BoardEntry => ({
  scope: `task:${handle.toLowerCase()}`,
  handle,
  name,
  agents: [],
  ...over,
});

const KRK11 = work("KRK-11", "KRK-11 · Speaker talk time", {
  agents: ["Ana's agent (Claude Code, working, on another computer: src/stats.ts, src/api.ts)"],
  activity: "1 agent: Endpoint returns seconds per speaker",
  files: ["src/stats.ts", "src/api.ts"],
});
const KRK7 = work("KRK-7", "KRK-7 · Speaker names");
const KRK18 = work("KRK-18", "Invoice export", {
  agents: ["Bob's agent (Claude Code, working: src/invoice.ts)"],
});

describe("a work on the board", () => {
  it("says who is at work on it, what they do and what they touch", () => {
    assert.strictEqual(
      boardLine(KRK11),
      "KRK-11 · Speaker talk time — Ana's agent (Claude Code, working, on another computer: src/stats.ts, src/api.ts) · doing: 1 agent: Endpoint returns seconds per speaker · files: src/stats.ts, src/api.ts",
    );
  });

  it("names its key when the title does not, and says when nobody is at work on it", () => {
    assert.strictEqual(boardLine(KRK7), "KRK-7 · Speaker names — nobody at work on it now");
    assert.include(boardLine(KRK18), "Invoice export (KRK-18) — Bob's agent");
  });

  it("leaves out what its agents do and touch when lean", () => {
    const lean = boardLine(KRK11, { lean: true });
    assert.notInclude(lean, "doing:");
    assert.notInclude(lean, "files:");
  });

  it("cuts what an agent says it does", () => {
    const line = boardLine({ ...KRK11, activity: `one line\n${"x".repeat(400)}` });
    assert.notInclude(line, "\n");
    assert.isBelow(line.length, 420);
  });
});

describe("the index of who works on what", () => {
  it("is a lean table of contents at a start, pointing at `peer index`", () => {
    assert.strictEqual(
      indexText({ works: [KRK7, KRK18], cli: "peer" }),
      [
        "Also on this project now (`peer index` lists all):",
        "- KRK-7 · Speaker names — nobody at work on it now",
        "- Invoice export (KRK-18) — Bob's agent (Claude Code, working: src/invoice.ts)",
      ].join("\n"),
    );
  });

  it("has what each work does and touches when the agent asks for it", () => {
    const text = indexText({ works: [KRK11], cli: "peer", full: true }) ?? "";
    assert.include(text, "Who works on what on this project now:");
    assert.include(text, "doing: 1 agent: Endpoint returns seconds per speaker");
    assert.include(text, "files: src/stats.ts, src/api.ts");
  });

  it("says how many works it left out", () => {
    const works = Array.from({ length: 12 }, (_, i) => work(`K-${i}`, `Work ${i}`));
    const text = indexText({ works, cli: "peer", shown: 2 }) ?? "";
    assert.include(text, "- Work 1 (K-1)");
    assert.notInclude(text, "Work 2");
    assert.include(text, "(10 more: `peer index` lists them)");
  });

  it("is nothing where there is no other work", () => {
    assert.isNull(indexText({ works: [], cli: "peer" }));
  });
});
