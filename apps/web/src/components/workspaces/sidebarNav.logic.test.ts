import type { PeerHubStatus, PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  activeTaskCount,
  activeTasksText,
  doneTaskCount,
  needsYouText,
  sidebarNeedsCount,
} from "./sidebarNav.logic";
import type { WorkProjectNode, WorkTaskNode, WorkThreadNode } from "./workTree.logic";

function task(id: string, overrides: Partial<WorkTaskNode> = {}): WorkTaskNode {
  return {
    id,
    key: id.toUpperCase(),
    title: `Task ${id}`,
    done: false,
    status: "idle",
    threads: [],
    removable: true,
    ...overrides,
  };
}

function hubTask(id: string, status: PeerTask["status"]): PeerTask {
  return { id, title: id, status, createdBy: "ana@acme.test", createdAt: "", updatedAt: "" };
}

function project(
  tasks: ReadonlyArray<WorkTaskNode>,
  unsorted: ReadonlyArray<WorkThreadNode> = [],
  id = "ordering",
): WorkProjectNode {
  return {
    workspace: "webinson",
    workspaceName: "Webinson",
    projectId: id,
    name: id,
    areas: [{ name: "Orders", tasks }],
    unsorted,
    tasks: tasks.map((t) => hubTask(t.id, t.done ? "done" : "open")),
  };
}

describe("the sidebar's task counts", () => {
  const seven = ["a", "b", "c", "d", "e", "f", "g"].map((id) => task(id));
  const two = [task("x", { done: true }), task("y", { status: "done" })];
  const ordering = project([...seven, ...two]);

  it("count active and done tasks apart, never 9 together", () => {
    expect(activeTaskCount(ordering)).toBe(7);
    expect(doneTaskCount(ordering)).toBe(2);
  });

  it("show no zero", () => {
    expect(activeTasksText(7)).toBe("7 open");
    expect(activeTasksText(0)).toBeUndefined();
    expect(needsYouText(1)).toBe("1 needs you");
    expect(needsYouText(4)).toBe("4 need you");
    expect(needsYouText(0)).toBeUndefined();
  });
});

describe("sidebarNeedsCount", () => {
  const need = (project: string) => ({ workspace: "webinson", project }) as never;
  const status = {
    rooms: { waiting: [need("ordering")], mentions: [need("ordering"), need("receipts")] },
  } as unknown as Pick<PeerHubStatus, "rooms">;

  it("counts what waits in the rooms of the projects it is given", () => {
    const ordering = { workspace: "webinson", projectId: "ordering" };
    const receipts = { workspace: "webinson", projectId: "receipts" };
    expect(sidebarNeedsCount(status, [ordering])).toBe(2);
    expect(sidebarNeedsCount(status, [ordering, receipts])).toBe(3);
  });

  it("has nothing to count without rooms", () => {
    expect(sidebarNeedsCount({}, [{ workspace: "webinson", projectId: "ordering" }])).toBe(0);
  });
});
