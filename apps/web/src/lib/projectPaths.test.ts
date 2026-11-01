import { describe, expect, it } from "vite-plus/test";

import {
  findProjectByPath,
  normalizeProjectPathForComparison,
  normalizeProjectPathForDispatch,
  withoutHomePrefixBeforeAbsolutePath,
} from "./projectPaths";

describe("projectPaths", () => {
  it("reads an absolute path typed after the field's home prefix as that path", () => {
    expect(withoutHomePrefixBeforeAbsolutePath("~//Users/ana/app")).toBe("/Users/ana/app");
    expect(withoutHomePrefixBeforeAbsolutePath("~/C:\\Work\\app")).toBe("C:\\Work\\app");
    expect(withoutHomePrefixBeforeAbsolutePath("~/Documents/app")).toBe("~/Documents/app");
    expect(withoutHomePrefixBeforeAbsolutePath("/Users/ana/app")).toBe("/Users/ana/app");
  });

  it("normalizes trailing separators for dispatch and comparison", () => {
    expect(normalizeProjectPathForDispatch(" /repo/app/ ")).toBe("/repo/app");
    expect(normalizeProjectPathForComparison("/repo/app/")).toBe("/repo/app");
  });

  it("normalizes windows-style paths for comparison", () => {
    expect(normalizeProjectPathForComparison("C:/Work/Repo/")).toBe("c:\\work\\repo");
    expect(normalizeProjectPathForComparison("C:\\Work\\Repo\\")).toBe("c:\\work\\repo");
  });

  it("finds existing projects even when the input formatting differs", () => {
    const existing = findProjectByPath(
      [
        { id: "project-1", cwd: "/repo/app" },
        { id: "project-2", cwd: "C:\\Work\\Repo" },
      ],
      "C:/Work/Repo/",
    );

    expect(existing?.id).toBe("project-2");
  });
});
