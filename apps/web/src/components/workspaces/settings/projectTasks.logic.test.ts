import { describe, expect, it } from "vite-plus/test";

import { removalQuestion } from "../taskTree.logic";
import type { WorkTaskNode } from "../workTree.logic";
import {
  groupTitleProblem,
  inHeldOrder,
  movedOrder,
  positionAfter,
  positionChanges,
  removalMoves,
  siblingsUnder,
  structureMenuItems,
} from "./projectTasks.logic";

const node = (id: string, parent?: string) => ({ id, parent }) as WorkTaskNode;

describe("groupTitleProblem", () => {
  it("wants a name the Hub keeps whole", () => {
    expect(groupTitleProblem("  ")).toBe("empty");
    expect(groupTitleProblem("x".repeat(121))).toBe("long");
    expect(groupTitleProblem(` ${"x".repeat(120)} `)).toBeNull();
  });
});

describe("siblingsUnder", () => {
  it("lists one level, the roots for no parent", () => {
    const tasks = [node("a"), node("b", "a"), node("c", "b"), node("d")];
    expect(siblingsUnder(tasks, undefined).map((task) => task.id)).toEqual(["a", "d"]);
    expect(siblingsUnder(tasks, "a").map((task) => task.id)).toEqual(["b"]);
  });
});

describe("reordering siblings", () => {
  it("moves a row to where it was dropped, either way", () => {
    expect(movedOrder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(movedOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(movedOrder(["a", "b"], "a", "gone")).toEqual(["a", "b"]);
  });

  it("writes only the positions that change", () => {
    const positions = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    expect(positionChanges(["b", "a", "c"], positions)).toEqual([
      { taskId: "b", position: 0 },
      { taskId: "a", position: 1 },
    ]);
  });

  it("spreads siblings that all share the default position", () => {
    const positions = new Map<string, number | undefined>([
      ["a", undefined],
      ["b", 0],
      ["c", 0],
    ]);
    expect(positionChanges(["b", "c", "a"], positions)).toEqual([
      { taskId: "c", position: 1 },
      { taskId: "a", position: 2 },
    ]);
  });

  it("holds the dropped order and keeps a sibling that came since last", () => {
    const shown = inHeldOrder([node("a"), node("new"), node("b")], ["b", "a"]);
    expect(shown.map((task) => task.id)).toEqual(["b", "a", "new"]);
  });

  it("puts a new item after its siblings", () => {
    expect(positionAfter([])).toBe(0);
    expect(positionAfter([undefined, 0])).toBe(1);
    expect(positionAfter([4, 2])).toBe(5);
  });
});

describe("removalMoves", () => {
  const positions = new Map([
    ["before", 0],
    ["group", 1],
    ["after", 2],
    ["a", 0],
    ["b", 1],
  ]);
  const removing = {
    area: undefined,
    items: ["a", "b"],
    siblings: ["before", "group", "after"],
    positions,
  };

  it("puts the items where the item stood and makes room after them", () => {
    expect(removalMoves({ ...removing, task: { id: "group", parent: "root" } })).toEqual([
      { taskId: "a", parent: "root", position: 1 },
      { taskId: "b", parent: "root", position: 2 },
      { taskId: "after", position: 3 },
    ]);
  });

  it("makes the items roots of a root's area", () => {
    const moves = removalMoves({ ...removing, area: "Checkout", task: { id: "group" } as never });
    expect(moves[0]).toEqual({ taskId: "a", parent: "", area: "Checkout", position: 1 });
  });

  it("writes nothing for an item with no items whose neighbours keep their places", () => {
    const moves = removalMoves({
      ...removing,
      items: [],
      siblings: ["group", "after"],
      positions: new Map([
        ["group", 3],
        ["after", 0],
      ]),
      task: { id: "group", parent: "root" },
    });
    expect(moves).toEqual([]);
  });
});

describe("structureMenuItems", () => {
  const ids = (input: Parameters<typeof structureMenuItems>[0]) =>
    structureMenuItems(input).map((item) => item.id);

  it("offers a group's way back to a task", () => {
    expect(ids({ task: { kind: "group", removable: true }, tree: true })).toEqual([
      "add-under",
      "move-under",
      "make-task",
      "rename",
      "remove",
    ]);
    expect(ids({ task: { kind: "task", removable: false }, tree: true })).toContain("make-group");
  });

  it("offers nothing a Hub without a tree can do, and removing only to those who may", () => {
    expect(ids({ task: { kind: "task", removable: false }, tree: false })).toEqual(["rename"]);
  });
});

describe("removalQuestion", () => {
  it("says where the items go", () => {
    const task = { key: undefined, title: "Editor" };
    expect(removalQuestion(task, 0)[1]).toBe("Its chats stay, on no task.");
    expect(removalQuestion(task, 1)[1]).toContain("Its 1 item moves up a level.");
    expect(removalQuestion(task, 3)[1]).toContain("Its 3 items move up a level.");
  });
});
