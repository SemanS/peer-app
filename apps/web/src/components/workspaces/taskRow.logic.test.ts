import type { TaskState } from "@t3tools/client-runtime/peer/work";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rowStateLabel, taskRouteKey, taskRowModel, taskStateLook } from "./taskRow.logic";
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
  taskRowModel({ task: node, needOf });

describe("taskRowModel: the words", () => {
  it("says one of the eight states", () => {
    const waiting = thread("a", { status: "blocked" });
    const ana = thread("ana", { mine: false, person: "Ana", status: "blocked", open: undefined });
    const cases: ReadonlyArray<readonly [string, WorkTaskNode, ReadonlyMap<string, AgentNeed>?]> = [
      ["Done", task([thread("a")], { done: true })],
      ["Ready for review", task([thread("a")], { inReview: true })],
      ["Needs your approval", task([waiting]), needs([[waiting, "approval"]])],
      ["Needs your answer", task([waiting])],
      ["In progress", task([thread("a", { status: "working" })])],
      ["Blocked on Ana", task([ana])],
      ["Paused", task([thread("a")])],
      ["Not started", task([])],
    ];
    expect(cases.map(([, node, needOf]) => model(node, needOf).state.label)).toEqual(
      cases.map(([label]) => label),
    );
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

  it("names the route a task's room is highlighted by", () => {
    expect(taskRouteKey(scope, "ord-7")).toBe("task:webinson:ordering:ord-7");
  });
});

describe("rowStateLabel", () => {
  const state = (kind: TaskState["kind"], label: string = kind) => ({
    kind,
    label,
    waitingOn: undefined,
  });

  it("says a state that says something", () => {
    expect(rowStateLabel(state("review", "Ready for review"))).toBe("Ready for review");
  });

  it("leaves words out where the dot says it", () => {
    expect(rowStateLabel(state("new"))).toBeUndefined();
    expect(rowStateLabel(state("done"))).toBeUndefined();
  });
});
