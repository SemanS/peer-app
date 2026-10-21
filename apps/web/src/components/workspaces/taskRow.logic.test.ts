import { TASK_STATES_NEEDING_YOU } from "@t3tools/client-runtime/peer/work";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  taskRouteKey,
  taskRowModel,
  taskRowTarget,
  taskStateLook,
  type TaskRowTarget,
} from "./taskRow.logic";
import {
  openKey,
  type AgentNeed,
  type WorkOpen,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./workTree.logic";

const ENV = EnvironmentId.make("env-here");
const scope = { workspace: "webinson", projectId: "ordering" };

function openThread(id: string): WorkOpen {
  return { kind: "thread", environmentId: ENV, threadId: ThreadId.make(id) };
}

function thread(key: string, overrides: Partial<WorkThreadNode> = {}): WorkThreadNode {
  return {
    key,
    title: key,
    person: "You",
    mine: true,
    status: "idle",
    delivery: "open",
    harness: undefined,
    branch: undefined,
    source: "peer",
    stale: false,
    open: openThread(key),
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
  threads: ReadonlyArray<WorkThreadNode>,
  overrides: Partial<WorkTaskNode> = {},
): WorkTaskNode {
  return {
    id: "ord-7",
    key: "ORD-7",
    title: "Order notes header",
    done: false,
    status: "idle",
    threads,
    removable: true,
    context: undefined,
    ...overrides,
  };
}

function needs(entries: ReadonlyArray<[WorkThreadNode, AgentNeed]>) {
  return new Map(
    entries.flatMap(([node, need]) =>
      node.open === undefined ? [] : [[openKey(node.open), need]],
    ),
  );
}

const model = (node: WorkTaskNode, needOf?: ReadonlyMap<string, AgentNeed>) =>
  taskRowModel({ task: node, scope, needOf });

describe("taskRowModel: the words", () => {
  it("says one of the eight states, with how many chats the task has", () => {
    const waiting = thread("a", { status: "blocked" });
    const ana = thread("ana", { mine: false, person: "Ana", status: "blocked", open: undefined });
    const cases: ReadonlyArray<readonly [string, WorkTaskNode, ReadonlyMap<string, AgentNeed>?]> = [
      ["Done", task([thread("a")], { done: true })],
      ["Waiting for review", task([thread("a")], { inReview: true })],
      ["Needs your approval", task([waiting]), needs([[waiting, "approval"]])],
      ["Needs your answer", task([waiting])],
      ["In progress", task([thread("a", { status: "working" })])],
      ["Waiting on Ana", task([ana])],
      ["Paused", task([thread("a")])],
      ["Not started", task([])],
    ];
    expect(cases.map(([, node, needOf]) => model(node, needOf).state.label)).toEqual(
      cases.map(([label]) => label),
    );
  });

  it("counts everyone's chats: also a colleague's, and says none yet", () => {
    const ana = thread("ana", { mine: false, person: "Ana", open: undefined });
    expect(model(task([thread("a"), ana])).chats).toBe("2 chats");
    expect(model(task([thread("a")])).chats).toBe("1 chat");
    expect(model(task([ana])).chats).toBe("1 chat");
    expect(model(task([])).chats).toBe("no chats yet");
    expect(
      model(task([thread("a"), thread("b"), thread("c", { mine: false, stale: true })])).chats,
    ).toBe("3 chats");
  });

  it("reads review before anything its chats do", () => {
    const handedOff = task([thread("a", { status: "working" })], { inReview: true });
    expect(model(handedOff).state).toMatchObject({ kind: "review", label: "Waiting for review" });
  });

  it("passes the overlap the task is in on, as its suffix", () => {
    const overlap = { id: "o1", label: "overlaps ORD-6" };
    expect(
      taskRowModel({ task: task([thread("a", { status: "working" })]), scope, overlap }).overlap,
    ).toEqual(overlap);
    expect(model(task([])).overlap).toBeUndefined();
  });
});

describe("taskRowModel: a review asks its owner", () => {
  const inReview = task([thread("a", { status: "working" })], { inReview: true });
  const review = (forMe: boolean) =>
    taskRowModel({
      task: inReview,
      scope,
      review: { audience: "owner", forMe, names: forMe ? ["You"] : ["Ana"] },
    });

  it("is the person's to do when it asks them: Waiting for your review, with the Review chip", () => {
    expect(review(true).state).toMatchObject({ kind: "review", label: "Waiting for your review" });
    expect(review(true).chip).toMatchObject({ label: "Review", target: { kind: "review" } });
    expect(review(true).target).toEqual(review(true).chip?.target);
    expect(taskRowTarget(inReview, scope).kind).toBe("task");
  });

  it("is Ana's when it asks her: the task waits on her, and the person gets no chip", () => {
    expect(review(false).state).toMatchObject({
      kind: "waiting",
      label: "Waiting for Ana's review",
    });
    expect(review(false).chip).toBeUndefined();
    expect(review(false).target).toEqual(taskRowTarget(inReview, scope));
    expect(TASK_STATES_NEEDING_YOU.has(review(false).state.kind)).toBe(false);
  });

  it("asks everyone when no route is passed, as before ownership", () => {
    expect(model(inReview).state.label).toBe("Waiting for review");
  });
});

describe("taskRowModel: the chip", () => {
  const review: TaskRowTarget = {
    kind: "review",
    workspace: "webinson",
    project: "ordering",
    task: "ord-7",
  };

  it("offers Review for a task waiting for review, to open its review", () => {
    expect(model(task([thread("a")], { inReview: true })).chip).toEqual({
      label: "Review",
      target: review,
    });
  });

  it("offers Answer or Approve to open the chat that waits", () => {
    const asks = thread("ask", { status: "blocked" });
    const approves = thread("approve", { status: "blocked" });
    expect(model(task([thread("idle"), asks])).chip).toEqual({
      label: "Answer",
      target: { kind: "chat", open: asks.open },
    });
    expect(model(task([asks, approves]), needs([[approves, "approval"]])).chip).toEqual({
      label: "Approve",
      target: { kind: "chat", open: approves.open },
    });
  });

  it("offers the chip only in the states that wait on the person", () => {
    const states = [
      task([thread("a")], { done: true }),
      task([thread("a", { status: "working" })]),
      task([thread("a", { mine: false, person: "Ana", status: "blocked" })]),
      task([thread("a")]),
      task([]),
    ];
    for (const node of states) {
      expect(TASK_STATES_NEEDING_YOU.has(model(node).state.kind)).toBe(false);
      expect(model(node).chip).toBeUndefined();
    }
    const waiting = [
      task([thread("a")], { inReview: true }),
      task([thread("a", { status: "blocked" })]),
    ];
    for (const node of waiting) {
      expect(TASK_STATES_NEEDING_YOU.has(model(node).state.kind)).toBe(true);
      expect(model(node).chip).toBeDefined();
    }
  });

  it("offers none when the waiting chat is not one this computer can open", () => {
    const elsewhere = thread("other", { status: "blocked", open: undefined, placeable: false });
    const node = task([elsewhere]);
    expect(model(node).state.label).toBe("Needs your answer");
    expect(model(node).chip).toBeUndefined();
  });

  it("does not send an answer to a chat the person can only watch", () => {
    const watched = thread("watched", {
      status: "blocked",
      placeable: false,
      open: { kind: "observe", workspace: "webinson", environment: "laptop", thread: "t" },
    });
    expect(model(task([watched])).chip).toBeUndefined();
    const herdr = thread("herdr", {
      status: "blocked",
      open: { kind: "herdr", agentId: "claude:1", paneId: "p1" },
    });
    expect(model(task([watched, herdr])).chip).toEqual({
      label: "Answer",
      target: { kind: "chat", open: herdr.open },
    });
  });

  it("does not send an answer to a chat nobody reports any more", () => {
    const gone = thread("gone", { status: "blocked", stale: true });
    expect(model(task([gone])).chip).toBeUndefined();
  });
});

describe("taskRowTarget", () => {
  it("leads to the task's page, in review or not, with or without a chat", () => {
    const page = { kind: "task", workspace: "webinson", project: "ordering", task: "ord-7" };
    expect(taskRowTarget(task([thread("a")], { inReview: true }), scope)).toEqual(page);
    expect(taskRowTarget(task([thread("a")]), scope)).toEqual(page);
    expect(taskRowTarget(task([]), scope)).toEqual(page);
  });
});

describe("what the row looks like", () => {
  it("colours what waits on you amber and work blue, hollow while it waits on a colleague", () => {
    expect(taskStateLook("review")).toEqual({ tone: "needs", hollow: false });
    expect(taskStateLook("approval").tone).toBe("needs");
    expect(taskStateLook("input").tone).toBe("needs");
    expect(taskStateLook("working")).toEqual({ tone: "working", hollow: false });
    expect(taskStateLook("waiting")).toEqual({ tone: "working", hollow: true });
    expect(taskStateLook("done")).toEqual({ tone: "delivery", hollow: false });
    expect(taskStateLook("paused")).toEqual({ tone: "neutral", hollow: false });
    expect(taskStateLook("new")).toEqual({ tone: "neutral", hollow: true });
  });

  it("names the route a task's page is highlighted by", () => {
    expect(taskRouteKey(scope, "ord-7")).toBe("task:webinson:ordering:ord-7");
  });
});
