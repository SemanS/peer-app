import type { PeerHubStatus, PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupTasks, taskHasOverlap } from "./workGroups.logic";
import type { WorkAreaNode, WorkProjectNode, WorkTaskNode } from "./workTree.logic";

function task(id: string, overrides: Partial<Omit<WorkTaskNode, "id">> = {}): WorkTaskNode {
  return {
    id,
    key: id.toUpperCase(),
    title: `Task ${id}`,
    done: false,
    status: "idle",
    threads: [],
    removable: true,
    context: undefined,
    ...overrides,
  };
}

function hubTask(id: string, status: PeerTask["status"]): PeerTask {
  return { id, title: id, status, createdBy: "ana@acme.dev", createdAt: "", updatedAt: "" };
}

function project(
  areas: ReadonlyArray<WorkAreaNode>,
  tasks: ReadonlyArray<PeerTask> = [],
): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "app",
    name: "app",
    areas,
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks,
  };
}

describe("groupTasks", () => {
  it("lists open tasks by area in the project's order and folds done ones into one group", () => {
    const groups = groupTasks(
      project(
        [
          { name: "Orders", tasks: [task("a"), task("b", { status: "working" }), task("c")] },
          { name: "Receipts", tasks: [task("d"), task("e", { done: true })] },
          { name: null, tasks: [task("f", { status: "done" })] },
        ],
        [hubTask("a", "review"), hubTask("c", "done"), hubTask("d", "open")],
      ),
    );
    expect(groups.map((group) => [group.title, group.tasks.map((t) => t.id)])).toEqual([
      ["Orders", ["a", "b"]],
      ["Receipts", ["d"]],
      ["Done", ["c", "e", "f"]],
    ]);
    expect(groups.map((group) => group.done)).toEqual([false, false, true]);
  });

  it("names tasks in no area Other beside named areas, and shows no heading when none is named", () => {
    const mixed = groupTasks(
      project([
        { name: "Orders", tasks: [task("a")] },
        { name: null, tasks: [task("b")] },
      ]),
    );
    expect(mixed.map((group) => group.title)).toEqual(["Orders", "Other"]);
    const unnamed = groupTasks(project([{ name: null, tasks: [task("a")] }]));
    expect(unnamed.map((group) => group.title)).toEqual([undefined]);
  });
});

describe("taskHasOverlap", () => {
  const session = (id: string, task: string | undefined) => ({
    id,
    workspace: "acme",
    project: "app",
    email: `${id}@acme.dev`,
    label: id,
    status: "working" as const,
    files: [],
    claims: [],
    local: false,
    ...(task === undefined ? {} : { task }),
  });
  const status = (state: "open" | "resolved", enabled = true) =>
    ({
      coordination: {
        enabled,
        sessions: [session("mine", "a"), session("eva", "b"), session("loose", undefined)],
        overlaps: [
          {
            id: "o1",
            workspace: "acme",
            project: "app",
            sessions: ["mine", "eva"],
            files: ["src/pay.ts"],
            state,
          },
        ],
      },
    }) as unknown as PeerHubStatus;

  it("marks each task one of the overlap's agents works on, while the overlap is open", () => {
    const where = { workspace: "acme", projectId: "app" };
    expect(taskHasOverlap(status("open"), where, "a")).toBe(true);
    expect(taskHasOverlap(status("open"), where, "b")).toBe(true);
    expect(taskHasOverlap(status("open"), where, "c")).toBe(false);
    expect(taskHasOverlap(status("resolved"), where, "a")).toBe(false);
    expect(taskHasOverlap(status("open", false), where, "a")).toBe(false);
    expect(taskHasOverlap(status("open"), { workspace: "acme", projectId: "web" }, "a")).toBe(
      false,
    );
  });
});
