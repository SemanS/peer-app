import type { PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canLaunch,
  kindChange,
  launchPrompt,
  nestProjectTasks,
  parentChoices,
  progressLabel,
  servesTree,
  settleChange,
  taskItems,
} from "./taskTree.logic";
import { listTreeRows } from "./workList.logic";
import type { WorkTaskCard } from "./workBoard.logic";
import type { WorkProjectNode, WorkTaskNode } from "./workTree.logic";

function node(id: string, overrides: Partial<WorkTaskNode> = {}): WorkTaskNode {
  return {
    id,
    key: undefined,
    title: id.toUpperCase(),
    done: false,
    status: "idle",
    threads: [],
    removable: true,
    context: undefined,
    depth: 0,
    kind: "task",
    executable: true,
    unsettled: false,
    childCount: 0,
    ...overrides,
  };
}

// g: a group with a (done) and b (unsettled, with c under it); r: a root task without an area.
const g = node("g", {
  kind: "group",
  executable: false,
  childCount: 2,
  progress: { done: 1, total: 2 },
});
const a = node("a", { parent: "g", depth: 1, done: true });
const b = node("b", { parent: "g", depth: 1, executable: false, unsettled: true, childCount: 1 });
const c = node("c", { parent: "b", depth: 2 });
const r = node("r");

function hubTask(id: string, overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    id,
    title: id,
    status: "open",
    createdBy: "ana@example.com",
    createdAt: "2026-10-29T10:00:00Z",
    updatedAt: "2026-10-29T10:00:00Z",
    ...overrides,
  };
}

const project: WorkProjectNode = {
  workspace: "acme",
  workspaceName: "Acme",
  projectId: "hub",
  name: "Hub",
  areas: [
    { name: "Core", tasks: [g, a, b, c] },
    { name: null, tasks: [r] },
  ],
  unsorted: [],
  context: undefined,
  candidates: 0,
  tasks: [g, a, b, c, r].map((task) => hubTask(task.id, { executable: task.executable })),
};

describe("servesTree", () => {
  it("knows a Hub with a tree by the executable it sends on every task", () => {
    expect(servesTree(project)).toBe(true);
    expect(servesTree({ tasks: [hubTask("x"), hubTask("y")] })).toBe(false);
  });
});

describe("progressLabel", () => {
  it("counts an item's done executable items, and says nothing without any", () => {
    expect(progressLabel(g)).toBe("1/2");
    expect(progressLabel(r)).toBeNull();
    expect(progressLabel({ progress: { done: 0, total: 0 } })).toBeNull();
  });
});

describe("nestProjectTasks", () => {
  it("indents an item under its parent's row in the tree's order, whatever order it came in", () => {
    const rows = nestProjectTasks(project, [r, c, b, g]);
    expect(rows.map((row) => [row.item.id, row.indent, row.children])).toEqual([
      ["r", 0, 0],
      ["g", 0, 1],
      ["b", 1, 1],
      ["c", 2, 0],
    ]);
  });

  it("puts an item whose parent shows elsewhere under its nearest shown ancestor, or at the top", () => {
    const rows = nestProjectTasks(project, [g, c]);
    expect(rows.map((row) => [row.item.id, row.indent, row.underParent])).toEqual([
      ["g", 0, false],
      ["c", 1, false],
    ]);
    expect(nestProjectTasks(project, [c]).map((row) => row.indent)).toEqual([0]);
  });

  it("hides what sits under a collapsed row, and only that", () => {
    const rows = nestProjectTasks(project, [g, a, b, c, r], new Set(["b"]));
    expect(rows.map((row) => row.item.id)).toEqual(["g", "a", "b", "r"]);
    expect(rows.find((row) => row.item.id === "b")?.children).toBe(1);
  });
});

describe("listTreeRows", () => {
  const card = (task: WorkTaskNode, other = project): WorkTaskCard =>
    ({ kind: "task", key: `${other.projectId}:${task.id}`, project: other, task }) as WorkTaskCard;

  it("nests a status's rows by project, so equal ids of two projects never nest", () => {
    const elsewhere = { ...project, projectId: "web" };
    const rows = listTreeRows([card(c, elsewhere), card(g), card(b)], new Set());
    expect(rows.map((row) => [row.item.project.projectId, row.item.task.id, row.indent])).toEqual([
      ["web", "c", 0],
      ["hub", "g", 0],
      ["hub", "b", 1],
    ]);
  });

  it("folds a collapsed row by its project's key", () => {
    const rows = listTreeRows([card(g), card(b), card(c)], new Set(["acme/hub/g"]));
    expect(rows.map((row) => row.item.task.id)).toEqual(["g"]);
  });
});

describe("parentChoices", () => {
  it("lists the project's items in the tree's order, found by title or key", () => {
    expect(parentChoices(project, "").map((choice) => [choice.id, choice.depth])).toEqual([
      ["g", 0],
      ["a", 1],
      ["b", 1],
      ["c", 2],
      ["r", 0],
    ]);
    expect(parentChoices(project, " b ").map((choice) => choice.id)).toEqual(["b"]);
    expect(parentChoices(project, "").find((choice) => choice.id === "g")?.group).toBe(true);
  });

  it("never offers a task to move under itself or anything under it", () => {
    expect(parentChoices(project, "", "g").map((choice) => choice.id)).toEqual(["r"]);
    expect(parentChoices(project, "", "b").map((choice) => choice.id)).toEqual(["g", "a", "r"]);
  });
});

describe("tree changes", () => {
  it("settles an item as one task or by its parts, and someone decided either way", () => {
    expect(settleChange(true)).toEqual({ executable: true, unsettled: false });
    expect(settleChange(false)).toEqual({ executable: false, unsettled: false });
  });

  it("makes a group that never runs as one, and a task that does", () => {
    expect(kindChange("group")).toEqual({ kind: "group", executable: false, unsettled: false });
    expect(kindChange("task")).toEqual({ kind: "task", executable: true, unsettled: false });
  });
});

describe("launchPrompt", () => {
  it("keeps today's prompt for a task that runs as one and has no items", () => {
    expect(launchPrompt(project, r)).toBeUndefined();
    expect(launchPrompt(project, c)).toBeUndefined();
  });

  it("gives a group its open items, the same words every launcher uses", () => {
    const prompt = launchPrompt(project, g);
    expect(prompt).toContain('Work on the Peer group "G" (g) in Hub');
    expect(prompt).toContain("- c C");
    expect(prompt).not.toContain("- a A");
  });

  it("names a task that runs as one but has items as itself", () => {
    expect(launchPrompt(project, { ...b, executable: true, unsettled: false })).toBe(
      'Work on the Peer task "B" (b).',
    );
  });

  it("never starts an unsettled item", () => {
    expect(canLaunch(b)).toBe(false);
    expect(canLaunch(g)).toBe(true);
  });
});

describe("taskItems", () => {
  it("lists the subtree under a task with its state and progress, and starts only open work", () => {
    const rows = taskItems(project, g);
    expect(rows.map((row) => [row.task.id, row.indent, row.state.kind, row.canStart])).toEqual([
      ["a", 0, "done", false],
      ["b", 0, "new", false],
      ["c", 1, "new", true],
    ]);
    expect(taskItems(project, r)).toEqual([]);
  });
});
