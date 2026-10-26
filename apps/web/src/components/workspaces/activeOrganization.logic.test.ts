import { describe, expect, it } from "vite-plus/test";

import {
  organizationStatus,
  scopeAfterSwitch,
  shouldForgetWorkspaceKeys,
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

  it("forgets the workspace keys once signed out, and only then", () => {
    const named = { workspace: "webinson", scope: "webinson/app" };
    expect(shouldForgetWorkspaceKeys({ signedIn: false }, named)).toBe(true);
    expect(shouldForgetWorkspaceKeys({ signedIn: true }, named)).toBe(false);
    expect(shouldForgetWorkspaceKeys(null, named)).toBe(false);
    expect(
      shouldForgetWorkspaceKeys({ signedIn: false }, { workspace: null, scope: ALL_PROJECTS }),
    ).toBe(false);
    expect(
      shouldForgetWorkspaceKeys({ signedIn: false }, { workspace: null, scope: "local:abc" }),
    ).toBe(false);
  });
});
