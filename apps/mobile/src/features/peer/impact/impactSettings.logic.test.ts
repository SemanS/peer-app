import { describe, expect, it } from "vite-plus/test";

import { impactAutoIndexText, projectVcsKinds } from "./impactSettings.logic";

const computer = (...projects: ReadonlyArray<ReadonlyArray<"git" | "jj" | undefined>>) => ({
  workspaces: [
    { projects: projects.map((kinds) => ({ repositories: kinds.map((vcs) => ({ vcs })) })) },
  ],
});

describe("projectVcsKinds", () => {
  it("is Git for a computer without projects and for checkouts that carry no kind", () => {
    expect(projectVcsKinds({ workspaces: [] })).toEqual(["git"]);
    expect(projectVcsKinds(computer([undefined], ["git"]))).toEqual(["git"]);
  });
  it("is jj when every project has a jj checkout, and both for mixed projects", () => {
    expect(projectVcsKinds(computer(["jj"], [undefined, "jj"]))).toEqual(["jj"]);
    expect(projectVcsKinds(computer(["jj"], ["git"]))).toEqual(["git", "jj"]);
  });
});

describe("impactAutoIndexText", () => {
  it("names worktrees under Git", () => {
    expect(impactAutoIndexText(["git"])).toEqual({
      label: "Index new Peer task worktrees",
      note: "Opt in to initialize only new Peer task worktrees. Existing checkouts are never initialized automatically.",
    });
  });
  it("names workspaces under jj, and both when the computer has both", () => {
    expect(impactAutoIndexText(["jj"]).label).toBe("Index new Peer task workspaces");
    expect(impactAutoIndexText(["jj"]).note).toContain("only new Peer task workspaces.");
    expect(impactAutoIndexText(["git", "jj"]).label).toBe(
      "Index new Peer task worktrees and workspaces",
    );
  });
});
