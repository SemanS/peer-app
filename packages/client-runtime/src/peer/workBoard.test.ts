import { describe, expect, it } from "vite-plus/test";

import {
  ALL_PROJECTS,
  boardCards,
  boardColumn,
  projectCounts,
  resolveScope,
  type WorkProjectNode,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./work.ts";

function thread(overrides: Partial<WorkThreadNode> & Pick<WorkThreadNode, "key">): WorkThreadNode {
  return {
    title: overrides.key,
    person: "You",
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

function task(id: string, threads: ReadonlyArray<WorkThreadNode>): WorkTaskNode {
  return {
    id,
    key: id.toUpperCase(),
    title: `Task ${id}`,
    done: false,
    status: "idle",
    threads,
    removable: true,
    context: undefined,
  };
}

function project(
  projectId: string,
  tasks: ReadonlyArray<WorkTaskNode>,
  unsorted: ReadonlyArray<WorkThreadNode> = [],
): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId,
    name: projectId,
    areas: [{ name: null, tasks }],
    unsorted,
    context: undefined,
    candidates: 0,
    tasks: [],
  };
}

describe("boardColumn", () => {
  it("places threads by what they wait for", () => {
    expect(boardColumn(thread({ key: "a", status: "blocked" }))).toBe("needs");
    expect(boardColumn(thread({ key: "b", status: "working" }))).toBe("working");
    expect(boardColumn(thread({ key: "c", status: "done" }))).toBe("review");
    expect(boardColumn(thread({ key: "d", status: "idle", delivery: "review" }))).toBe("review");
    expect(boardColumn(thread({ key: "e", status: "idle" }))).toBe("idle");
  });

  it("drops merged and closed work and shows a colleague who went quiet as idle", () => {
    expect(boardColumn(thread({ key: "a", status: "working", delivery: "merged" }))).toBeNull();
    expect(boardColumn(thread({ key: "b", delivery: "closed" }))).toBeNull();
    expect(boardColumn(thread({ key: "c", mine: false, status: "unknown", stale: true }))).toBe(
      "idle",
    );
  });
});

describe("boardCards", () => {
  const tree = [
    project("booking", [
      task("bkg-1", [
        thread({ key: "mine", status: "blocked", branch: "bkg-1-opera" }),
        thread({ key: "eva", mine: false, person: "Eva", status: "working" }),
      ]),
    ]),
    project("hub", [], [thread({ key: "loose", status: "working" })]),
  ];

  it("keeps one project when a project is in scope", () => {
    const keys = boardCards(tree, { scope: "acme/hub", mine: false, query: "" }).map(
      (card) => card.thread.key,
    );
    expect(keys).toEqual(["loose"]);
  });

  it("shows only your threads when asked and finds by branch, person or task key", () => {
    expect(
      boardCards(tree, { scope: ALL_PROJECTS, mine: true, query: "" }).map((c) => c.thread.key),
    ).toEqual(["loose", "mine"]);
    expect(
      boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "OPERA" }).map(
        (c) => c.thread.key,
      ),
    ).toEqual(["mine"]);
    expect(
      boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "eva" }).map((c) => c.thread.key),
    ).toEqual(["eva"]);
    expect(boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "bkg-1" }).length).toBe(2);
  });

  it("keeps the task a card is on", () => {
    const [card] = boardCards(tree, { scope: "acme/booking", mine: true, query: "" });
    expect(card?.task?.key).toBe("BKG-1");
  });
});

describe("projectCounts and resolveScope", () => {
  const booking = project("booking", [
    task("bkg-1", [
      thread({ key: "a", status: "blocked" }),
      thread({ key: "b", mine: false, status: "working" }),
      thread({ key: "c", status: "done", delivery: "merged" }),
    ]),
  ]);

  it("counts threads per column, everyone's or yours", () => {
    expect(projectCounts(booking)).toEqual({ needs: 1, working: 1, review: 0, idle: 0 });
    expect(projectCounts(booking, true)).toEqual({ needs: 1, working: 0, review: 0, idle: 0 });
  });

  it("falls back to all projects when the chosen one is gone", () => {
    expect(resolveScope("acme/booking", [booking])).toBe("acme/booking");
    expect(resolveScope("acme/gone", [booking])).toBe(ALL_PROJECTS);
  });
});
