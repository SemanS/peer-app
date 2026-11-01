import { assert, describe, it } from "@effect/vitest";

import * as Tree from "./peerCoreTree.ts";

const task = (id: string, title: string, more: Partial<Tree.TreeNode> = {}): Tree.TreeNode => ({
  id,
  title,
  kind: "task",
  children: [],
  ...more,
});

/** A group with a section, whose unsettled item has items of its own. */
const change: ReadonlyArray<Tree.TreeNode> = [
  Tree.areaNode("Hub", [
    {
      id: "g1",
      title: "add-x",
      kind: "group",
      executable: false,
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
              children: [task("t3", "Model"), task("t4", "Store")],
            }),
          ],
        },
      ],
    },
  ]),
  Tree.areaNode(null, [task("n1", "Loose")]),
];

describe("a scope's items", () => {
  it("lists a scope's open executable items", () => {
    assert.deepStrictEqual(
      Tree.openItems(change[0]!).map((n) => n.id),
      ["t3", "t4"],
    );
  });
});

describe("the start tree", () => {
  const withNew = [...change, task("\0new", "New task…")];
  const start = (keys: ReadonlyArray<string>, state = Tree.initialStart(withNew)) => {
    let current = state;
    for (const key of keys) {
      const next = Tree.startPress(current, key);
      if ("done" in next) return next.done;
      current = next.state;
    }
    return current;
  };

  it("picks the row Enter is on while nothing is marked, an action row always alone", () => {
    assert.deepStrictEqual(start(["enter"]), [{ kind: "area", id: "Hub" }]);
    assert.deepStrictEqual(start(["right", "down", "enter"]), [{ kind: "group", id: "g1" }]);
    assert.deepStrictEqual(start(["down", "down", "enter"]), [{ kind: "task", id: "\0new" }]);
    // Space on an action row marks nothing; Continue with nothing marked is an empty set.
    assert.deepStrictEqual(start(["down", "down", "space", "down", "enter"]), []);
  });

  it("marks scopes at any level and ends on Continue with them in tree order", () => {
    // Hub ▾, add-x ▾: mark 2. Hub feature, then the tasks without an area (an area like any).
    const state = start(["right", "down", "right", "down", "space", "down", "space"]);
    assert("nodes" in state);
    assert.deepStrictEqual(Tree.frame(state, "Which task?").slice(1, -1), [
      "  ▾ [-] Hub (6)",
      "    ▾ [-] add-x (1/3)",
      "      ▸ [x] 2. Hub feature (1/3)",
      "❯ ▸ [x] No area (1)",
      "    New task…",
      "  Continue",
    ]);
    // Enter on a row with items opens it now, rather than picking it.
    const opened = start(["enter"], state);
    assert("nodes" in opened);
    assert.strictEqual(Tree.frame(opened, "Which task?")[5], "      [x] Loose");
    assert.deepStrictEqual(start(["down", "down", "down", "enter"], opened), [
      { kind: "group", id: "g2" },
      { kind: "area", id: "" },
    ]);
    // Marking the area takes the group into it: never one task twice.
    assert.deepStrictEqual(
      start(["up", "up", "up", "space", "down", "down", "down", "down", "down", "enter"], state),
      [
        { kind: "area", id: "Hub" },
        { kind: "area", id: "" },
      ],
    );
  });

  it("opens the way down to a node it is asked to expand", () => {
    const state = Tree.initialStart(withNew, { kind: "task", id: "t2" });
    const row = Tree.rows(state)[state.cursor]!;
    assert.strictEqual(row.kind === "node" ? row.node.id : row.kind, "t2");
    assert.deepStrictEqual(
      Tree.rows(state).flatMap((r) => (r.kind === "node" ? [r.node.id] : [])),
      ["Hub", "g1", "g2", "t1", "t2", "t3", "t4", "", "\0new"],
    );
    // One area opens on its own.
    assert.deepStrictEqual(
      Tree.rows(Tree.initialStart([change[0]!])).map((r) => r.kind),
      ["node", "node", "continue"],
    );
  });

  it("covers a node's items, and one item out of it leaves the rest marked", () => {
    // Hub ▾, add-x ▾, 2. Hub feature ▾, Server ▾, then mark 2. Hub feature.
    const state = start([
      "right",
      "down",
      "right",
      "down",
      "right",
      "down",
      "down",
      "right",
      "up",
      "up",
      "space",
    ]);
    assert("nodes" in state);
    assert.deepStrictEqual(Tree.marked(state), [{ kind: "group", id: "g2" }]);
    assert.deepStrictEqual(
      Tree.rows(state)
        .slice(2, 7)
        .map((row) => Tree.mark(state, row)),
      ["on", "on", "on", "on", "on"],
    );
    // Model out of it: Routes and Store stay marked beside it, never Model, never twice.
    const less = start(["down", "down", "down", "space"], state);
    assert("nodes" in less);
    assert.deepStrictEqual(Tree.marked(less), [
      { kind: "task", id: "t1" },
      { kind: "task", id: "t4" },
    ]);
    assert.strictEqual(Tree.mark(less, Tree.rows(less)[4]!), "some");
    // Marking add-x again takes the single ones into it.
    const whole = start(["up", "up", "up", "up", "space"], less);
    assert("nodes" in whole);
    assert.deepStrictEqual(Tree.marked(whole), [{ kind: "group", id: "g1" }]);
  });
});
