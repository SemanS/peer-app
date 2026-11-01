import { describe, expect, it } from "vite-plus/test";

import {
  addToSet,
  checkoutOf,
  columnWeights,
  joinProjects,
  removeFromSet,
  renameSet,
  resizedColumns,
  setHolds,
  setIdOfScope,
  setOfProject,
  setOfRoom,
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

describe("setIdOfScope", () => {
  it("names the set of a set's scope and nothing else", () => {
    expect(setIdOfScope(setScope("s1"))).toBe("s1");
    expect(setIdOfScope("acme/app")).toBeNull();
  });
});

describe("setOfRoom", () => {
  const other: ProjectSet = { id: "s2", name: "All", projects: ["acme/app", "local:site", "a/b"] };

  it("prefers the set in scope, else the first that holds the projects", () => {
    const projects = ["acme/app", "local:site"];
    expect(setOfRoom(projects, setScope("s2"), [pair, other])).toBe(other);
    expect(setOfRoom(projects, "acme/app", [pair, other])).toBe(pair);
  });

  it("has none once no set holds them all", () => {
    expect(setOfRoom(["acme/app", "x/y"], "acme/app", [pair, other])).toBeUndefined();
  });

  it("has none for a room it knows nothing of yet, which every set would hold", () => {
    expect(setOfRoom([], setScope("s2"), [pair, other])).toBeUndefined();
  });
});

describe("resizedColumns", () => {
  it("moves width between the two columns beside the line", () => {
    expect(resizedColumns([300, 300, 300], 0, 50, 100)).toEqual([350, 250, 300]);
    expect(resizedColumns([300, 300, 300], 1, -50, 100)).toEqual([300, 250, 350]);
  });

  it("stops at the minimum on either side", () => {
    expect(resizedColumns([300, 300], 0, 500, 100)).toEqual([500, 100]);
    expect(resizedColumns([300, 300], 0, -500, 100)).toEqual([100, 500]);
  });

  it("leaves columns already narrower than the minimum alone", () => {
    expect(resizedColumns([80, 90], 0, 40, 100)).toEqual([80, 90]);
  });
});

describe("columnWeights", () => {
  it("keeps the proportions around one", () => {
    expect(columnWeights([300, 300])).toEqual([1, 1]);
    expect(columnWeights([450, 150])).toEqual([1.5, 0.5]);
  });

  it("gives empty columns the same share", () => {
    expect(columnWeights([0, 0])).toEqual([1, 1]);
  });
});
