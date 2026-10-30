import type { PeerRoomMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  anchorFromSelection,
  diffSourceText,
  lineInDiff,
  pathAnchor,
  placeAnchors,
  viewerSide,
  watchable,
} from "./roomDiff.logic";

const file = {
  path: "src/a.ts",
  hunks: [
    { additionStart: 10, additionCount: 5, deletionStart: 10, deletionCount: 3 },
    { additionStart: 40, additionCount: 2, deletionStart: 38, deletionCount: 2 },
  ],
};

const message = (seq: number, anchor?: PeerRoomMessage["anchor"]): PeerRoomMessage => ({
  seq,
  task: "t1",
  at: "2026-10-30T10:00:00Z",
  author: { email: "ana@acme.test" },
  text: `message ${seq}`,
  to: [],
  ...(anchor === undefined ? {} : { anchor }),
});

describe("a line selection", () => {
  it("becomes an anchor on the side and commit it was made on", () => {
    expect(anchorFromSelection("a.ts", { start: 12, end: 12, side: "additions" }, "abc")).toEqual({
      path: "a.ts",
      line: 12,
      side: "new",
      commit: "abc",
    });
    expect(anchorFromSelection("a.ts", { start: 7, end: 7, side: "deletions" }, "abc").side).toBe(
      "old",
    );
  });

  it("orders a range dragged upwards, as the Hub wants", () => {
    expect(
      anchorFromSelection("a.ts", { start: 20, end: 15, side: "additions" }, undefined),
    ).toEqual({ path: "a.ts", line: 15, endLine: 20, side: "new" });
  });

  it("keeps only the end of a range across both sides", () => {
    expect(
      anchorFromSelection(
        "a.ts",
        { start: 3, side: "deletions", end: 9, endSide: "additions" },
        "abc",
      ),
    ).toEqual({ path: "a.ts", line: 9, side: "new", commit: "abc" });
  });

  it("treats a line with no side as the new file", () => {
    expect(anchorFromSelection("a.ts", { start: 2, end: 2 }, undefined).side).toBe("new");
  });
});

describe("a comment on a path", () => {
  it("is valid for the Hub, which takes lines from 1", () => {
    expect(pathAnchor("a.ts")).toEqual({ path: "a.ts", line: 1, side: "new" });
  });
});

describe("whether a diff shows a line", () => {
  it("reads each side's own numbers, bounded by the hunk", () => {
    expect(lineInDiff(file, "additions", 14)).toBe(true);
    expect(lineInDiff(file, "additions", 15)).toBe(false);
    expect(lineInDiff(file, "deletions", 14)).toBe(false);
    expect(lineInDiff(file, "deletions", 39)).toBe(true);
    expect(lineInDiff(file, "additions", 39)).toBe(false);
  });
});

describe("placing a room's anchors on a diff", () => {
  const at = (line: number, extra = {}) => ({
    path: "src/a.ts",
    line,
    side: "new",
    commit: "head",
    ...extra,
  });

  it("pins a message made on this diff at its line, on its side", () => {
    const { pinned, apart } = placeAnchors([message(1, at(12))], [file], "head");
    expect(apart).toEqual([]);
    expect(pinned).toMatchObject([{ path: "src/a.ts", side: "additions", lineNumber: 12 }]);
    expect(viewerSide("old")).toBe("deletions");
  });

  it("pins a range at its last line and gathers messages on one line", () => {
    const { pinned } = placeAnchors(
      [message(1, at(10, { endLine: 12 })), message(2, at(12))],
      [file],
      "head",
    );
    expect(pinned).toHaveLength(1);
    expect(pinned[0]?.lineNumber).toBe(12);
    expect(pinned[0]?.messages.map((row) => row.seq)).toEqual([1, 2]);
  });

  it("never pins a message from an older version, even where the line exists", () => {
    const { pinned, apart } = placeAnchors(
      [message(1, at(12, { commit: "older" }))],
      [file],
      "head",
    );
    expect(pinned).toEqual([]);
    expect(apart).toMatchObject([{ where: "src/a.ts:12", why: "on an earlier version" }]);
  });

  it("pins a message with no commit only where the diff has its line", () => {
    const { commit: _commit, ...bare } = at(12);
    expect(placeAnchors([message(1, bare)], [file], "head").pinned).toHaveLength(1);
    expect(placeAnchors([message(1, { ...bare, line: 99 })], [file], "head").apart).toMatchObject([
      { why: "not in this diff" },
    ]);
  });

  it("lists a comment on a file this diff does not hold, and skips plain messages", () => {
    const { pinned, apart } = placeAnchors(
      [message(1), message(2, at(12, { path: "gone.ts" }))],
      [file],
      "head",
    );
    expect(pinned).toEqual([]);
    expect(apart.map((row) => row.message.seq)).toEqual([2]);
  });
});

describe("the line over the diff", () => {
  it("says whose work it is and which commit", () => {
    const diff = {
      state: "here",
      source: "pushed",
      base: "b",
      head: "0123456789",
      patch: "",
      truncated: false,
    } as const;
    expect(diffSourceText(diff)).toBe("The pushed branch · 01234567");
    expect(diffSourceText({ ...diff, source: "run" })).toContain("Your run's checkout");
  });
});

describe("Watch where the work is not here", () => {
  const open = { kind: "observe", workspace: "w", environment: "e", thread: "t" } as const;

  it("opens a colleague's shared thread only", () => {
    expect(watchable([{ mine: false, observable: true, open }])).toBe(open);
    expect(watchable([{ mine: false, observable: false, open: undefined }])).toBeUndefined();
    expect(watchable([{ mine: true, observable: true, open }])).toBeUndefined();
  });
});
