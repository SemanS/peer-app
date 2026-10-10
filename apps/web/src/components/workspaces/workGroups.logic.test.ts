import type { PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupOpenByDefault, groupTasks, taskGroup } from "./workGroups.logic";
import type { WorkAreaNode, WorkProjectNode, WorkTaskNode, WorkThreadNode } from "./workTree.logic";

function thread(overrides: Partial<WorkThreadNode> & Pick<WorkThreadNode, "key">): WorkThreadNode {
  return {
    title: overrides.key,
    person: "You",
    mine: true,
    status: "idle",
    delivery: "open",
    harness: undefined,
    branch: undefined,
    source: "peer",
    stale: false,
    open: undefined,
    placeable: true,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
    ...overrides,
  };
}

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

describe("taskGroup", () => {
  it("puts done work last, agents at work next, then what waits for review", () => {
    expect(taskGroup(task("a", { done: true, status: "working" }), "open")).toBe("done");
    expect(taskGroup(task("b"), "done")).toBe("done");
    expect(taskGroup(task("c", { status: "working" }), "review")).toBe("working");
    expect(taskGroup(task("d", { status: "blocked" }), "open")).toBe("working");
    expect(taskGroup(task("e"), "review")).toBe("review");
    expect(
      taskGroup(task("f", { threads: [thread({ key: "t", delivery: "review" })] }), "open"),
    ).toBe("review");
    expect(taskGroup(task("g"), "open")).toBe("idle");
    expect(taskGroup(task("h"), undefined)).toBe("idle");
  });
});

describe("groupTasks", () => {
  it("lists each task once, by group, in its area's order, and drops empty groups", () => {
    const groups = groupTasks(
      project(
        [
          { name: "Orders", tasks: [task("a"), task("b", { status: "working" }), task("c")] },
          { name: "Receipts", tasks: [task("d"), task("e", { done: true })] },
        ],
        [hubTask("a", "review"), hubTask("c", "open"), hubTask("d", "review")],
      ),
    );
    expect(groups.map((group) => [group.id, group.tasks.map((t) => t.task.id)])).toEqual([
      ["review", ["a", "d"]],
      ["working", ["b"]],
      ["idle", ["c"]],
      ["done", ["e"]],
    ]);
    expect(groups[0]!.tasks.map((t) => t.area)).toEqual(["Orders", "Receipts"]);
  });

  it("names areas only when the project has more than one", () => {
    const one = groupTasks(project([{ name: "Orders", tasks: [task("a")] }]));
    expect(one[0]!.tasks[0]!.area).toBeUndefined();
    const withOther = groupTasks(
      project([
        { name: "Orders", tasks: [task("a")] },
        { name: null, tasks: [task("b")] },
      ]),
    );
    expect(withOther[0]!.tasks.map((t) => t.area)).toEqual(["Orders", undefined]);
  });
});

describe("groupOpenByDefault", () => {
  it("opens idle work only while nothing is in review or at work, and never done work", () => {
    const fresh = groupTasks(
      project([{ name: null, tasks: [task("a"), task("b", { done: true })] }]),
    );
    expect(groupOpenByDefault("idle", fresh)).toBe(true);
    expect(groupOpenByDefault("done", fresh)).toBe(false);
    const busy = groupTasks(
      project([{ name: null, tasks: [task("a"), task("b", { status: "working" })] }]),
    );
    expect(groupOpenByDefault("idle", busy)).toBe(false);
    expect(groupOpenByDefault("working", busy)).toBe(true);
    expect(groupOpenByDefault("review", busy)).toBe(true);
  });
});
