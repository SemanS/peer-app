import {
  EnvironmentId,
  ProjectId,
  type PeerHubStatus,
  type PeerProjectState,
  type PeerWorkspaceState,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chatScopeKeys,
  localProjectGroups,
  localScope,
  newChatProject,
  peerProjectIndex,
  resolveProjectScope,
  scopeOfProject,
  type PeerProjectEntry,
  type ProjectCatalog,
  type ScopeGroup,
} from "./projectScope.logic";

function project(id: string, name: string, opened: ReadonlyArray<string | undefined>) {
  return {
    project: { id, name },
    repositories: opened.map((projectId, index) => ({ id: `repo-${index}`, projectId })),
  } as unknown as PeerProjectState;
}

function status(
  environmentId: string,
  workspaces: ReadonlyArray<{ slug: string; projects: ReadonlyArray<PeerProjectState> }>,
): Pick<PeerHubStatus, "environmentId" | "workspaces"> {
  return {
    environmentId,
    workspaces: workspaces as unknown as ReadonlyArray<PeerWorkspaceState>,
  };
}

describe("peerProjectIndex", () => {
  it("keys each workspace project by its scope and lists where its repositories are open here", () => {
    const index = peerProjectIndex(
      status("laptop", [
        {
          slug: "webinson",
          projects: [
            project("ordering", "Ordering demo", ["p-1", "p-2"]),
            project("receipts", "Receipt printer", [undefined, "p-3"]),
          ],
        },
        { slug: "acme", projects: [project("app", "App", ["p-4"])] },
      ]),
    );
    expect(index.map((entry) => [entry.scope, entry.name])).toEqual([
      ["webinson/ordering", "Ordering demo"],
      ["webinson/receipts", "Receipt printer"],
      ["acme/app", "App"],
    ]);
    expect(
      index.map((entry) => entry.refs.map((ref) => `${ref.environmentId}:${ref.projectId}`)),
    ).toEqual([["laptop:p-1", "laptop:p-2"], ["laptop:p-3"], ["laptop:p-4"]]);
  });

  it("knows no project before the Hub's status has arrived", () => {
    expect(peerProjectIndex(null)).toEqual([]);
  });

  it("has no refs for a status that names no environment", () => {
    const index = peerProjectIndex(
      status("", [{ slug: "webinson", projects: [project("ordering", "Ordering", ["p-1"])] }]),
    );
    expect(index).toEqual([{ scope: "webinson/ordering", name: "Ordering", refs: [] }]);
  });
});

const ref = (environment: string, project: string): ScopedProjectRef => ({
  environmentId: EnvironmentId.make(environment),
  projectId: ProjectId.make(project),
});

const ordering: PeerProjectEntry = {
  scope: "webinson/ordering",
  name: "Ordering demo",
  refs: [ref("laptop", "p-1"), ref("laptop", "p-2")],
};
const receipts: PeerProjectEntry = {
  scope: "webinson/receipts",
  name: "Receipt printer",
  refs: [],
};
const dotfiles: ScopeGroup = {
  projectKey: "github.com/ana/dotfiles",
  displayName: "dotfiles",
  memberProjectRefs: [ref("laptop", "p-9"), ref("server", "p-9")],
};
const orderingGroup: ScopeGroup = {
  projectKey: "github.com/webinson/ordering",
  displayName: "ordering",
  memberProjectRefs: [ref("laptop", "p-1")],
};
const catalog: ProjectCatalog = {
  peer: [ordering, receipts],
  groups: [orderingGroup, dotfiles],
};

describe("the project scope Tasks and Chats share", () => {
  it("keeps every project's chats for all projects", () => {
    const resolved = resolveProjectScope("all", catalog);
    expect(resolved).toEqual({ scope: "all", name: undefined, refs: null });
    expect(chatScopeKeys(resolved.refs)).toBeNull();
  });

  it("keeps the chats of the projects holding a workspace project's repositories", () => {
    const resolved = resolveProjectScope("webinson/ordering", catalog);
    expect(resolved.name).toBe("Ordering demo");
    expect([...(chatScopeKeys(resolved.refs) ?? [])]).toEqual(["laptop:p-1", "laptop:p-2"]);
  });

  it("keeps no chats for a workspace project not cloned onto this computer yet", () => {
    const resolved = resolveProjectScope("webinson/receipts", catalog);
    expect(resolved.name).toBe("Receipt printer");
    expect(chatScopeKeys(resolved.refs)?.size).toBe(0);
  });

  it("keeps a local project's chats on every computer that holds it", () => {
    const resolved = resolveProjectScope(localScope("github.com/ana/dotfiles"), catalog);
    expect(resolved.name).toBe("dotfiles");
    expect([...(chatScopeKeys(resolved.refs) ?? [])]).toEqual(["laptop:p-9", "server:p-9"]);
  });

  it("falls back to every project for a project that is gone", () => {
    const every = { scope: "all", name: undefined, refs: null };
    expect(resolveProjectScope("webinson/removed", catalog)).toEqual(every);
    expect(resolveProjectScope(localScope("github.com/ana/gone"), catalog)).toEqual(every);
    expect(resolveProjectScope("webinson/ordering", { peer: [], groups: [] })).toEqual(every);
  });
});

describe("a new chat in the scope", () => {
  it("starts in the project on this computer, else in the first", () => {
    const local = resolveProjectScope(localScope("github.com/ana/dotfiles"), catalog);
    expect(newChatProject(local, "server")?.environmentId).toBe("server");
    expect(newChatProject(local, "elsewhere")?.environmentId).toBe("laptop");
    expect(newChatProject(resolveProjectScope("all", catalog), "laptop")).toBeNull();
    expect(newChatProject(resolveProjectScope("webinson/receipts", catalog), "laptop")).toBeNull();
  });
});

describe("filtering by a chat's project", () => {
  it("scopes to the workspace project that holds the chat's project", () => {
    expect(scopeOfProject(ref("laptop", "p-2"), catalog)).toEqual({
      scope: "webinson/ordering",
      name: "Ordering demo",
    });
  });

  it("scopes to the local project otherwise, and to nothing for an unknown one", () => {
    expect(scopeOfProject(ref("server", "p-9"), catalog)).toEqual({
      scope: "local:github.com/ana/dotfiles",
      name: "dotfiles",
    });
    expect(scopeOfProject(ref("laptop", "p-404"), catalog)).toBeNull();
  });
});

describe("local projects", () => {
  it("are the catalog's projects no workspace shares", () => {
    expect(
      localProjectGroups(catalog.groups, catalog.peer).map((group) => group.displayName),
    ).toEqual(["dotfiles"]);
    expect(localProjectGroups(catalog.groups, []).length).toBe(2);
  });
});
