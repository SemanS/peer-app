import type { WorkProjectNode, WorkTaskNode } from "@t3tools/client-runtime/peer/work";
import type { PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rowInset, settleTaskInput, taskLaunchPrompt, taskListRows } from "./taskTree.logic";

const node = (id: string, patch: Partial<WorkTaskNode> = {}): WorkTaskNode => ({
  id,
  key: undefined,
  title: `Title ${id}`,
  done: false,
  status: "idle",
  threads: [],
  removable: false,
  context: undefined,
  depth: 0,
  kind: "task",
  executable: true,
  unsettled: false,
  childCount: 0,
  ...patch,
});

const hubTask = (row: WorkTaskNode): PeerTask =>
  ({
    id: row.id,
    title: row.title,
    status: row.done ? "done" : "open",
    createdAt: "2026-10-29T00:00:00.000Z",
  }) as unknown as PeerTask;

const project = (nodes: ReadonlyArray<WorkTaskNode>): WorkProjectNode =>
  ({
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "kirkwood",
    name: "Kirkwood",
    areas: [{ name: null, tasks: nodes }],
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks: nodes.map(hubTask),
  }) as WorkProjectNode;

// A group with two items, one of them unsettled with a step under it, and a plain root task.
const tree = project([
  node("g", {
    kind: "group",
    executable: false,
    childCount: 2,
    progress: { done: 3, total: 8 },
  }),
  node("a", { parent: "g", depth: 1 }),
  node("u", { parent: "g", depth: 1, executable: false, unsettled: true, childCount: 1 }),
  node("s", { parent: "u", depth: 2 }),
  node("t"),
]);

describe("taskListRows", () => {
  it("lists the tree in order with depth, progress and the unsettled mark", () => {
    expect(
      taskListRows(tree).map((row) => [row.task.id, row.depth, row.progress, row.unsettled]),
    ).toEqual([
      ["g", 0, "3/8", false],
      ["a", 1, null, false],
      ["u", 1, null, true],
      ["s", 2, null, false],
      ["t", 0, null, false],
    ]);
  });

  it("keeps a done parent while an open item sits under it, and drops other done tasks", () => {
    const rows = taskListRows(
      project([
        node("g", { kind: "group", executable: false, done: true, childCount: 2 }),
        node("a", { parent: "g", depth: 1, done: true }),
        node("b", { parent: "g", depth: 1 }),
        node("x", { done: true }),
      ]),
    );
    expect(rows.map((row) => row.task.id)).toEqual(["g", "b"]);
  });

  it("shows no progress for a parent with nothing executable under it", () => {
    const rows = taskListRows(project([node("g", { progress: { done: 0, total: 0 } })]));
    expect(rows[0]?.progress).toBeNull();
  });

  it("indents a step per level", () => {
    expect([0, 1, 2].map(rowInset)).toEqual([16, 32, 48]);
  });
});

describe("taskLaunchPrompt", () => {
  it("keeps today's prompt for an executable leaf", () => {
    expect(taskLaunchPrompt(tree, { id: "t", key: "KRK-1", title: "Title t" })).toBe(
      "KRK-1: Title t",
    );
  });

  it("lists a group's open executable items", () => {
    expect(taskLaunchPrompt(tree, { id: "g", key: undefined, title: "Title g" })).toBe(
      [
        'Work on the Peer group "Title g" (g) in Kirkwood: its open items, in order:',
        "- a Title a",
        "- s Title s",
        "Mark each item done with peer task set <id> --status done as you finish it; peer done on the group finishes the group itself.",
      ].join("\n"),
    );
  });

  it("falls back to today's prompt when the tree does not know the task", () => {
    expect(taskLaunchPrompt(undefined, { id: "z", key: undefined, title: "Z" })).toBe("Z");
  });
});

describe("settleTaskInput", () => {
  const target = { workspace: "acme", projectId: "kirkwood", taskId: "u" };
  it("runs it as one task or by its parts, and clears unsettled either way", () => {
    expect(settleTaskInput(target, "one")).toEqual({
      ...target,
      executable: true,
      unsettled: false,
    });
    expect(settleTaskInput(target, "parts")).toEqual({
      ...target,
      executable: false,
      unsettled: false,
    });
  });
});
