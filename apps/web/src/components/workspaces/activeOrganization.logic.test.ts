import { describe, expect, it } from "vite-plus/test";

import {
  leavesRoute,
  organizationStatus,
  scopeAfterSwitch,
  staleWorkspaceKeys,
} from "./activeOrganization.logic";
import { ALL_PROJECTS } from "./workBoard.logic";

const status = (...slugs: ReadonlyArray<string>) => ({
  workspaces: slugs.map((slug) => ({ slug, name: slug })),
});

describe("the active organization", () => {
  it("leaves one membership as it is", () => {
    const one = status("webinson");
    expect(organizationStatus(one, "gone")).toBe(one);
  });

  it("scopes Work to the chosen organization, or the first one when the choice is gone", () => {
    const two = status("webinson", "vocabulift");
    expect(organizationStatus(two, "vocabulift").workspaces.map((w) => w.slug)).toEqual([
      "vocabulift",
    ]);
    expect(organizationStatus(two, null).workspaces.map((w) => w.slug)).toEqual(["webinson"]);
  });

  it("moves a project of another organization to all of the new one's on a switch", () => {
    expect(scopeAfterSwitch("webinson/app", "vocabulift")).toBe(ALL_PROJECTS);
    expect(scopeAfterSwitch("vocabulift/app", "vocabulift")).toBe("vocabulift/app");
    expect(scopeAfterSwitch("local:abc", "vocabulift")).toBe("local:abc");
    expect(scopeAfterSwitch(ALL_PROJECTS, "vocabulift")).toBe(ALL_PROJECTS);
  });

  it("drops every workspace key once signed out, and a non-member's once signed in", () => {
    const named = { workspace: "acme", scope: "acme/lab" };
    const signedIn = (...slugs: ReadonlyArray<string>) => ({ signedIn: true, ...status(...slugs) });
    expect(staleWorkspaceKeys({ signedIn: false, workspaces: [] }, named)).toEqual({
      workspace: true,
      scope: true,
    });
    expect(staleWorkspaceKeys(signedIn("vocabulift"), named)).toEqual({
      workspace: true,
      scope: true,
    });
    expect(staleWorkspaceKeys(signedIn("acme"), named)).toEqual({ workspace: false, scope: false });
    expect(
      staleWorkspaceKeys(signedIn("vocabulift"), { workspace: null, scope: "local:abc" }),
    ).toEqual({ workspace: false, scope: false });
    expect(staleWorkspaceKeys(null, named)).toEqual({ workspace: false, scope: false });
  });

  it("leaves a route of a workspace the person is not in, or just switched away from", () => {
    const at = (routeWorkspace: string | null, active: string, previousActive: string | null) =>
      leavesRoute({
        routeWorkspace,
        memberships: ["webinson", "vocabulift"],
        active,
        previousActive,
      });
    expect(at("acme", "webinson", null)).toBe(true);
    expect(at("webinson", "webinson", null)).toBe(false);
    expect(at("webinson", "vocabulift", "webinson")).toBe(true);
    expect(at("vocabulift", "vocabulift", "webinson")).toBe(false);
    expect(at(null, "vocabulift", "webinson")).toBe(false);
    expect(at("@local", "vocabulift", "webinson")).toBe(false);
  });
});
