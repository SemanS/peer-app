import { describe, expect, it } from "vite-plus/test";

import { contextComparison, parseContextCompare } from "./contextCompare.logic";

describe("a link to compare a task's context", () => {
  it("keeps the version asked for when it is a version number", () => {
    expect(parseContextCompare({ compare: 3 })).toEqual({ compare: 3 });
    expect(parseContextCompare({})).toEqual({});
  });

  it("drops anything a version cannot be", () => {
    for (const compare of ["3", "abc", 0, -1, 2.5, Number.NaN, null, true, [3]]) {
      expect(parseContextCompare({ compare })).toEqual({});
    }
  });

  it("compares the version asked for with the latest while it is older", () => {
    expect(contextComparison(3, 4)).toEqual({ from: 3, to: 4 });
    expect(contextComparison(1, 9)).toEqual({ from: 1, to: 9 });
  });

  it("has nothing to compare when nothing was asked, no context exists or it has not moved on", () => {
    expect(contextComparison(undefined, 4)).toBeNull();
    expect(contextComparison(3, undefined)).toBeNull();
    expect(contextComparison(4, 4)).toBeNull();
    expect(contextComparison(5, 4)).toBeNull();
  });
});
