import { describe, expect, it } from "vite-plus/test";
import { openSpecGoal } from "./openspec.ts";

describe("openSpecGoal", () => {
  it("prefers the Why section over a title and later implementation details", () => {
    expect(
      openSpecGoal(
        "# Task brief\n\n## Why\nPeople need current source.\n\nKeep context visible.\n\n## What Changes\nImplementation details.",
      ),
    ).toBe("People need current source.\n\nKeep context visible.");
  });

  it("uses the first non-title paragraph when there is no Why section", () => {
    expect(
      openSpecGoal("# Task brief\r\n\r\nA concise goal.\r\nContinued here.\r\n\r\nMore details."),
    ).toBe("A concise goal.\nContinued here.");
  });

  it("accepts a Why heading at another depth and with a closing marker", () => {
    expect(openSpecGoal("### WHY ###\nThe goal.\n#### Details\nMore.")).toBe("The goal.");
  });

  it("bounds long goals with an ellipsis without changing the original source", () => {
    const proposal = `## Why\n${"Goal ".repeat(400)}\n## What\nDetails`;
    const excerpt = openSpecGoal(proposal);
    expect(excerpt.length).toBeLessThanOrEqual(1_200);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(proposal).toContain("## What\nDetails");
  });

  it("handles empty source", () => {
    expect(openSpecGoal("  ")).toBe("");
  });
});
