import { EnvironmentId } from "@t3tools/contracts";
import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import { describe, expect, it } from "vite-plus/test";

import { ALL_PROJECTS, taskCards, type TaskCard } from "./workBoard.logic";
import {
  chatsLabel,
  COLUMN_STATE,
  listCounts,
  listGroups,
  listRows,
  listSelectableRows,
  otherNeeds,
  stateText,
  taskStateTone,
} from "./workList.logic";
import type { WorkProjectNode, WorkTaskNode, WorkThreadNode } from "./workTree.logic";

function chat(key: string, overrides: Partial<WorkThreadNode> = {}): WorkThreadNode {
  return {
    key,
    title: key,
    person: "Slavo",
    mine: true,
    status: "idle",
    delivery: "open",
    harness: undefined,
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

function task(
  id: string,
  threads: ReadonlyArray<WorkThreadNode>,
  overrides: Partial<WorkTaskNode> = {},
): WorkTaskNode {
  return {
    id,
    key: id.toUpperCase(),
    title: `Task ${id}`,
    done: false,
    status: "idle",
    threads,
    removable: true,
    context: undefined,
    ...overrides,
  };
}

function project(tasks: ReadonlyArray<WorkTaskNode>): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "ordering",
    name: "Ordering",
    areas: [{ name: null, tasks }],
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks: [],
  };
}

/** A teammate's request in Needs you, on the project the tests build. */
const request: NeedsYouItem = {
  environmentId: EnvironmentId.make("env-here"),
  environmentLabel: "This Mac",
  offline: false,
  hubError: false,
  kind: "request",
  key: "request:acme:r1",
  title: "Rerun the camp import",
  rank: 2,
  since: "2026-10-10T10:00:00Z",
  workspace: "acme",
  request: {
    id: "r1",
    project: "ordering",
    task: "ord-5",
    sender: "vir@acme.test",
    recipient: "you@acme.test",
    title: "Rerun the camp import",
    prompt: "The 2025 mapping is fixed on main.",
    status: "pending",
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T10:00:00Z",
  },
  computers: [],
};

const cardsOf = (
  tasks: ReadonlyArray<WorkTaskNode>,
  needs: ReadonlyArray<NeedsYouItem> = [],
): ReadonlyArray<TaskCard> =>
  taskCards([project(tasks)], { scope: ALL_PROJECTS, mine: false, query: "", needs });
const keys = (rows: ReadonlyArray<{ readonly task: WorkTaskNode }>) =>
  rows.map((row) => row.task.key);

describe("listRows", () => {
  const cards = cardsOf([
    task("ord-5", []),
    task("rec-2", [chat("a")]),
    task("ord-2", [chat("b", { person: "Ana", mine: false, status: "working" })]),
    task("ord-1", [chat("c")], { inReview: true }),
    task("ord-8", [chat("d")], { done: true }),
  ]);

  it("lists the active tasks in the board's order: what needs you, then the rest", () => {
    expect(keys(listRows(cards, "active"))).toEqual(["ORD-1", "ORD-2", "REC-2", "ORD-5"]);
  });

  it("lists the done tasks under Done, the latest first", () => {
    const done = cardsOf([
      task("ord-8", [chat("a", { activeAt: "2026-10-10T10:00:00Z" })], { done: true }),
      task("ord-9", [chat("b", { activeAt: "2026-10-11T10:00:00Z" })], { done: true }),
      task("ord-1", [chat("c")]),
    ]);
    expect(keys(listRows(done, "done"))).toEqual(["ORD-9", "ORD-8"]);
    expect(keys(listRows(cards, "done"))).toEqual(["ORD-8"]);
  });

  it("has tasks only: requests, overlaps and stale inputs are counted apart", () => {
    const withRequest = cardsOf([task("ord-5", [])], [request]);
    expect(withRequest).toHaveLength(2);
    expect(keys(listRows(withRequest, "active"))).toEqual(["ORD-5"]);
    expect(otherNeeds(withRequest)).toBe(1);
    expect(otherNeeds(cards)).toBe(0);
  });

  it("counts the tasks the tabs hold, not the requests beside them", () => {
    expect(listCounts(cards)).toEqual({ active: 4, done: 1 });
    expect(listCounts(cardsOf([task("ord-5", [])], [request]))).toEqual({ active: 1, done: 0 });
    expect(listCounts([])).toEqual({ active: 0, done: 0 });
  });
});

