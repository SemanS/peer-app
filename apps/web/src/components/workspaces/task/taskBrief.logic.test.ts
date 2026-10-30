import { describe, expect, it } from "vite-plus/test";

import { hasBrief, taskBrief } from "./taskBrief.logic";

describe("taskBrief", () => {
  it("sorts a description's lines by their label and keeps their text", () => {
    const brief = taskBrief(
      [
        "Create the contract exactly as in design D3.",
        "- Outcome: one importable contract",
        "- Acceptance: CE `Structured conflict result`",
        "- Context: zod v4",
        "- Mirror the existing style",
      ].join("\n"),
    );
    expect(brief).toEqual({
      summary: "Create the contract exactly as in design D3.",
      outcome: ["one importable contract"],
      contract: ["zod v4"],
      criteria: ["CE `Structured conflict result`"],
      steps: ["Mirror the existing style"],
    });
    expect(hasBrief(brief)).toBe(true);
  });

  it("has nothing for a task without a description", () => {
    expect(hasBrief(taskBrief(undefined))).toBe(false);
  });
});
