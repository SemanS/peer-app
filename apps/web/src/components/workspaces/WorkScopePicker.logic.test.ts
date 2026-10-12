import { describe, expect, it } from "vite-plus/test";

import { folderName, projectButtonLines, projectMenuSections } from "./WorkScopePicker.logic";
import type { WorkProjectNode, WorkTaskNode, WorkThreadNode } from "./workTree.logic";

const workspace = {
  slug: "webinson",
  name: "Webinson",
  projects: [
    {
      project: { id: "ordering", name: "Ordering demo" },
      repositories: [{ path: "/Users/ana/Peer/webinson/peer-demo-20261010" }],
    },
    { project: { id: "receipt-printer", name: "Receipt printer" }, repositories: [] },
  ],
};

function waiting(key: string): WorkThreadNode {
  return {
    key,
    title: key,
    person: "Ana",
    mine: true,
    status: "blocked",
    harness: "claude",
    branch: undefined,
    source: "peer",
    stale: false,
    open: undefined,
    placeable: true,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
  };
}

function task(id: string, done: boolean, threads: ReadonlyArray<WorkThreadNode> = []) {
  return {
    id,
    key: id.toUpperCase(),
    title: id,
    done,
    status: done ? "done" : "idle",
    threads,
    removable: true,
    context: undefined,
  } satisfies WorkTaskNode;
}

function node(id: string, name: string, tasks: ReadonlyArray<WorkTaskNode>): WorkProjectNode {
  return {
    workspace: "webinson",
    workspaceName: "Webinson",
    projectId: id,
    name,
    areas: [{ name: null, tasks }],
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks: [],
  };
}

describe("folderName", () => {
  it("is the last part of a path, whatever the separator", () => {
    expect(folderName("/Users/ana/Peer/webinson/peer-demo-20261010")).toBe("peer-demo-20261010");
    expect(folderName("/Users/ana/Peer/webinson/receipt-printer/")).toBe("receipt-printer");
    expect(folderName("C:\\Peer\\webinson\\ordering")).toBe("ordering");
    expect(folderName("")).toBeUndefined();
  });
});

describe("projectMenuSections", () => {
  const tree = [
    node("ordering", "Ordering demo", [
      task("a", false, [waiting("t1")]),
      task("b", false),
      task("c", true),
    ]),
  ];

  it("lists a workspace's projects with their folder and how many tasks are active", () => {
    const [section] = projectMenuSections({ workspaces: [workspace], tree, needs: [], locals: [] });
    expect(section?.heading).toBe("Webinson · projects");
    expect(section?.rows[0]).toEqual({
      scope: "webinson/ordering",
      name: "Ordering demo",
      folder: "peer-demo-20261010",
      active: "2 active",
      needs: "1 needs you",
    });
  });

  it("names the project's id as the folder of one not on this computer, with no counts", () => {
    const [section] = projectMenuSections({ workspaces: [workspace], tree, needs: [], locals: [] });
    expect(section?.rows[1]).toEqual({
      scope: "webinson/receipt-printer",
      name: "Receipt printer",
      folder: "receipt-printer",
      active: undefined,
      needs: undefined,
    });
  });

  it("puts the projects no workspace shares after the workspaces'", () => {
    const sections = projectMenuSections({
      workspaces: [workspace, { slug: "empty", name: "Empty", projects: [] }],
      tree,
      needs: [],
      locals: [
        {
          projectKey: "github.com/ana/dotfiles",
          displayName: "dotfiles",
          workspaceRoot: "/Users/ana/dotfiles",
        },
      ],
    });
    expect(sections.map((section) => section.heading)).toEqual([
      "Webinson · projects",
      "Local projects",
    ]);
    expect(sections[1]?.rows).toEqual([
      {
        scope: "local:github.com/ana/dotfiles",
        name: "dotfiles",
        folder: "dotfiles",
        active: undefined,
        needs: undefined,
      },
    ]);
  });

  it("lists nothing for a person with no workspace and no local project", () => {
    expect(projectMenuSections({ workspaces: [], tree: [], needs: [], locals: [] })).toEqual([]);
  });
});

describe("projectButtonLines", () => {
  const workspaces = [
    { slug: "webinson", name: "Webinson" },
    { slug: "acme", name: "Acme" },
  ];

  it("names the workspace over a workspace project", () => {
    expect(projectButtonLines({ scope: "acme/app", name: "App" }, workspaces)).toEqual({
      where: "Acme",
      name: "App",
    });
  });

  it("says This computer over a local project", () => {
    expect(
      projectButtonLines({ scope: "local:github.com/ana/dotfiles", name: "dotfiles" }, workspaces),
    ).toEqual({ where: "This computer", name: "dotfiles" });
  });

  it("says All projects over the whole catalog, naming the one workspace there is", () => {
    const all = { scope: "all", name: undefined };
    expect(projectButtonLines(all, [workspaces[0]!])).toEqual({
      where: "Webinson",
      name: "All projects",
    });
    expect(projectButtonLines(all, workspaces)).toEqual({
      where: "2 workspaces",
      name: "All projects",
    });
    expect(projectButtonLines(all, [])).toEqual({ where: "This computer", name: "All projects" });
  });
});
