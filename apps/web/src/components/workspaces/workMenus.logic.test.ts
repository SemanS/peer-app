import { describe, expect, it } from "vite-plus/test";

import { canRemoveProject, projectMenuItems } from "./workMenus.logic";

describe("canRemoveProject", () => {
  it("lets whoever shared a project, and the workspace's owner or admins, remove it", () => {
    const shared = { addedBy: "ana@acme.test" };
    expect(
      canRemoveProject({ project: shared, workspaceRole: "member", email: "ana@acme.test" }),
    ).toBe(true);
    expect(
      canRemoveProject({ project: shared, workspaceRole: "member", email: "bob@acme.test" }),
    ).toBe(false);
    expect(
      canRemoveProject({ project: shared, workspaceRole: "admin", email: "bob@acme.test" }),
    ).toBe(true);
    expect(
      canRemoveProject({ project: shared, workspaceRole: "owner", email: "bob@acme.test" }),
    ).toBe(true);
  });

  it("keeps a project from the workspace's configuration out of the menu", () => {
    expect(canRemoveProject({ project: {}, workspaceRole: "owner", email: "ana@acme.test" })).toBe(
      false,
    );
    expect(projectMenuItems({ removable: false })).toEqual([]);
    expect(projectMenuItems({ removable: true }).map((item) => item.id)).toEqual([
      "remove-project",
    ]);
  });
});
