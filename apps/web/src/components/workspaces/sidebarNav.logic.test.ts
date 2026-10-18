import type { PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  activeTaskCount,
  activeTasksText,
  doneTaskCount,
  needsYouText,
  pluginNavRows,
  sidebarNav,
  sidebarNeedsCount,
} from "./sidebarNav.logic";
import type { ProjectSignal } from "./slots.types";
import { taskCards } from "./workBoard.logic";
import type { WorkProjectNode, WorkTaskNode, WorkThreadNode } from "./workTree.logic";

function thread(key: string, overrides: Partial<WorkThreadNode> = {}): WorkThreadNode {
  return {
    key,
    title: `Chat ${key}`,
    person: "Slavo",
    mine: true,
    status: "idle",
    harness: "claude",
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

function task(id: string, overrides: Partial<WorkTaskNode> = {}): WorkTaskNode {
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
    context: undefined,
    candidates: 0,
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
    expect(activeTasksText(7)).toBe("7 active");
    expect(activeTasksText(0)).toBeUndefined();
    expect(needsYouText(1)).toBe("1 needs you");
    expect(needsYouText(4)).toBe("4 need you");
    expect(needsYouText(0)).toBeUndefined();
  });
});

describe("sidebarNeedsCount", () => {
  const waiting = thread("t1", { status: "blocked" });
  const colleague = thread("t2", { status: "blocked", mine: false, person: "Ana" });
  const other = project([task("a", { threads: [waiting, colleague] })], [], "receipts");
  const ordering = project(
    [task("b", { threads: [thread("t3", { status: "blocked" }), thread("t4")] })],
    [thread("t5", { status: "blocked" })],
  );
  const tree = [ordering, other];

  it("is the Needs you column of the board: tasks waiting on you, not on a colleague", () => {
    const column = taskCards(tree, { scope: "all", mine: false, query: "", needs: [] }).filter(
      (card) => card.column === "needs",
    );
    expect(sidebarNeedsCount(tree, [])).toBe(column.length);
    expect(sidebarNeedsCount(tree, [])).toBe(2);
  });

  it("counts one project, or the scope it is given", () => {
    expect(sidebarNeedsCount([other], [])).toBe(1);
    expect(sidebarNeedsCount(tree, [], "webinson/ordering")).toBe(1);
  });
});

describe("sidebarNav", () => {
  const open = ["a", "b", "c", "d", "e", "f", "g"].map((id) => task(id));
  const done = [task("x", { done: true }), task("y", { status: "done" })];
  const ordering = {
    ...project([...open, task("h", { threads: [thread("t1", { status: "blocked" })] })]),
    candidates: 2,
  };

  it("counts active and done tasks apart and never 9 together", () => {
    const nav = sidebarNav([project([...open, ...done])], []);
    expect(nav.active).toBe(7);
    expect(nav.done).toBe(2);
  });

  it("counts what waits on the person, and what is to keep", () => {
    const nav = sidebarNav([ordering], []);
    expect(nav.needs).toBe(1);
    expect(nav.toKeep).toBe(2);
  });

  it("hides every count that is zero", () => {
    expect(sidebarNav([project([task("a")])], [])).toEqual({
      needs: null,
      active: 1,
      done: null,
      toKeep: null,
      sharedContext: false,
    });
    expect(sidebarNav([], [])).toEqual({
      needs: null,
      active: null,
      done: null,
      toKeep: null,
      sharedContext: false,
    });
  });

  it("adds up the projects it is given", () => {
    const nav = sidebarNav(
      [project([task("a")], [], "p1"), project([task("b"), task("c")], [], "p2")],
      [],
    );
    expect(nav.active).toBe(3);
  });

  it("knows a shared context once an agent wrote one", () => {
    const context = { version: 3 } as unknown as WorkProjectNode["context"];
    expect(sidebarNav([{ ...project([]), context }], []).sharedContext).toBe(true);
    const empty = { version: 0 } as unknown as WorkProjectNode["context"];
    expect(sidebarNav([{ ...project([]), context: empty }], []).sharedContext).toBe(false);
  });
});

describe("pluginNavRows", () => {
  const signal = (id: string, navRow?: ProjectSignal["navRow"]): ProjectSignal => ({
    id,
    label: id,
    icon: (() => null) as unknown as ProjectSignal["icon"],
    count: null,
    detail: "",
    tone: "neutral",
    ...(navRow === undefined ? {} : { navRow }),
  });

  it("adds no row for signals that name none", () => {
    expect(pluginNavRows([signal("overlaps"), signal("knowledge")])).toEqual([]);
  });

  it("lists the rows of the signals that name one, in order", () => {
    const row = (label: string): NonNullable<ProjectSignal["navRow"]> => ({
      label,
      icon: (() => null) as unknown as ProjectSignal["icon"],
      open: () => {},
    });
    expect(
      pluginNavRows([signal("a", row("Changes")), signal("b"), signal("c", row("Preview"))]).map(
        ({ id, row: { label } }) => `${id}:${label}`,
      ),
    ).toEqual(["a:Changes", "c:Preview"]);
  });
});
