import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  locationForProjectScope,
  pullRequestsLocation,
  scopeForLocation,
} from "./projectScopeNavigation.logic";
import { resolveProjectScope, type ProjectCatalog } from "./projectScope.logic";

const ref = (id: string, environment = "computer") => ({
  environmentId: EnvironmentId.make(environment),
  projectId: ProjectId.make(id),
});
const catalog: ProjectCatalog = {
  peer: [{ scope: "team/vocabulift", name: "Vocabulift", refs: [ref("vocab")] }],
  groups: [
    { projectKey: "vocab", displayName: "Vocabulift", memberProjectRefs: [ref("vocab")] },
    { projectKey: "peer", displayName: "Peer", memberProjectRefs: [ref("peer")] },
  ],
};

describe("project scope navigation", () => {
  it("PR entry always opens PRs, including projects with multiple or no checkouts", () => {
    expect(
      pullRequestsLocation({}, { scope: "team/multi", name: "Multi", refs: [ref("a"), ref("b")] }),
    ).toEqual({
      to: "/pull-requests",
      search: { involvement: "all", state: "open", environmentId: "computer", projectId: "a" },
    });
    expect(pullRequestsLocation({}, { scope: "team/new", name: "New", refs: [] })).toEqual({
      to: "/pull-requests",
      search: { involvement: "all", state: "open" },
    });
  });
  it("switches PR scope and clears the old detail and project-specific filters", () => {
    const next = locationForProjectScope(
      "/pull-requests",
      {
        projectId: "vocab",
        environmentId: "computer",
        repository: "org/vocab",
        number: 42,
        author: "old-author",
        q: "old query",
        involvement: "reviewing",
        state: "open",
      },
      resolveProjectScope("local:peer", catalog),
    );
    expect(next).toEqual({
      to: "/pull-requests",
      search: {
        projectId: "peer",
        environmentId: "computer",
        involvement: "reviewing",
        state: "open",
      },
    });
    expect(scopeForLocation(next.to, {}, next.search, catalog)).toBe("local:peer");
  });
  it("restores the URL's project on Back or a direct link", () => {
    expect(
      scopeForLocation(
        "/pull-requests",
        {},
        { projectId: "vocab", environmentId: "computer" },
        catalog,
      ),
    ).toBe("team/vocabulift");
    expect(
      scopeForLocation(
        "/task/team/vocabulift/translate",
        { workspace: "team", project: "vocabulift" },
        {},
        catalog,
      ),
    ).toBe("team/vocabulift");
    expect(scopeForLocation("/work", {}, { scope: "local:peer" }, catalog)).toBe("local:peer");
  });
  it("shows all projects after clearing the PR project filter", () => {
    expect(scopeForLocation("/pull-requests", {}, {}, catalog)).toBe("all");
    expect(
      locationForProjectScope("/pull-requests", {}, resolveProjectScope("all", catalog)),
    ).toEqual({
      to: "/pull-requests",
      search: { involvement: "all", state: "open" },
    });
  });
  it("leaves old task and chat details when selecting a project", () => {
    for (const path of [
      "/task/team/vocabulift/translate",
      "/computer/chat",
      "/context/team/vocabulift/project",
    ]) {
      expect(locationForProjectScope(path, {}, resolveProjectScope("local:peer", catalog))).toEqual(
        { to: "/work", search: { scope: "local:peer" } },
      );
    }
  });
  it("opens the overview when no single repository represents the selected project", () => {
    expect(
      locationForProjectScope(
        "/pull-requests",
        {},
        { scope: "team/multi", name: "Multi", refs: [ref("a"), ref("b")] },
      ),
    ).toEqual({ to: "/work", search: { scope: "team/multi" } });
    expect(
      locationForProjectScope("/pull-requests", {}, { scope: "team/new", name: "New", refs: [] }),
    ).toEqual({ to: "/work", search: { scope: "team/new" } });
  });
  it("never resolves a project ID against an unrelated environment", () => {
    expect(
      scopeForLocation(
        "/pull-requests",
        {},
        { projectId: "peer", environmentId: "remote" },
        catalog,
      ),
    ).toBeUndefined();
  });
});
