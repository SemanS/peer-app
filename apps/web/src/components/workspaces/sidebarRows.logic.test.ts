import { describe, expect, it } from "vite-plus/test";

import { shownRows } from "./sidebarRows.logic";

const rows = ["a", "b", "c", "d"];

describe("shownRows", () => {
  it("shows the first rows and counts the rest", () => {
    expect(shownRows(rows, 2, () => false)).toEqual({ rows: ["a", "b"], hidden: 2 });
  });

  it("keeps the open row beyond the limit", () => {
    expect(shownRows(rows, 2, (row) => row === "d")).toEqual({
      rows: ["a", "b", "d"],
      hidden: 1,
    });
  });

  it("does not repeat an open row within the limit", () => {
    expect(shownRows(rows, 2, (row) => row === "a")).toEqual({ rows: ["a", "b"], hidden: 2 });
  });

  it("hides nothing when all rows fit", () => {
    expect(shownRows(rows, 10, () => false)).toEqual({ rows, hidden: 0 });
  });
});
