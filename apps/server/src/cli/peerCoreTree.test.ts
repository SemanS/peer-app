import { assert, describe, it } from "@effect/vitest";

import * as Tree from "./peerCoreTree.ts";

const task = (id: string, title: string, more: Partial<Tree.TreeNode> = {}): Tree.TreeNode => ({
  id,
  title,
  kind: "task",
  children: [],
  ...more,
});

const nodes: ReadonlyArray<Tree.TreeNode> = [
  Tree.areaNode("Inference", [
    task("i1", "Add inference scheduling", { openspec: true }),
    task("i2", "Add GPU inference node"),
  ]),
  Tree.areaNode("Audio", [task("a1", "Split speakers")], "bob@acme.test"),
  Tree.areaNode("Evaluation", []),
  Tree.areaNode(null, [task("n1", "Loose task")]),
];

/** An OpenSpec change: a group with a section, whose unsettled item has items of its own. */
const change: ReadonlyArray<Tree.TreeNode> = [
  Tree.areaNode("Hub", [
    {
      id: "g1",
      title: "add-x",
      kind: "group",
      executable: false,
      openspec: true,
      progress: { done: 1, total: 3 },
      children: [
        {
          id: "g2",
          title: "2. Hub feature",
          kind: "group",
          executable: false,
          progress: { done: 1, total: 3 },
          children: [
            task("t1", "Routes", { status: "done" }),
            task("t2", "Server", {
              executable: false,
              unsettled: true,
              children: [task("t3", "Model"), task("t4", "Store", { owner: "bob" })],
            }),
          ],
        },
      ],
    },
  ]),
  Tree.areaNode(null, [task("n1", "Loose")]),
];

/** Presses keys in order from a fresh tree; the state after them. */
const after = (keys: ReadonlyArray<string>, state = Tree.initialTree(nodes)) =>
  keys.reduce((current, key) => {
    const next = Tree.press(current, key);
    if ("done" in next) throw new Error("submitted");
    return next.state;
  }, state);

const marks = (state: Tree.TreeState) =>
  Tree.rows(state).map((row) => `${row.kind}:${Tree.mark(state, row)}`);

describe("the invite tree", () => {
  it("opens an area to its tasks and closes it back onto the area", () => {
    const open = after(["down", "right"]);
    assert.deepStrictEqual(
      Tree.rows(open).map((row) => row.kind),
      ["all", "node", "areaAll", "node", "node", "node", "node", "node", "continue"],
    );
    const closed = after(["down", "down", "down", "left"], open);
    assert.strictEqual(closed.cursor, 1);
    assert.deepStrictEqual(Tree.frame(closed, "Select areas or tasks")[2], "❯ ▸ [ ] Inference (2)");
  });

  it("chooses whole areas or single tasks, never a task twice, and shows a partly chosen area", () => {
    // Open Inference and choose one of its tasks: the area shows [-].
    let state = after(["down", "right", "down", "down", "space"]);
    assert.deepStrictEqual(Tree.selection(state), { all: false, areas: [], tasks: ["i1"] });
    assert.include(marks(state), "node:some");
    // Choosing the whole area takes the single task into it.
    state = after(["up", "space"], state);
    assert.deepStrictEqual(Tree.selection(state), { all: false, areas: ["Inference"], tasks: [] });
    // Taking a task out of a whole area leaves the others as single tasks.
    state = after(["down", "down", "space"], state);
    assert.deepStrictEqual(Tree.selection(state), { all: false, areas: [], tasks: ["i1"] });
  });

  it("takes one area out of everything, and the group without an area is its tasks", () => {
    const everything = after(["space"]);
    assert.deepStrictEqual(Tree.selection(everything), { all: true, areas: [], tasks: [] });
    // Audio out of everything: the other areas stay whole, the loose task stays chosen.
    const state = after(["down", "down", "space"], everything);
    assert.deepStrictEqual(Tree.selection(state), {
      all: false,
      areas: ["Inference", "Evaluation"],
      tasks: ["n1"],
    });
    assert.deepStrictEqual(Tree.describe(nodes, Tree.selection(state)), [
      "✓ Inference — all tasks, and new ones",
      "✓ Evaluation — all tasks, and new ones",
      "✓ No area — Loose task",
    ]);
  });

  it("continues with what is chosen", () => {
    const state = after(["down", "space", "up", "up"]);
    const done = Tree.press(state, "enter");
    assert.deepStrictEqual(done, { done: { all: false, areas: ["Inference"], tasks: [] } });
    assert.include(
      Tree.frame(state, "Select areas or tasks").join("\n"),
      "Audio (1) · bob@acme.test's",
    );
  });

  it("a group covers its items, and one item out of it leaves the rest chosen", () => {
    // Hub → add-x → 2. Hub feature → Server, each opened with →.
    let state = after(
      ["down", "right", "down", "down", "right", "down", "right", "down", "down", "right"],
      Tree.initialTree(change),
    );
    const frame = Tree.frame(state, "Select").slice(1, -1);
    assert.deepStrictEqual(frame, [
      "  [ ] All areas and tasks",
      "  ▾ [ ] Hub (6)",
      "      [ ] All tasks in Hub",
      "    ▾ [ ] add-x (1/3) · OpenSpec",
      "      ▾ [ ] 2. Hub feature (1/3)",
      "          [ ] Routes",
      "❯       ▾ [ ] Server ?",
      "            [ ] Model",
      "            [ ] Store · bob's",
      "  ▸ [ ] No area (1)",
      "  Continue",
    ]);
    // Choose the group: one id, which covers everything under it.
    state = after(["up", "up", "space"], state);
    assert.deepStrictEqual(Tree.selection(state).tasks, ["g2"]);
    assert.deepStrictEqual(marks(state).slice(4, 9), [
      "node:on",
      "node:on",
      "node:on",
      "node:on",
      "node:on",
    ]);
    assert.deepStrictEqual(Tree.describe(change, Tree.selection(state)), [
      "✓ Hub — 2. Hub feature, with its items",
    ]);
    // Model out of it: Routes and Store stay chosen beside it, never Model, never twice.
    state = after(["down", "down", "down", "space"], state);
    assert.deepStrictEqual(Tree.selection(state).tasks.toSorted(), ["t1", "t4"]);
    assert.include(marks(state), "node:some");
    // Choosing add-x again takes the single ones into it.
    state = after(["up", "up", "up", "up", "space"], state);
    assert.deepStrictEqual(Tree.selection(state).tasks, ["g1"]);
  });
});

