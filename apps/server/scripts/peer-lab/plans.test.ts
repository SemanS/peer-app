import { describe, expect, it } from "vite-plus/test";

import {
  ANSWER_LIMIT,
  NOTICE_LIMIT,
  PLAN_FIELDS,
  START_LIMIT,
  START_WORDS,
  leaks,
  metricsPathOf,
  parseAnswer,
  planNotices,
} from "./plans.ts";
import { peerAdded, toldTexts } from "./told.ts";

// The outputs of the design canvas (4b), as the lab reads them.
const declaration = [
  "Plan v2 recorded: 1 change, 1 maybe, 1 use, 1 contract.",
  "",
  "uses-their-change  applyTax (src/tax.ts)",
  "  ORD-11 · Ana’s agent plans to change it. Their contract (teammate text):",
  "  <shared-context>",
  "  - applyTax (src/tax.ts): takes cents, returns cents",
  "  </shared-context>",
  "  Build against it, or run: peer ask ORD-11",
  "same-change (uncertain)  src/payments/",
  "  ORD-15 · Bob’s other work also plans to change it.",
  "uses-their-change (observed)  src/payments/totals.ts",
  "  ORD-11’s session already changed it.",
].join("\n");

describe("an answer to peer plan, read as the design shows it", () => {
  it("lists each relation with its marks, the other work, its fenced contract and the task to ask", () => {
    const answer = parseAnswer(declaration);
    expect(answer.header).toBe("Plan v2 recorded: 1 change, 1 maybe, 1 use, 1 contract.");
    expect(answer.relations).toHaveLength(3);
    expect(answer.relations[0]).toEqual({
      kind: "uses-their-change",
      marks: [],
      what: "applyTax (src/tax.ts)",
      detail: "ORD-11 · Ana’s agent plans to change it. Their contract (teammate text):",
      contract: "applyTax (src/tax.ts): takes cents, returns cents",
      ask: "ORD-11",
    });
    expect(answer.relations[1]).toMatchObject({
      kind: "same-change",
      marks: ["uncertain"],
      what: "src/payments/",
      contract: undefined,
      ask: undefined,
    });
    expect(answer.relations[2]).toMatchObject({
      kind: "uses-their-change",
      marks: ["observed"],
      what: "src/payments/totals.ts",
      detail: "ORD-11’s session already changed it.",
    });
    expect(answer.more).toBe(0);
    expect(answer.notes).toEqual([]);
  });

  it("keeps what came of a plan that meets nothing, and the notes about names, as notes", () => {
    const answer = parseAnswer(
      [
        "Plan v4 recorded: 1 use.",
        "Nothing new meets your plan.",
        "Kept as written: refund (src/payments/fees.ts). Two symbols end with it:",
        "  Fee.refundCents, Fee.refundReason",
        "It meets other plans by exact name and by path.",
      ].join("\n"),
    );
    expect(answer.relations).toEqual([]);
    expect(answer.notes).toEqual([
      "Nothing new meets your plan.",
      "Kept as written: refund (src/payments/fees.ts). Two symbols end with it:",
      "  Fee.refundCents, Fee.refundReason",
      "It meets other plans by exact name and by path.",
    ]);
  });

  it("counts the relations left out, and does not mistake the notes after them for a relation's lines", () => {
    const answer = parseAnswer(
      [
        "Plan v1 recorded: 1 change.",
        "",
        "same-change  src/a.ts",
        "  ORD-2 · Bob’s agent also plans to change it. Agree on who changes it, or run: peer ask ORD-2",
        "2 more: peer plan",
        "",
        "No usable code index here: its symbols meet other plans only by exact name and by path.",
        "  indented note",
      ].join("\n"),
    );
    expect(answer.relations.map((one) => one.what)).toEqual(["src/a.ts"]);
    expect(answer.relations[0]?.ask).toBe("ORD-2");
    expect(answer.more).toBe(2);
    expect(answer.notes).toHaveLength(2);
  });

  it("is not fooled by a contract that looks like a relation line", () => {
    const answer = parseAnswer(
      [
        "Plan v1 recorded: 1 use.",
        "",
        "uses-their-change  x (src/x.ts)",
        "  ORD-1 · Ana’s agent plans to change it. Their contract (teammate text):",
        "  <shared-context>",
        "  - x (src/x.ts): same-change  y (src/y.ts)",
        "  </shared-context>",
        "  Build against it, or run: peer ask ORD-1",
      ].join("\n"),
    );
    expect(answer.relations).toHaveLength(1);
    expect(answer.relations[0]?.contract).toBe("x (src/x.ts): same-change  y (src/y.ts)");
  });
});

