import { assert, describe, it } from "@effect/vitest";
import type { PeerTask } from "@t3tools/contracts";

import { scopePrompt as clientScopePrompt } from "../../../../packages/client-runtime/src/peer/work.ts";
import * as PeerCoreTasks from "./peerCoreTasks.ts";

const task = (
  id: string,
  title: string,
  more: Partial<PeerTask> = {},
  createdAt = "2026-10-29T09:00:00Z",
): PeerTask => ({
  id,
  key: id.toUpperCase(),
  title,
  status: "open",
  createdBy: "ana@acme.test",
  createdAt,
  updatedAt: createdAt,
  ...more,
});

/** add-x: a group, its section, an unsettled item with items, one done. */
const tasks: ReadonlyArray<PeerTask> = [
  task("loose", "Loose", {}, "2026-10-29T08:00:00Z"),
  task("x", "add-x", {
    kind: "group",
    executable: false,
    area: "Hub",
    progress: { done: 1, total: 4 },
  }),
  task("s2", "2. Server", { kind: "group", executable: false, parent: "x", position: 1 }),
  // The Hub shows a parent whose items are all done as done.
  task("s1", "1. Model", {
    kind: "group",
    executable: false,
    parent: "x",
    position: 0,
    status: "done",
  }),
  task("m1", "Schema", { parent: "s1", status: "done" }),
  task("r", "Routes", {
    parent: "s2",
    executable: false,
    unsettled: true,
    progress: { done: 0, total: 2 },
  }),
  task("r2", "Delete", { parent: "r" }, "2026-10-29T09:02:00Z"),
  task("r1", "Create", { parent: "r" }, "2026-10-29T09:01:00Z"),
  task("old", "Old group", { kind: "group", executable: false, status: "done" }),
];

describe("peer core tasks as a tree", () => {
  it("prints the tree, two spaces a level, progress after a parent, ? before an unsettled item", () => {
    assert.deepStrictEqual(PeerCoreTasks.taskLines(tasks), [
      "LOOSE · Loose · open · no area",
      "X · add-x 1/4 · open · Hub",
      "  S2 · 2. Server · open · Hub",
      "    ? R · Routes 0/2 · open · Hub",
      "      R1 · Create · open · Hub",
      "      R2 · Delete · open · Hub",
    ]);
  });

  it("says how many runs agents had on a task", () => {
    const lines = PeerCoreTasks.taskLines([
      task("one", "One", { runs: { running: 1, detached: 0, ended: 0 } }, "2026-10-29T09:01:00Z"),
      task("two", "Two", { runs: { running: 0, detached: 1, ended: 2 } }, "2026-10-29T09:02:00Z"),
      task("none", "None", { runs: { running: 0, detached: 0, ended: 0 } }, "2026-10-29T09:03:00Z"),
      task("old", "Older Hub", {}, "2026-10-29T09:04:00Z"),
    ]);
    assert.deepStrictEqual(lines, [
      "ONE · One · open · no area · 1 run",
      "TWO · Two · open · no area · 3 runs",
      "NONE · None · open · no area",
      "OLD · Older Hub · open · no area",
    ]);
  });

  it("builds the menus' tree: areas, items under their parents, done ones gone", () => {
    const [hub, none] = PeerCoreTasks.projectTree({
      areas: ["Hub", "Web"],
      tasks,
    }).filter((node) => node.id !== "Web");
    assert.strictEqual(hub?.kind, "area");
    const x = hub!.children[0]!;
    assert.deepStrictEqual(
      [x.kind, x.executable, x.progress],
      ["group", false, { done: 1, total: 4 }],
    );
    // 1. Model's only item is done: it goes with it.
    assert.deepStrictEqual(
      x.children.map((n) => n.id),
      ["s2"],
    );
    const routes = x.children[0]!.children[0]!;
    assert.deepStrictEqual(
      [routes.unsettled, routes.children.map((n) => n.id)],
      [true, ["r1", "r2"]],
    );
    assert.deepStrictEqual(
      none!.children.map((n) => n.id),
      ["loose"],
    );
  });
});

describe("the scope prompt", () => {
  const items = Array.from({ length: 32 }, (_, i) => ({ id: `t${i}`, title: `Item ${i}` }));
  const scopes: ReadonlyArray<PeerCoreTasks.WorkScope> = [
    { kind: "task", id: "t1", title: "Cart" },
    { kind: "group", id: "g", title: "2. Server", project: "pay", items: items.slice(0, 2) },
    { kind: "group", id: "g", title: "Big", project: "pay", items },
    { kind: "area", name: "Checkout", project: "pay", items: items.slice(0, 3) },
    { kind: "area", name: null, project: "pay", items: [] },
  ];

  it("says what the apps say", () => {
    for (const scope of scopes)
      assert.strictEqual(PeerCoreTasks.scopePrompt(scope), clientScopePrompt(scope));
    assert.include(PeerCoreTasks.scopePrompt(scopes[2]!), "\nand 2 more\n");
  });

  const set: ReadonlyArray<PeerCoreTasks.WorkScope> = [scopes[0]!, scopes[1]!, scopes[3]!];

  it("words a set of scopes in order, one closing line for them all", () => {
    assert.strictEqual(
      PeerCoreTasks.scopePrompt(set),
      [
        "Work on these 3 Peer scopes in pay, in this order:",
        "",
        '1. Work on the Peer task "Cart" (t1).',
        "",
        '2. Work on the Peer group "2. Server" (g) in pay: its open items, in order:',
        "- t0 Item 0",
        "- t1 Item 1",
        "",
        '3. Work on the area "Checkout" of pay: its open tasks, in order:',
        "- t0 Item 0",
        "- t1 Item 1",
        "- t2 Item 2",
        "",
        "Mark each item done with peer task set <id> --status done as you finish it; peer ready says the scope is done.",
      ].join("\n"),
    );
    // A set of one is that scope's own words; tasks alone name no project.
    assert.strictEqual(
      PeerCoreTasks.scopePrompt([scopes[1]!]),
      PeerCoreTasks.scopePrompt(scopes[1]!),
    );
    assert.strictEqual(
      PeerCoreTasks.scopePrompt([scopes[0]!, { kind: "task", id: "t2", title: "Pay" }]).split(
        "\n",
      )[0],
      "Work on these 2 Peer scopes, in this order:",
    );
  });

  it("says for a set what the apps say", () => {
    for (const scope of [set, [scopes[1]!], [scopes[0]!, scopes[0]!]])
      assert.strictEqual(PeerCoreTasks.scopePrompt(scope), clientScopePrompt(scope));
  });
});
