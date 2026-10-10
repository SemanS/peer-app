import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { NeedsYouItem } from "./needsYou.ts";
import {
  ALL_PROJECTS,
  boardCards,
  boardColumn,
  needProject,
  projectCounts,
  resolveScope,
  type BoardCard,
  type WorkProjectNode,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./work.ts";

/** What a card is about: the thread's key, or the Needs you item's. */
const keyOf = (card: BoardCard) => (card.kind === "thread" ? card.thread.key : card.item.key);

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
    const keys = boardCards(tree, { scope: "acme/hub", mine: false, query: "" }).map(keyOf);
    expect(keys).toEqual(["loose"]);
  });

  it("shows only your threads when asked and finds by branch, person or task key", () => {
    expect(boardCards(tree, { scope: ALL_PROJECTS, mine: true, query: "" }).map(keyOf)).toEqual([
      "loose",
      "mine",
    ]);
    expect(
      boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "OPERA" }).map(keyOf),
    ).toEqual(["mine"]);
    expect(boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "eva" }).map(keyOf)).toEqual(
      ["eva"],
    );
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

describe("Needs you column", () => {
  const HERE = EnvironmentId.make("env-here");
  const base = {
    environmentId: HERE,
    environmentLabel: "This Mac",
    offline: false,
    hubError: false,
  };
  const request: NeedsYouItem = {
    ...base,
    kind: "request",
    key: "request:acme:r1",
    title: "Rerun the camp import",
    rank: 2,
    since: "2026-10-10T10:00:00Z",
    workspace: "acme",
    request: {
      id: "r1",
      project: "booking",
      task: "bkg-1",
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
  const overlap: NeedsYouItem = {
    ...base,
    kind: "overlap",
    key: "overlap:acme:hub:o1",
    title: "server/routes.rs",
    rank: 3,
    since: "2026-10-10T10:05:00Z",
    overlap: {
      id: "o1",
      workspace: "acme",
      project: "hub",
      sessions: ["claude:a", "claude:b"],
      files: ["server/routes.rs"],
      state: "open",
      notes: [],
      updatedAt: "2026-10-10T10:05:00Z",
    },
    phase: "decide",
    participants: ["You", "Ana"],
    computers: [],
  };
  const stale: NeedsYouItem = {
    ...base,
    kind: "stale",
    key: "stale:env-here:claude:a",
    title: "BKG-1: Task bkg-1",
    rank: 4,
    since: "2026-10-10T09:00:00Z",
    stale: { session: "claude:a", since: "2026-10-10T09:00:00Z", scopes: [] },
    session: {
      id: "claude:a",
      workspace: "acme",
      project: "booking",
      email: "you@acme.test",
      label: "OPERA integration",
      task: "bkg-1",
      status: "idle",
      files: [],
      claims: [],
      local: true,
    },
    open: {
      kind: "context",
      environmentId: HERE,
      workspace: "acme",
      project: "booking",
      scope: "task:bkg-1",
    },
  };
  const waiting = thread({
    key: "peer:t1",
    status: "blocked",
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make("t1") },
  });
  const approval: NeedsYouItem = {
    ...base,
    kind: "thread",
    key: "thread:env-here:t1",
    title: "OPERA integration",
    rank: 0,
    since: "2026-10-10T10:10:00Z",
    need: "approval",
    thread: {} as Extract<NeedsYouItem, { kind: "thread" }>["thread"],
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make("t1") },
  };
  const tree = [
    project("booking", [
      task("bkg-1", [
        waiting,
        thread({ key: "eva", mine: false, person: "Eva", status: "blocked" }),
      ]),
    ]),
    project("hub", [task("hub-1", [thread({ key: "ana", mine: false, status: "working" })])]),
  ];
  const needs = [approval, request, overlap, stale];
  const all = boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "", needs });
  const column = (key: string) => all.find((card) => keyOf(card) === key)?.column;

  it("puts your waiting thread under Needs you and a colleague's under Working, waiting on them", () => {
    expect(column("peer:t1")).toBe("needs");
    const eva = all.find((card) => keyOf(card) === "eva");
    expect(eva?.column).toBe("working");
    expect(eva?.kind === "thread" ? eva.waitingOn : null).toBe("Eva");
  });

  it("says what your thread waits for and adds no second card for it", () => {
    const mine = all.filter((card) => keyOf(card) === "peer:t1" || keyOf(card) === approval.key);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.kind === "thread" ? mine[0].need : null).toBe("approval");
  });

  it("adds a card for a request, an overlap and stale inputs, each on its project", () => {
    expect(all.filter((card) => card.column === "needs").map(keyOf)).toEqual([
      "peer:t1",
      request.key,
      overlap.key,
      stale.key,
    ]);
    const requestCard = all.find((card) => card.kind === "request");
    expect(requestCard?.project.projectId).toBe("booking");
    expect(requestCard?.task?.key).toBe("BKG-1");
    expect(all.find((card) => card.kind === "overlap")?.project.projectId).toBe("hub");
    expect(all.find((card) => card.kind === "stale")?.task?.id).toBe("bkg-1");
  });

  it("keeps only the scoped project's cards", () => {
    const hub = boardCards(tree, { scope: "acme/hub", mine: false, query: "", needs });
    expect(hub.map(keyOf)).toEqual([overlap.key, "ana"]);
    const booking = boardCards(tree, { scope: "acme/booking", mine: false, query: "", needs });
    expect(booking.map(keyOf)).not.toContain(overlap.key);
    expect(booking.map(keyOf)).toContain(request.key);
  });

  it("keeps request, overlap and stale cards under Mine and leaves colleagues out", () => {
    const mine = boardCards(tree, { scope: ALL_PROJECTS, mine: true, query: "", needs });
    expect(mine.map(keyOf)).toEqual(["peer:t1", request.key, overlap.key, stale.key]);
  });

  it("finds a request by its sender and counts what needs you per project", () => {
    expect(
      boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "vir@", needs }).map(keyOf),
    ).toEqual([request.key]);
    expect(projectCounts(tree[0]!, false, needs)).toEqual({
      needs: 3,
      working: 1,
      review: 0,
      idle: 0,
    });
  });

  it("places stale inputs on the project of the session that read them", () => {
    expect(needProject(stale, new Map())).toBe("acme/booking");
  });
});
