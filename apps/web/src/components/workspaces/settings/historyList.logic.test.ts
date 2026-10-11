import type { PeerSettingsLine, PeerSettingsRevisionEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  LINES_SHOWN,
  canRevert,
  joinPages,
  lockedLines,
  oldestSeq,
  reasonOf,
  shownLines,
  sourceLabel,
} from "./historyList.logic";

const line = (path: ReadonlyArray<string>, label = "Coordination"): PeerSettingsLine => ({
  path,
  scope: { kind: "project", id: "booking", name: "Booking" },
  label,
  from: "notify",
  to: "coordinate",
});

const entry = (
  seq: number,
  extra: Partial<PeerSettingsRevisionEntry> = {},
): PeerSettingsRevisionEntry => ({
  seq,
  commit: `c${seq}`,
  at: "2026-10-11T12:00:00Z",
  by: { email: "eva@acme.dev", name: "Eva" },
  message: "",
  source: "app",
  lines: [line(["projects", "booking", "coordination", "policy"])],
  ...extra,
});

describe("where a revision came from", () => {
  it.each<[string, string | null]>([
    ["app", null],
    ["proposal", "Proposal"],
    ["import", "Import"],
    ["revert", "Revert"],
    ["cli", "CLI"],
    ["seed", "Start"],
    ["gap", "Gap"],
    ["mirror", "Mirror"],
  ])("labels %s as %s", (source, label) => {
    expect(sourceLabel(source)).toBe(label);
  });
});

describe("reverting a revision", () => {
  const yes = () => true;
  const no = () => false;
  const onlyPolicy = (path: ReadonlyArray<string>) => path.includes("policy");

  it("is offered where the person may change at least one of its lines", () => {
    const mixed = entry(5, {
      lines: [
        line(["projects", "booking", "coordination", "policy"]),
        line(["projects", "booking", "capacity", "shared", "budget"], "Budget"),
      ],
    });
    expect(canRevert(mixed, yes)).toBe(true);
    expect(canRevert(mixed, onlyPolicy)).toBe(true);
    expect(canRevert(mixed, no)).toBe(false);
    expect(lockedLines(mixed, onlyPolicy)).toBe(1);
    expect(lockedLines(mixed, yes)).toBe(0);
  });

  it("is not offered for the history's first revision or for one with no changes", () => {
    expect(canRevert(entry(1, { source: "seed" }), yes)).toBe(false);
    expect(canRevert(entry(7, { lines: [] }), yes)).toBe(false);
  });
});

describe("a revision's reason", () => {
  it("is its message, unless the message is only the first line of its summary", () => {
    expect(reasonOf(entry(2, { message: "Two agents broke the schema" }))).toBe(
      "Two agents broke the schema",
    );
    expect(
      reasonOf(entry(3, { message: "Booking · Coordination: notify → coordinate" })),
    ).toBeNull();
    expect(reasonOf(entry(4, { message: "  " }))).toBeNull();
  });
});

describe("the lines shown", () => {
  const lines = Array.from({ length: 7 }, (_, i) => i);

  it("holds back what is beyond the first few until asked", () => {
    expect(shownLines(lines, false)).toEqual({ shown: lines.slice(0, LINES_SHOWN), hidden: 3 });
    expect(shownLines(lines, true)).toEqual({ shown: lines, hidden: 0 });
    expect(shownLines(lines.slice(0, LINES_SHOWN), false)).toEqual({
      shown: lines.slice(0, LINES_SHOWN),
      hidden: 0,
    });
  });
});

describe("the pages read so far", () => {
  it("joins them newest first, each revision once", () => {
    expect(
      joinPages([entry(9), entry(8)], [entry(8), entry(7), entry(6)]).map(
        (revision) => revision.seq,
      ),
    ).toEqual([9, 8, 7, 6]);
    expect(joinPages([entry(2)], [entry(5)]).map((revision) => revision.seq)).toEqual([5, 2]);
    expect(joinPages([])).toEqual([]);
  });
});

describe("where the next page starts", () => {
  it("is the oldest revision read, whatever order they were joined in", () => {
    expect(oldestSeq([entry(9), entry(4), entry(7)])).toBe(4);
    expect(oldestSeq([])).toBeNull();
  });
});
