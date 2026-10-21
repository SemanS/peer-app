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

describe("a task's chats and teammates in its menu", () => {
  const task: WorkTaskNode = {
    id: "ord-7",
    key: "ORD-7",
    title: "Order notes header",
    done: false,
    status: "idle",
    threads: [],
    removable: true,
    context: undefined,
  };

  it("starts a chat first, and says chat where it used to say thread", () => {
    const [first] = taskMenuItems({ task, canStartThread: true });
    expect(first).toMatchObject({ id: "new-thread", label: "New chat on this task" });
    expect(first?.disabled).toBe(false);
    expect(taskMenuItems({ task, canStartThread: false })[0]?.disabled).toBe(true);
  });

  it("keeps task details reachable when the task title opens Review", () => {
    const ordinary = taskMenuItems({ task, canStartThread: true });
    const review = taskMenuItems({ task, canStartThread: true, showTaskDetails: true });
    expect(review[0]).toMatchObject({ id: "task-details", label: "Task details" });
    expect(review.slice(1)).toEqual(ordinary);
  });

  it("asks a teammate right after it, only while a plugin can", () => {
    const ids = (canRequestTeammate: boolean | undefined) =>
      taskMenuItems({ task, canStartThread: true, canRequestTeammate }).map((item) => item.id);
    expect(ids(true)).toEqual([
      "new-thread",
      "request-teammate",
      "rename",
      "toggle-done",
      "remove",
    ]);
    expect(ids(false)).toEqual(["new-thread", "rename", "toggle-done", "remove"]);
    expect(ids(undefined)).toEqual(ids(false));
    const request = taskMenuItems({ task, canStartThread: true, canRequestTeammate: true })[1];
    expect(request?.label).toBe("Request a teammate…");
  });

  it("keeps the teammate item above the area move and its one divider", () => {
    const items = taskMenuItems({
      task,
      canStartThread: true,
      canRequestTeammate: true,
      areas: ["Orders"],
      area: "Orders",
    });
    expect(items.map((item) => item.id)).toEqual([
      "new-thread",
      "request-teammate",
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
});
