import { EnvironmentId, ThreadId, type PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardKinds,
  boardSearchPlaceholder,
  computerKinds,
  experimentStartStep,
  forecastTeammatesWords,
  impactIndexWords,
  issueKeyHint,
  launchLine,
  launchNote,
  observedPathsLine,
  projectVcs,
  refRowLabel,
  vcsWords,
} from "./vcsWords";
import type { WorkProjectNode, WorkThreadNode } from "./workTree.logic";

const HERE = EnvironmentId.make("env-here");

function thread(overrides: Partial<WorkThreadNode> & Pick<WorkThreadNode, "key">): WorkThreadNode {
  return {
    title: overrides.key,
    person: "Slavo",
    mine: true,
    status: "idle",
    delivery: "open",
    localEnvironment: true,
    harness: undefined,
    branch: undefined,
    source: "peer",
    stale: false,
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make(overrides.key) },
    placeable: true,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
    ...overrides,
  };
}

function project(
  projectId: string,
  vcs: "git" | "jj" | undefined,
  threads: ReadonlyArray<WorkThreadNode>,
): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId,
    name: projectId,
    areas: [],
    unsorted: threads,
    context: undefined,
    candidates: 0,
    tasks: [],
    ...(vcs === undefined ? {} : { vcs }),
  };
}

const repo = (id: string, state: string, vcs?: "jj") => ({
  id,
  url: `git@example.test:acme/${id}.git`,
  branch: "main",
  path: `/work/${id}`,
  state,
  ...(vcs === undefined ? {} : { vcs }),
});

/** This computer with a project per entry, each with the given checkouts. */
const computer = (projects: ReadonlyArray<ReadonlyArray<ReturnType<typeof repo>>>) =>
  ({
    workspaces: [
      {
        slug: "acme",
        projects: projects.map((repositories, index) => ({
          project: { id: `p${index}` },
          repositories,
        })),
      },
    ],
  }) as unknown as PeerHubStatus;

describe("a thread's rows", () => {
  it("say bookmark and workspace for a jj thread", () => {
    const words = vcsWords(thread({ key: "a", vcs: "jj" }).vcs);
    expect(refRowLabel([thread({ key: "a", branch: "feature/x", vcs: "jj" })], "git")).toBe(
      "Bookmark",
    );
    expect(launchLine(words, "main")).toBe("a new workspace and bookmark from main");
    expect(launchNote(words)).toContain("a feature bookmark in its own workspace");
    expect(observedPathsLine("jj", 3)).toBe(" · 3 paths observed in the working copy");
  });

  it("say branch and worktree for a Git thread, and for one that names no kind", () => {
    const words = vcsWords(thread({ key: "a" }).vcs);
    expect(refRowLabel([thread({ key: "a", branch: "fix/x" })], "jj")).toBe("Branch");
    expect(launchLine(words, "main")).toBe("a new worktree and branch from main");
    expect(launchNote(words)).toContain("a feature branch in its own worktree");
    expect(observedPathsLine(undefined, 3)).toBe(" · 3 uncommitted paths observed");
  });
});

describe("a mixed workspace", () => {
  const jjProject = project("app", "jj", [thread({ key: "a", branch: "feature/a", vcs: "jj" })]);
  const gitProject = project("site", "git", [thread({ key: "b", branch: "fix/b" })]);

  it("keeps each project's words", () => {
    expect(issueKeyHint(jjProject.vcs ?? "git")).toContain("A chat whose bookmark names it");
    expect(issueKeyHint(gitProject.vcs ?? "git")).toContain("A chat whose branch names it");
    expect(boardSearchPlaceholder(boardKinds([jjProject]))).toBe(
      "Search tasks, chats, bookmarks, people",
    );
    expect(boardSearchPlaceholder(boardKinds([gitProject]))).toBe(
      "Search tasks, chats, branches, people",
    );
  });

  it("names both kinds where one surface spans both projects", () => {
    expect(boardSearchPlaceholder(boardKinds([jjProject, gitProject]))).toBe(
      "Search tasks, chats, branches, bookmarks, people",
    );
  });

  it("hears a Git teammate's branch on a jj project's board", () => {
    const shared = project("app", "jj", [thread({ key: "c", branch: "fix/c", mine: false })]);
    expect(boardKinds([shared])).toEqual(["git", "jj"]);
  });
});

describe("settings without a thread", () => {
  it("speak of this computer's ready checkouts", () => {
    const jjOnly = computerKinds(computer([[repo("app", "ready", "jj")]]));
    expect(jjOnly).toEqual(["jj"]);
    expect(impactIndexWords(jjOnly).title).toBe("Index new Peer task workspaces");
    expect(forecastTeammatesWords(jjOnly).title).toBe("Forecast teammates’ bookmarks");
    expect(experimentStartStep(jjOnly)).toContain("each on a bookmark of its own");
  });

  it("keep Git's words while no checkout is ready, and name both when both are", () => {
    expect(computerKinds(computer([]))).toEqual(["git"]);
    expect(computerKinds(computer([[repo("app", "missing")]]))).toEqual(["git"]);
    const both = computerKinds(computer([[repo("app", "ready", "jj")], [repo("site", "ready")]]));
    expect(impactIndexWords(both).title).toBe("Index new Peer task worktrees and jj workspaces");
    expect(forecastTeammatesWords(both).title).toBe("Forecast teammates’ branches and bookmarks");
    expect(experimentStartStep(both)).toContain("each on a branch or bookmark of its own");
    expect(forecastTeammatesWords(["git"]).description).toBe(
      "Fetch only the named branches from origin. Forecasts use committed tips and stay on this computer.",
    );
  });

  it("take a project's kind from its checkouts here: jj when one of them is", () => {
    expect(projectVcs([repo("app", "ready", "jj"), repo("site", "ready")])).toBe("jj");
    expect(projectVcs([repo("site", "ready")])).toBe("git");
  });
});
