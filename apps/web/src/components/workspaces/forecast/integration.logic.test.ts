import { describe, expect, it } from "vite-plus/test";
import type { PeerForecast, PeerForecastPair, PeerForecastSide } from "@t3tools/contracts";
import {
  changePairRows,
  checkCommandDraft,
  checkedAgainst,
  cleanPairLine,
  pairKind,
  previewCards,
  previewCounts,
  previewSummary,
  sideNote,
} from "./integration.logic.ts";

const side = (task: string, email: string, extra: Partial<PeerForecastSide> = {}) =>
  ({
    branch: `feature/${task}`,
    email,
    task,
    title: task,
    where: "origin",
    ...extra,
  }) satisfies PeerForecastSide;
const pair = (
  a: PeerForecastSide,
  b: PeerForecastSide,
  extra: Partial<PeerForecastPair> = {},
): PeerForecastPair => ({
  workspace: "acme",
  project: "shop",
  repository: "api",
  a,
  b,
  files: [],
  more: 0,
  checkedAt: "2026-10-18T14:52:00Z",
  ...extra,
});
const ana = side("ORD-11", "ana@test", { source: "pushed", readAt: "2026-10-18T14:40:00Z" });
const eva = side("ORD-14", "eva@test", { source: "shared", readAt: "2026-10-18T14:50:00Z" });
const bob = side("ORD-12", "bob@test", { source: "live" });
const slavo = side("ORD-15", "slavo@test", { source: "live", where: "here" });
const fails = { state: "fails", output: "✖ x", at: "2026-10-18T14:50:00Z", commits: [] } as const;
const passed = { state: "passed", at: "2026-10-18T14:50:00Z", commits: [] } as const;
const now = Date.parse("2026-10-18T14:52:00Z");

// Slavo's preview from the spec: one conflict, two failing merges, three clean and passing pairs.
const pairs = [
  pair(ana, eva, { files: ["order.js"] }),
  pair(ana, bob, { check: fails }),
  pair(bob, eva, { check: fails }),
  pair(slavo, ana, { check: passed }),
  pair(slavo, bob, { check: passed }),
  pair(slavo, eva, { check: passed }),
];

describe("integration preview summary", () => {
  it("counts a conflict, merges that fail the check and clean passing pairs", () => {
    expect(previewSummary(previewCounts(pairs))).toEqual([
      "1 conflict",
      "2 merges that fail the check",
      "3 pairs merge clean and pass",
    ]);
  });
  it("does not say clean pairs pass when no check ran, and omits empty counts", () => {
    expect(previewSummary(previewCounts([pair(ana, eva), pair(ana, bob)]))).toEqual([
      "2 pairs merge clean",
    ]);
    expect(previewSummary(previewCounts([]))).toEqual([]);
    expect(previewSummary(previewCounts([pair(ana, eva, { check: passed })]))).toEqual([
      "1 pair merges clean and passes",
    ]);
  });
  it("shows conflicts before failing merges and leaves clean pairs and inherited conflicts out of the cards", () => {
    const stacked = pair(bob, eva, {
      files: ["order.js"],
      inheritedFrom: { side: "a", branch: "feature/ORD-11", task: "ORD-11" },
    });
    const cards = previewCards([pairs[1]!, stacked, pairs[0]!, pairs[3]!]);
    expect(cards.map((card) => card.kind)).toEqual(["conflict", "check-fails"]);
    expect(pairKind(stacked)).toBe("meets");
    expect(previewCounts([stacked]).conflicts).toBe(0);
  });
  it("counts a timed out check with the merges that did not pass", () => {
    const timed = pair(ana, bob, { check: { ...fails, state: "timedOut" } });
    expect(pairKind(timed)).toBe("check-fails");
  });
});

describe("where a side was read", () => {
  it("names each side's source in the footer", () => {
    expect(checkedAgainst(pairs[0]!, "slavo@test")).toBe(
      "Checked on this computer against Ana's pushed version and Eva's shared work",
    );
    expect(checkedAgainst(pairs[3]!, "slavo@test")).toBe(
      "Checked on this computer against your live work and Ana's pushed version",
    );
  });
  it("tells that a teammate's pushed version may lack their newest edits, and nothing for others", () => {
    expect(sideNote(ana, "slavo@test", now)).toContain("pushed version from 12 min ago");
    expect(sideNote(eva, "slavo@test", now)).toBeNull();
    expect(sideNote(ana, "ana@test", now)).toBeNull();
  });
});

describe("clean pair line", () => {
  it("tells when and what passed", () => {
    expect(cleanPairLine(pairs[3]!, "npm test", now)).toBe(
      "Checked on this computer 2 min ago. npm test passed.",
    );
    expect(cleanPairLine(pair(ana, eva), undefined, now)).toBe(
      "Checked on this computer just now.",
    );
  });
});

describe("the selected change's pairs", () => {
  const forecast: PeerForecast = {
    state: "on",
    teammates: true,
    tracked: 4,
    skipped: 0,
    notOnOrigin: 0,
    paused: [],
    pairs: [
      pair(ana, eva, { files: ["order.js"] }),
      pair(bob, eva, {
        files: ["order.js"],
        inheritedFrom: { side: "a", branch: "feature/ORD-11", task: "ORD-11" },
      }),
      pair(slavo, bob, { check: passed }),
    ],
  };
  const scope = { workspace: "acme", project: "shop" };
  it("tells a stacked side that it meets the conflict of the change it builds on, once", () => {
    const rows = changePairRows(forecast, { taskId: "ORD-12", bookmarks: [] }, scope);
    expect(rows.find((row) => row.meets !== null)?.meets).toBe(
      "Meets ORD-11's conflict with ORD-14",
    );
    expect(
      changePairRows(forecast, { taskId: "ORD-14", bookmarks: [] }, scope).map((row) => row.kind),
    ).toEqual(["conflict"]);
  });
  it("matches by bookmark when the change is on no task, and by project", () => {
    expect(
      changePairRows(forecast, { taskId: undefined, bookmarks: ["feature/ORD-15"] }, scope),
    ).toHaveLength(1);
    expect(
      changePairRows(forecast, { taskId: "ORD-11", bookmarks: [] }, { ...scope, project: "web" }),
    ).toEqual([]);
    expect(changePairRows("unavailable", { taskId: "ORD-11", bookmarks: [] }, scope)).toEqual([]);
  });
});

describe("check command draft", () => {
  it("trims and refuses more than 200 characters", () => {
    expect(checkCommandDraft("  npm test ")).toEqual({ value: "npm test", error: null });
    expect(checkCommandDraft("x".repeat(201)).error).toBe("At most 200 characters.");
    expect(checkCommandDraft("").value).toBe("");
  });
});
