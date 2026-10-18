import { reviewState, reviewVersions } from "@t3tools/client-runtime/peer/changes";
import type { ReviewDiff, ReviewMark } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  compareLabels,
  defaultMode,
  diffNotes,
  reviewStanding,
  sinceMarkWords,
} from "./changeReview.logic.ts";
import { at, commit, row } from "./fixtures.test-util.ts";

// Ana's ORD-11: seven versions, the sixth only moved the parents, the seventh edited.
const ana = row("lrorvllt", {
  author: { email: "ana@acme.dev", agent: "claude-code" },
  versions: [
    { commit: commit("v1"), at: at("14:31"), kind: "edit" },
    { commit: commit("v2"), at: at("14:34"), kind: "edit" },
    { commit: commit("v3"), at: at("14:38"), kind: "edit" },
    { commit: commit("v4"), at: at("14:44"), kind: "description" },
    { commit: commit("v5"), at: at("14:50"), kind: "edit" },
    { commit: commit("v6"), at: at("14:53"), kind: "rebase" },
    { commit: commit("v7"), at: at("14:57"), kind: "edit" },
  ],
});
const mark: ReviewMark = {
  changeId: ana.changeId,
  commit: commit("v5"),
  version: 5,
  at: at("14:50"),
};

describe("the review of Ana's ORD-11", () => {
  it("lists v1 to v7 with v6 as a rebase, v5 marked and v7 as now", () => {
    const versions = reviewVersions(ana, mark);
    expect(versions.map((v) => v.label)).toEqual([
      "first edit",
      "edit",
      "edit",
      "description",
      "edit",
      "rebased onto main",
      "edit · now",
    ]);
    expect(versions.filter((v) => v.marked).map((v) => v.n)).toEqual([5]);
  });

  it("opens on what moved since the mark, and on the whole change without one", () => {
    expect(defaultMode(reviewState(ana, [mark]))).toBe("since");
    expect(defaultMode(reviewState(ana, []))).toBe("whole");
    const current: ReviewMark = { ...mark, commit: commit("v7"), version: 7 };
    expect(defaultMode(reviewState(ana, [current]))).toBe("whole");
  });

  it("labels the two views with the versions they compare", () => {
    expect(compareLabels(ana, mark)).toEqual({
      since: "Since your review · v5 → v7",
      whole: "Whole change · main → v7",
    });
    expect(compareLabels(ana, undefined).since).toBe("Since your review");
  });

  it("says what happened since the mark in the kinds of the versions", () => {
    const versions = reviewVersions(ana, mark);
    expect(sinceMarkWords(versions, 5)).toBe("1 edit and 1 rebase onto main");
    expect(reviewStanding(ana, reviewState(ana, [mark]), versions, () => "14:50")).toBe(
      "You marked v5 reviewed at 14:50. Since then: 1 edit and 1 rebase onto main.",
    );
  });

  it("says nothing moved after the newest version was marked, and that no mark exists yet", () => {
    const current: ReviewMark = { ...mark, commit: commit("v7"), version: 7 };
    const versions = reviewVersions(ana, current);
    expect(reviewStanding(ana, reviewState(ana, [current]), versions, () => "14:57")).toContain(
      "Nothing has moved since.",
    );
    expect(reviewStanding(ana, undefined, versions, () => "")).toMatch(/not marked/);
  });
});

describe("what a comparison admits", () => {
  const since: ReviewDiff = {
    state: "ok",
    mode: "since",
    fromVersion: 5,
    toVersion: 7,
    leftOut: 2,
    files: [],
  };

  it("says main's commits between the versions are left out", () => {
    expect(diffNotes(since, ana)).toEqual([
      "Main gained 2 commits between v5 and v7, which are not part of Ana's change, so they are left out here.",
    ]);
  });

  it("leaves the left-out line to the since view", () => {
    expect(diffNotes({ ...since, mode: "whole" }, ana)).toEqual([]);
  });

  it("says Ana's newest version is not pushed or shared, and compares nothing", () => {
    expect(diffNotes({ state: "notHere", mode: "since", files: [] }, ana)).toEqual([
      "Ana's newest version is not pushed or shared yet. Nothing is compared.",
    ]);
  });

  it("says up to which version a partial comparison goes", () => {
    expect(diffNotes({ ...since, state: "partial", toVersion: 6, leftOut: 0 }, ana)[0]).toContain(
      "compares up to v6, the newest this computer has",
    );
  });
});