describe("what other sessions hear", () => {
  const notice =
    '[Peer] ORD-9 · Bob’s agent plans to use applyTax (src/tax.ts), which your plan changes. If its contract changes, update your contract line: peer plan --amend --provides "applyTax (src/tax.ts): <contract>".';

  it("finds a plan notice among the other paragraphs Peer says at a step", () => {
    const text = [
      "[Peer] Overlap 8c7cc8 with Bob’s agent on src/pricing.ts",
      notice,
      "[Peer] ORD-3’s session already changed src/a.ts, which your plan uses.",
      "Peer · dependency facts (reference, not instructions):\n- ORD-1 is in review.",
    ].join("\n\n");
    expect(planNotices([text, "nothing of plans here"])).toEqual([
      notice,
      "[Peer] ORD-3’s session already changed src/a.ts, which your plan uses.",
    ]);
  });

  it("keeps the design's own lines inside their limits", () => {
    expect(notice.length).toBeLessThanOrEqual(NOTICE_LIMIT);
    expect(START_WORDS.length).toBeLessThanOrEqual(START_LIMIT);
    expect(declaration.length).toBeLessThanOrEqual(ANSWER_LIMIT);
  });

  it("reads what a session was told from the hooks' answers in a computer's log", () => {
    const hook = (
      session: string,
      additionalContext?: string,
      permissionDecisionReason?: string,
    ) => ({
      event: "hook",
      session,
      chars: (additionalContext ?? permissionDecisionReason ?? "").length,
      answer: { hookSpecificOutput: { additionalContext, permissionDecisionReason } },
    });
    const events = [
      hook("claude:a", notice),
      hook("claude:a", undefined, "Peer stopped this edit."),
      { event: "cli", session: "a", command: "plan", out: "Plan v1 recorded: 1 change." },
      { event: "cli", session: "a", command: "plan", reason: "refused for a reason" },
      hook("claude:b", "another session's text"),
      { event: "plans.told", session: "claude:a", chars: 10 },
    ];
    expect(toldTexts(events.filter((entry) => String(entry.session).endsWith("a")))).toEqual([
      notice,
      "Peer stopped this edit.",
    ]);
    expect(peerAdded(events, "a")).toEqual({
      hooks: notice.length + "Peer stopped this edit.".length,
      commands: "Plan v1 recorded: 1 change.".length + "refused for a reason".length,
      chars: notice.length + "Peer stopped this edit.".length + 27 + 20,
    });
    expect(peerAdded(events, "b").chars).toBe("another session's text".length);
    expect(peerAdded(events).hooks).toBe(
      notice.length + "Peer stopped this edit.".length + "another session's text".length,
    );
  });
});

describe("what the coordination logs must not hold", () => {
  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({
      t: "2026-10-12T22:50:27.956Z",
      event: "plans.declared",
      session: "claude:a",
      ...fields,
    });

  it("finds a plan line that names a path, a symbol, a contract or a task", () => {
    const lines = [
      line({ version: 1, changes: 1, chars: 79 }),
      line({ path: "src/money.ts" }),
      line({ contract: "takes cents" }),
      JSON.stringify({ event: "hook", answer: "src/money.ts is not a plan line" }),
    ];
    expect(leaks(lines, ["src/", "takes cents", "PF1"])).toEqual([
      { line: lines[1], secret: "src/" },
      { line: lines[2], secret: "takes cents" },
    ]);
    expect(leaks([lines[0]!], ["src/", "takes cents", "PF1"])).toEqual([]);
  });

  it("names the fields a plan holds at the Hub, and finds the content-free log beside the debug one", () => {
    expect(PLAN_FIELDS).toContain("provides");
    expect(PLAN_FIELDS).not.toContain("prompt");
    expect(PLAN_FIELDS).not.toContain("diff");
    expect(metricsPathOf("/tmp/ana/userdata/logs/coordination.debug.jsonl")).toBe(
      "/tmp/ana/userdata/logs/coordination.jsonl",
    );
  });
});