describe("the pick tree", () => {
  const pick = (keys: ReadonlyArray<string>, state = Tree.initialPick(change)) => {
    let current = state;
    for (const key of keys) {
      const next = Tree.pickPress(current, key);
      if ("done" in next) return next.done;
      current = next.state;
    }
    return current;
  };

  it("returns any row Enter is on: an area, a group or a task", () => {
    assert.deepStrictEqual(pick(["enter"]), { kind: "area", id: "Hub" });
    assert.deepStrictEqual(pick(["right", "down", "enter"]), { kind: "group", id: "g1" });
    assert.deepStrictEqual(pick(["down", "enter"]), { kind: "area", id: "" });
    // Space selects nothing here.
    assert.deepStrictEqual(pick(["space", "enter"]), { kind: "area", id: "Hub" });
  });

  it("opens and closes with the arrows, ← on an item closing its parent", () => {
    const state = pick(["right", "down", "right", "down", "right", "down", "down"]);
    assert("nodes" in state);
    assert.deepStrictEqual(Tree.pickFrame(state, "Which task?").slice(1, -1), [
      "  ▾ Hub (6)",
      "    ▾ add-x (1/3) · OpenSpec",
      "      ▾ 2. Hub feature (1/3)",
      "          Routes",
      "❯       ▸ Server ?",
      "  ▸ No area (1)",
    ]);
    const closed = pick(["left", "left"], state);
    assert("nodes" in closed);
    assert.deepStrictEqual(Tree.pickRows(closed)[closed.cursor]?.node.id, "g1");
  });

  it("opens the way down to a node it is asked to expand, the cursor on it", () => {
    const state = Tree.initialPick(change, { kind: "task", id: "t2" });
    const row = Tree.pickRows(state)[state.cursor]!;
    assert.strictEqual(row.node.id, "t2");
    assert.deepStrictEqual(
      Tree.pickRows(state).map((r) => r.node.id),
      ["Hub", "g1", "g2", "t1", "t2", "t3", "t4", ""],
    );
    // One area opens on its own.
    assert.deepStrictEqual(
      Tree.pickRows(Tree.initialPick([change[0]!])).map((r) => r.node.id),
      ["Hub", "g1"],
    );
  });

  it("lists a scope's open executable items", () => {
    assert.deepStrictEqual(
      Tree.openItems(change[0]!).map((n) => n.id),
      ["t3", "t4"],
    );
  });
});
