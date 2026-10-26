import { describe, expect, it } from "vite-plus/test";
import type { PeerBriefLink, PeerTaskBrief } from "@t3tools/contracts";
import { briefActions, briefDiff, briefStateText, openSpecGoal } from "./openspec.ts";

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

const brief: PeerTaskBrief = {
  project: "app",
  task: "t",
  goal: "Hear programs apart.",
  checklist: [
    { text: "Split voices", done: false },
    { text: "Label programs", done: false },
  ],
  source: { kind: "openspec", repository: "app", change: "voices", fingerprint: "a" },
  savedBy: "ana@team.test",
  savedAt: "2026-10-24T10:00:00Z",
  revision: 2,
};
const link = (
  state: PeerBriefLink["state"],
  extra: Partial<PeerBriefLink> = {},
): PeerBriefLink => ({
  state,
  served: true,
  brief,
  ...extra,
});

describe("brief actions", () => {
  it("offers a way out of every state, and nothing on a Hub without briefs", () => {
    const kinds = (one: PeerBriefLink) => briefActions(one).map((action) => action.kind);
    expect(kinds(link("archived", { archivedAs: "2026-10-24-voices" }))).toEqual([
      "close",
      "relink",
      "keep",
    ]);
    expect(kinds(link("missing"))).toEqual(["relink", "keep"]);
    expect(kinds(link("changed"))).toEqual(["update", "unlink"]);
    expect(kinds(link("unlinked"))).toEqual(["edit", "relink"]);
    expect(kinds(link("current", { mappingDiffers: "voices-v2" }))).toEqual([
      "relink-mapped",
      "unlink",
    ]);
    expect(kinds(link("none", { brief: null }))).toEqual(["write"]);
    expect(briefActions(link("archived", { served: false }))).toEqual([]);
  });

  it("explains an archived change by its archive path", () => {
    expect(briefStateText(link("archived", { archivedAs: "2026-10-24-voices" }))).toContain(
      "openspec/changes/archive/2026-10-24-voices",
    );
    expect(briefStateText(link("current"))).toBeNull();
  });
});

describe("briefDiff", () => {
  it("lists added, removed and toggled items and whether the goal moved", () => {
    expect(
      briefDiff(brief, {
        goal: "Hear programs apart.",
        fingerprint: "b",
        checklist: [
          { text: "Split voices", done: true },
          { text: "Show a legend", done: false },
        ],
      }),
    ).toEqual({
      goalChanged: false,
      added: ["Show a legend"],
      removed: ["Label programs"],
      toggled: [{ text: "Split voices", done: true }],
    });
  });
});
