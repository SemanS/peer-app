import { describe, expect, it } from "vite-plus/test";

import type { WorkTaskNode } from "./workTree.logic";
import { canRemoveProject, chosenArea, projectMenuItems, taskMenuItems } from "./workMenus.logic";

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

describe("a task's Move to area", () => {
  const task: WorkTaskNode = {
    id: "bkg-806",
    key: "BKG-806",
    title: "Partner reconciliation",
    done: false,
    status: "working",
    threads: [],
    removable: true,
    context: undefined,
  };
  const areas = ["Payments", "Reservations", "Integrations", "Partner portal"];
  const menu = (area: string | undefined) =>
    taskMenuItems({ task, canStartThread: true, areas, area });
  const submenu = (area: string | undefined) =>
    menu(area).find((item) => item.id === "move-area")?.children ?? [];

  it("lists the project's areas in its order, the task's own marked", () => {
    expect(submenu("Reservations").map((item) => [item.label, item.checked])).toEqual([
      ["Payments", false],
      ["Reservations", true],
      ["Integrations", false],
      ["Partner portal", false],
      ["No area", false],
    ]);
  });

  it("offers a way out of an area, marked while the task is in none", () => {
    const out = submenu(undefined);
    expect(out.filter((item) => item.checked).map((item) => item.id)).toEqual(["no-area"]);
    expect(out.at(-1)).toMatchObject({ id: "no-area", separatorBefore: true });
  });

  it("sits between starting a thread and renaming, with one divider before it", () => {
    const items = menu("Payments");
    expect(items.map((item) => item.id)).toEqual([
      "new-thread",
      "move-area",
      "rename",
      "toggle-done",
      "remove",
    ]);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.id)).toEqual([
      "move-area",
      "remove",
    ]);
  });

  it("is not offered where the project has no areas, and the menu is as it was", () => {
    const plain = taskMenuItems({ task, canStartThread: true });
    expect(plain.map((item) => item.id)).toEqual(["new-thread", "rename", "toggle-done", "remove"]);
    expect(plain.find((item) => item.id === "rename")?.separatorBefore).toBe(true);
    expect(taskMenuItems({ task, canStartThread: true, areas: [] })).toEqual(plain);
  });

  it("names an area by what the project calls it, whatever characters that has", () => {
    const odd = ["Billing: EU", "area:1"];
    const items = taskMenuItems({ task, canStartThread: true, areas: odd, area: "area:1" });
    const children = items.find((item) => item.id === "move-area")?.children ?? [];
    expect(children.map((item) => item.id)).toEqual(["area:Billing: EU", "area:area:1", "no-area"]);
    expect(children.filter((item) => item.checked).map((item) => item.id)).toEqual(["area:area:1"]);
    expect(chosenArea("area:Billing: EU")).toEqual({ area: "Billing: EU" });
    expect(chosenArea("area:area:1")).toEqual({ area: "area:1" });
  });

  it("reads what a choice moves the task to, and leaves the others alone", () => {
    expect(chosenArea("area:Payments")).toEqual({ area: "Payments" });
    expect(chosenArea("no-area")).toEqual({ area: null });
    for (const other of ["move-area", "rename", "toggle-done", "new-thread", "remove", ""]) {
      expect(chosenArea(other)).toBeUndefined();
    }
  });
});
