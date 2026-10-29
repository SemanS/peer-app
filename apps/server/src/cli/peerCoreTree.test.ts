import { assert, describe, it } from "@effect/vitest";

import * as Tree from "./peerCoreTree.ts";

const areas: ReadonlyArray<Tree.TreeArea> = [
  {
    name: "Inference",
    tasks: [
      { id: "i1", title: "Add inference scheduling", openspec: true },
      { id: "i2", title: "Add GPU inference node" },
    ],
  },
  { name: "Audio", owner: "bob@acme.test", tasks: [{ id: "a1", title: "Split speakers" }] },
  { name: "Evaluation", tasks: [] },
  { name: null, tasks: [{ id: "n1", title: "Loose task" }] },
];

/** Presses keys in order from a fresh tree; the state after them. */
const after = (keys: ReadonlyArray<string>, state = Tree.initialTree(areas)) =>
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
      ["all", "area", "areaAll", "task", "task", "area", "area", "area", "continue"],
    );
    const closed = after(["down", "down", "down", "left"], open);
    assert.strictEqual(closed.cursor, 1);
    assert.deepStrictEqual(Tree.frame(closed, "Select areas or tasks")[2], "❯ ▸ [ ] Inference (2)");
  });

  it("chooses whole areas or single tasks, never a task twice, and shows a partly chosen area", () => {
    // Open Inference and choose one of its tasks: the area shows [-].
    let state = after(["down", "right", "down", "down", "space"]);
    assert.deepStrictEqual(Tree.selection(state), { all: false, areas: [], tasks: ["i1"] });
    assert.include(marks(state), "area:some");
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
    assert.deepStrictEqual(Tree.describe(areas, Tree.selection(state)), [
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
});