describe("listGroups", () => {
  it("groups open tasks under their status in the board's order and leaves empty ones out", () => {
    const groups = listGroups(cardsOf([task("b", []), task("a", [])]), "active");
    expect(groups.map((group) => group.id)).toEqual(["new"]);
    expect(groups[0]?.rows).toHaveLength(2);
    expect(listGroups(cardsOf([]), "done")).toEqual([]);
  });
});

describe("stateText", () => {
  const stateOf = (node: WorkTaskNode) => {
    const [card] = cardsOf([node]);
    if (card?.kind !== "task") throw new Error("no task card");
    return stateText(card);
  };

  it("reads the state's words", () => {
    expect(stateOf(task("ord-1", [chat("a")], { inReview: true }))).toBe("Ready for review");
    expect(stateOf(task("ord-5", []))).toBe("Not started");
  });

  it("says why a task is done when only its pull requests made it so", () => {
    const merged = task("ord-8", [chat("a", { delivery: "merged" })], { status: "done" });
    expect(stateOf(merged)).toBe("Done · PR merged");
    const closed = task("ord-9", [chat("b", { delivery: "closed" })], { status: "done" });
    expect(stateOf(closed)).toBe("Done · PR closed");
    expect(stateOf(task("ord-7", [chat("c", { delivery: "merged" })], { done: true }))).toBe(
      "Done",
    );
  });
});

describe("taskStateTone and COLUMN_STATE", () => {
  it("draws what waits on you in one tone, work in progress in another, done in a third", () => {
    expect(taskStateTone("review")).toBe("needs");
    expect(taskStateTone("approval")).toBe("needs");
    expect(taskStateTone("input")).toBe("needs");
    expect(taskStateTone("working")).toBe("working");
    expect(taskStateTone("waiting")).toBe("working");
    expect(taskStateTone("done")).toBe("delivery");
    expect(taskStateTone("paused")).toBe("neutral");
    expect(taskStateTone("new")).toBe("neutral");
  });

  it("gives each column the tone of the states it holds", () => {
    expect(taskStateTone(COLUMN_STATE.needs)).toBe("needs");
    expect(taskStateTone(COLUMN_STATE.working)).toBe("working");
    expect(taskStateTone(COLUMN_STATE.paused)).toBe("neutral");
    expect(taskStateTone(COLUMN_STATE.new)).toBe("neutral");
  });
});

describe("chatsLabel", () => {
  it("counts the chats in words", () => {
    expect(chatsLabel(0)).toBe("no chats");
    expect(chatsLabel(1)).toBe("1 chat");
    expect(chatsLabel(3)).toBe("3 chats");
  });
});

describe("listSelectableRows", () => {
  it("offers every open task by its row's key with its ancestors, and no done one", () => {
    const rows = listSelectableRows(
      cardsOf([
        task("g", [], { executable: false, childCount: 1 }),
        task("i", [], { parent: "g", depth: 1 }),
        task("old", [], { done: true }),
      ]),
    );
    expect(rows.map((row) => [row.key, row.ancestors, row.project])).toEqual(
      expect.arrayContaining([
        ["acme/ordering/g", [], "acme/ordering/"],
        ["acme/ordering/i", ["acme/ordering/g"], "acme/ordering/"],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("gives flat rows on a Hub without a tree", () => {
    const rows = listSelectableRows(cardsOf([task("a", []), task("b", [])]));
    expect(rows.every((row) => row.ancestors.length === 0)).toBe(true);
  });
});
