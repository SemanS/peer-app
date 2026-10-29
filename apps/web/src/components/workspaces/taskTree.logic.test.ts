import type { PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canLaunch,
  emptySelection,
  kindChange,
  liveSelection,
  selectableTask,
  selectionMark,
  selectionPrompt,
  selectionRoots,
  selectRange,
  toggleSelected,
  treeIndexOf,
  unsettledIn,
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

describe("picking several tasks", () => {
  // The open tasks of the fixture: g with b and c under it, and r; a is done and never a row.
  const index = treeIndexOf(project);
  const rows = [g, b, c, r].map((task) => selectableTask(index, "hub", task));
  const shown = ["g", "b", "c", "r"];
  const none = emptySelection("hub");
  const marks = (selection: ReturnType<typeof emptySelection>) =>
    shown.map((key) => selectionMark(selection, rows, key));

  it("checks a row with everything under it, and unchecks it the same way", () => {
    const all = toggleSelected(none, rows, "g");
    expect([...all.keys].toSorted()).toEqual(["b", "c", "g"]);
    expect(marks(all)).toEqual(["checked", "checked", "checked", "unchecked"]);
    expect(toggleSelected(all, rows, "g").keys.size).toBe(0);
  });

  it("shows a row partial once something under it is taken out", () => {
    // c is all there is under b, so taking it out leaves nothing of g checked.
    expect(toggleSelected(toggleSelected(none, rows, "g"), rows, "c").keys.size).toBe(0);
    const some = toggleSelected(none, rows, "c");
    expect(marks(some)).toEqual(["partial", "partial", "checked", "unchecked"]);
    expect(marks(toggleSelected(toggleSelected(none, rows, "b"), rows, "r"))).toEqual([
      "partial",
      "checked",
      "checked",
      "checked",
    ]);
  });

  it("picks the shown rows between the last one picked and a Shift-clicked one", () => {
    const fromB = toggleSelected(none, rows, "b");
    expect(selectRange(fromB, rows, shown, "r").keys).toEqual(new Set(["b", "c", "r"]));
    expect(selectRange(toggleSelected(none, rows, "r"), rows, shown, "g").keys).toEqual(
      new Set(["r", "g", "b", "c"]),
    );
    // Without an anchor it is a plain toggle.
    expect(selectRange(none, rows, shown, "r").keys).toEqual(new Set(["r"]));
  });

  it("keeps one project's tasks: picking another project's starts over", () => {
    const other = [...rows, { key: "x", ancestors: [], project: "web" }];
    const mixed = toggleSelected(toggleSelected(none, other, "r"), other, "x");
    expect([...mixed.keys]).toEqual(["x"]);
    expect(selectRange(toggleSelected(none, other, "g"), other, [...shown, "x"], "x").keys).toEqual(
      new Set(["x"]),
    );
  });

  it("clears on another scope and drops rows that are gone or done", () => {
    const picked = toggleSelected(toggleSelected(none, rows, "r"), rows, "b");
    expect(liveSelection(picked, "web", rows).keys.size).toBe(0);
    expect([...liveSelection(picked, "hub", rows.slice(0, 3)).keys].toSorted()).toEqual(["b", "c"]);
    expect(toggleSelected(none, rows, "a").keys.size).toBe(0);
  });

  it("starts on the roots: a picked ancestor covers what sits under it", () => {
    const picked = toggleSelected(toggleSelected(none, rows, "g"), rows, "r");
    expect(selectionRoots(picked, rows)).toEqual(["g", "r"]);
    expect(selectionRoots(toggleSelected(none, rows, "c"), rows)).toEqual(["c"]);
  });

  it("gives one agent a prompt naming each root, or the launcher's own for one", () => {
    const settled = {
      ...project,
      areas: [{ name: "Core", tasks: [g, a, { ...b, unsettled: false }, c] }],
    };
    expect(selectionPrompt(project, [r])).toBeUndefined();
    expect(selectionPrompt(project, [])).toBeUndefined();
    const lines = selectionPrompt(settled, [c, r])!.split("\n");
    expect(lines[0]).toBe("Work on these 2 Peer scopes, in this order:");
    expect(lines.slice(1)).toEqual([
      "",
      '1. Work on the Peer task "C" (c).',
      "",
      '2. Work on the Peer task "R" (r).',
      "",
      "Mark each item done with peer task set <id> --status done as you finish it; peer done finishes the scope you are on.",
    ]);
    expect(selectionPrompt(settled, [g, r])!.split("\n")[0]).toBe(
      "Work on these 2 Peer scopes in Hub, in this order:",
    );
  });

  it("waits while a picked item is unsettled, and not for a done one", () => {
    expect(unsettledIn([r, b])).toBe(b);
    expect(unsettledIn([r, c])).toBeUndefined();
    expect(unsettledIn([{ ...b, done: true }])).toBeUndefined();
  });
});
