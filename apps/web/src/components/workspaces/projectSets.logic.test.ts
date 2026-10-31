import { describe, expect, it } from "vite-plus/test";

import {
  addToSet,
  checkoutOf,
  joinProjects,
  removeFromSet,
  renameSet,
  setHolds,
  setOfProject,
  setScope,
  type ProjectSet,
} from "./projectSets.logic";

const pair: ProjectSet = { id: "s1", name: "App + Site", projects: ["acme/app", "local:site"] };

describe("project sets", () => {
  it("names two joined projects after both", () => {
    const [set] = joinProjects(
      [],
      "s1",
      { scope: "acme/app", name: "App" },
      { scope: "local:site", name: "Site" },
    );
    expect(set).toEqual(pair);
  });

  it("adds a project once", () => {
    const once = addToSet([pair], "s1", "acme/api");
    expect(addToSet(once, "s1", "acme/api")[0]?.projects).toEqual([
      "acme/app",
      "local:site",
      "acme/api",
    ]);
  });

  it("keeps the old name for a blank rename", () => {
    expect(renameSet([pair], "s1", "   ")[0]?.name).toBe("App + Site");
    expect(renameSet([pair], "s1", " Shop ")[0]?.name).toBe("Shop");
  });

  it("dissolves a set left with one project and follows that project", () => {
    expect(removeFromSet([pair], "s1", "acme/app")).toEqual({ sets: [], scope: "local:site" });
  });

  it("keeps a set that still has two projects", () => {
    const three = addToSet([pair], "s1", "acme/api");
    const { sets, scope } = removeFromSet(three, "s1", "acme/app");
    expect(sets[0]?.projects).toEqual(["local:site", "acme/api"]);
    expect(scope).toBe(setScope("s1"));
  });

  it("stays in the set in scope for a project it holds", () => {
    const other: ProjectSet = { id: "s2", name: "Other", projects: ["acme/app", "acme/api"] };
    expect(setHolds(setScope("s2"), "acme/app", [pair, other])).toBe(true);
    expect(setHolds("acme/app", "acme/api", [pair, other])).toBe(false);
    expect(setOfProject("acme/app", setScope("s2"), [pair, other])?.id).toBe("s2");
    expect(setOfProject("acme/app", "all", [pair, other])?.id).toBe("s1");
  });
});

describe("checkoutOf", () => {
  const catalog = [
    { environmentId: "remote", id: "p1", workspaceRoot: "/srv/app" },
    { environmentId: "here", id: "p2", workspaceRoot: "/Users/me/app" },
  ];
  const refs = [
    { environmentId: "remote", projectId: "p1" },
    { environmentId: "here", projectId: "p2" },
  ];

  it("prefers this computer's checkout", () => {
    expect(checkoutOf(refs, catalog, "here")).toEqual({
      environmentId: "here",
      cwd: "/Users/me/app",
    });
  });

  it("has none for a project not open anywhere", () => {
    expect(checkoutOf([{ environmentId: "x", projectId: "y" }], catalog, "here")).toBeNull();
  });
});
