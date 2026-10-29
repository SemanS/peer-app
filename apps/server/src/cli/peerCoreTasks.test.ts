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

/** add-x: a group, its section, an unsettled item with items, one item Bob's, one done. */
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
    assert.deepStrictEqual(
      PeerCoreTasks.taskLines({
        tasks,
        owners: { r2: "bob@acme.test" },
        filter: "all",
        email: null,
      }),
      [
        "LOOSE · Loose · open · no area · nobody",
        "X · add-x 1/4 · open · Hub · nobody",
        "  S2 · 2. Server · open · Hub · nobody",
        "    ? R · Routes 0/2 · open · Hub · nobody",
        "      R1 · Create · open · Hub · nobody",
        "      R2 · Delete · open · Hub · bob@acme.test",
      ],
    );
  });

  it("--open and --mine keep the executable items they match and the items above them", () => {
    const mine = PeerCoreTasks.taskLines({
      tasks,
      owners: { s2: "ana@acme.test", r2: "bob@acme.test" },
      filter: "mine",
      email: "ana@acme.test",
    });
    // Create is Ana's through 2. Server; Delete is Bob's own.
    assert.deepStrictEqual(
      mine.map((line) => line.split(" · ")[0]),
      ["X", "  S2", "    ? R", "      R1"],
    );
    const open = PeerCoreTasks.taskLines({
      tasks,
      owners: { r2: "bob@acme.test" },
      filter: "open",
      email: "ana@acme.test",
    });
    assert.deepStrictEqual(
      open.map((line) => line.split(" · ")[0]),
      ["LOOSE", "X", "  S2", "    ? R", "      R1"],
    );
    // A Hub that does not say who owns what has nothing open to take.
    assert.deepStrictEqual(
      PeerCoreTasks.taskLines({ tasks, owners: undefined, filter: "open", email: null }),
      [],
    );
  });

  it("lists the root holding the invitation's task first", () => {
    const lines = PeerCoreTasks.taskLines({
      tasks,
      owners: {},
      filter: "all",
      email: null,
      first: (t) => t.id === "r1",
    });
    assert.strictEqual(lines[0], "X · add-x 1/4 · open · Hub · nobody");
  });

  it("builds the menus' tree: areas, items under their parents, done ones gone", () => {
    const [hub, none] = PeerCoreTasks.projectTree({
      areas: ["Hub", "Web"],
      tasks,
      owners: { r2: "bob@acme.test" },
      areaOwners: { Web: "cy@acme.test" },
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
      [routes.unsettled, routes.children.map((n) => `${n.id}:${n.owner ?? ""}`)],
      [true, ["r1:", "r2:bob@acme.test"]],
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
});
