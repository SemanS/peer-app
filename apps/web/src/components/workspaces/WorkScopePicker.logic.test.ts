import type { PeerHubStatus, PeerProjectState, PeerWorkspaceRole } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  actionsForScope,
  folderName,
  localProjectActions,
  openFolderLabel,
  projectButtonLines,
  projectMenuSections,
  workspaceProjectActions,
} from "./WorkScopePicker.logic";
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

describe("the menu's actions on a workspace project", () => {
  const status = (
    coordination: object = {},
    email: string | null = "ana@webinson.test",
    pathRules = 2,
  ) =>
    ({
      email,
      coordination: {
        enabled: true,
        policy: "notify",
        policies: { webinson: { ordering: "coordinate", receipts: undefined } },
        ...coordination,
      },
      resources: {
        held: [],
        pathRules: [{ workspace: "webinson", project: "receipts", count: pathRules }],
      },
    }) as unknown as Pick<PeerHubStatus, "coordination" | "resources" | "email">;
  const state = (id: string, extra: object = {}, repositories: ReadonlyArray<object> = []) =>
    ({
      project: { id, name: id === "ordering" ? "Ordering demo" : "Receipt printer", ...extra },
      repositories,
    }) as unknown as Pick<PeerProjectState, "project" | "repositories">;
  const workspace = (role: PeerWorkspaceRole) => ({ slug: "webinson", name: "Webinson", role });

  it("says this computer's default, with the path rules, and offers Change…", () => {
    const actions = workspaceProjectActions({
      status: status(),
      workspace: workspace("member"),
      state: state("receipts"),
    });
    expect(actions).toMatchObject({
      kind: "workspace",
      name: "Receipt printer",
      coordination: {
        title: "Coordination: notify",
        detail: "Your default on this computer · 2 path rules",
        action: { label: "Change…", location: { kind: "computer", section: "coordination" } },
      },
    });
  });

  it("says the project decides, and offers its Settings", () => {
    const actions = workspaceProjectActions({
      status: status({}, "ana@webinson.test", 0),
      workspace: workspace("member"),
      state: state("ordering"),
    });
    expect(actions.kind === "workspace" && actions.coordination).toEqual({
      title: "Coordination: coordinate",
      detail: "Set by the project",
      action: {
        label: "Settings",
        location: {
          kind: "project",
          workspace: "webinson",
          projectId: "ordering",
          tab: "coordination",
        },
      },
    });
  });

  it("has no coordination row while coordination is off or its policies are unknown", () => {
    for (const coordination of [{ enabled: false }, { policies: undefined }]) {
      const actions = workspaceProjectActions({
        status: status(coordination),
        workspace: workspace("owner"),
        state: state("ordering"),
      });
      expect(actions.kind === "workspace" && actions.coordination).toBeNull();
    }
  });

  it("sends Project settings to the project's page", () => {
    const actions = workspaceProjectActions({
      status: status(),
      workspace: workspace("member"),
      state: state("ordering"),
    });
    expect(actions.kind === "workspace" && actions.settings).toEqual({
      kind: "project",
      workspace: "webinson",
      projectId: "ordering",
      tab: "basics",
    });
  });

  it("opens the checkout that is ready, and has no folder before one is", () => {
    const withRepos = workspaceProjectActions({
      status: status(),
      workspace: workspace("member"),
      state: state("ordering", {}, [
        { path: "/w/missing", state: "missing" },
        { path: "/w/webinson/ordering", state: "ready" },
      ]),
    });
    expect(withRepos.kind === "workspace" && withRepos.folder).toBe("/w/webinson/ordering");
    const none = workspaceProjectActions({
      status: status(),
      workspace: workspace("member"),
      state: state("ordering", {}, [{ path: "/w/x", state: "cloning" }]),
    });
    expect(none.kind === "workspace" && none.folder).toBeUndefined();
  });

  it("offers Remove from workspace… to whoever shared the project and to admins, not to others", () => {
    const removable = (role: PeerWorkspaceRole, email: string, addedBy: string | undefined) => {
      const actions = workspaceProjectActions({
        status: status({}, email),
        workspace: workspace(role),
        state: state("ordering", addedBy === undefined ? {} : { addedBy }),
      });
      return actions.kind === "workspace" && actions.remove;
    };
    expect(removable("member", "ana@webinson.test", "ana@webinson.test")).toBe(true);
    expect(removable("member", "eva@webinson.test", "ana@webinson.test")).toBe(false);
    expect(removable("admin", "eva@webinson.test", "ana@webinson.test")).toBe(true);
    expect(removable("owner", "eva@webinson.test", "ana@webinson.test")).toBe(true);
    // A project from the workspace's configuration leaves only through that configuration.
    expect(removable("owner", "eva@webinson.test", undefined)).toBe(false);
  });
});

describe("the menu's actions on a local project", () => {
  it("offers its settings page and its folder, and never coordination or removal", () => {
    expect(
      localProjectActions({
        projectKey: "github.com/ana/dotfiles",
        displayName: "dotfiles",
        workspaceRoot: "/Users/ana/dotfiles",
      }),
    ).toEqual({
      kind: "local",
      name: "dotfiles",
      projectKey: "github.com/ana/dotfiles",
      folder: "/Users/ana/dotfiles",
    });
  });
});

describe("openFolderLabel", () => {
  it("names the file manager the environment reveals files in", () => {
    expect(openFolderLabel("Reveal in Finder", "Win32")).toBe("Open folder in Finder");
    expect(openFolderLabel("Reveal in File Explorer", "MacIntel")).toBe(
      "Open folder in File Explorer",
    );
    expect(openFolderLabel("Reveal in Files", "Linux")).toBe("Open folder in Files");
  });

  it("falls back to what this computer's platform calls it", () => {
    expect(openFolderLabel(undefined, "MacIntel")).toBe("Open folder in Finder");
    expect(openFolderLabel(undefined, "Win32")).toBe("Open folder in File Explorer");
  });
});

describe("actionsForScope", () => {
  const status = {
    email: "ana@webinson.test",
    coordination: { enabled: true, policy: "notify", policies: { webinson: {} } },
    resources: undefined,
    workspaces: [
      {
        slug: "webinson",
        name: "Webinson",
        role: "member",
        projects: [
          {
            project: { id: "ordering", name: "Ordering demo" },
            repositories: [],
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof actionsForScope>[1]["status"];
  const groups = [
    {
      projectKey: "github.com/ana/dotfiles",
      displayName: "dotfiles",
      workspaceRoot: "/Users/ana/dotfiles",
    },
  ];

  it("finds a workspace project's actions, with what removal needs", () => {
    expect(actionsForScope("webinson/ordering", { status, groups })).toMatchObject({
      kind: "workspace",
      name: "Ordering demo",
      workspace: "webinson",
      workspaceName: "Webinson",
      projectId: "ordering",
    });
  });

  it("finds a local project's actions", () => {
    expect(actionsForScope("local:github.com/ana/dotfiles", { status, groups })).toMatchObject({
      kind: "local",
      name: "dotfiles",
    });
  });

  it("has none for all projects or a project that is gone", () => {
    expect(actionsForScope("all", { status, groups })).toBeNull();
    expect(actionsForScope("webinson/gone", { status, groups })).toBeNull();
    expect(actionsForScope("local:github.com/ana/gone", { status, groups })).toBeNull();
    expect(actionsForScope("webinson/ordering", { status: null, groups })).toBeNull();
  });
});
