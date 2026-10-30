import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { AgentNeed } from "./needsYou.ts";
import {
  openKey,
  taskState,
  TASK_STATES_NEEDING_YOU,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./work.ts";

const HERE = EnvironmentId.make("env-here");

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
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make(overrides.key) },
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
    id: "t1",
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

/** What Needs you says a thread of yours waits for, keyed the way `taskState` reads it. */
function needs(
  entries: ReadonlyArray<[WorkThreadNode, AgentNeed]>,
): ReadonlyMap<string, AgentNeed> {
  return new Map(
    entries.flatMap(([node, need]) =>
      node.open === undefined ? [] : [[openKey(node.open), need]],
    ),
  );
}

describe("taskState", () => {
  it("reads the Hub's done and review before anything its chats do", () => {
    const working = thread({ key: "a", status: "working" });
    expect(taskState(task([working], { done: true })).kind).toBe("done");
    expect(taskState(task([working], { status: "done" })).kind).toBe("done");
    const review = taskState(task([working], { inReview: true }));
    expect(review).toEqual({ kind: "review", label: "Ready for review", waitingOn: undefined });
  });

  it("tells an approval from an answer for your own waiting chat", () => {
    const waiting = thread({ key: "a", status: "blocked" });
    expect(taskState(task([waiting]), needs([[waiting, "approval"]])).label).toBe(
      "Needs your approval",
    );
    expect(taskState(task([waiting]), needs([[waiting, "input"]])).label).toBe("Needs your answer");
    expect(taskState(task([waiting])).kind).toBe("input");
  });

  it("puts your waiting chat before a chat at work", () => {
    const state = taskState(
      task([thread({ key: "a", status: "working" }), thread({ key: "b", status: "blocked" })]),
    );
    expect(state.kind).toBe("input");
  });

  it("says whom a colleague's waiting chat waits on, after any chat at work", () => {
    const ana = thread({ key: "a", mine: false, person: "Ana", status: "blocked" });
    expect(taskState(task([ana]))).toEqual({
      kind: "waiting",
      label: "Blocked on Ana",
      waitingOn: "Ana",
    });
    expect(taskState(task([ana, thread({ key: "b", status: "working" })])).kind).toBe("working");
  });

  it("ignores a colleague's chat nobody reports any more", () => {
    const quiet = thread({ key: "a", mine: false, person: "Eva", status: "working", stale: true });
    expect(taskState(task([quiet])).kind).toBe("paused");
  });

  it("is paused with chats and none at work, not started without chats", () => {
    expect(taskState(task([thread({ key: "a", status: "idle" })])).label).toBe("Paused");
    expect(taskState(task([thread({ key: "a", status: "done" })])).label).toBe("Paused");
    expect(taskState(task([])).label).toBe("Not started");
  });

  it("names the states that wait on the person", () => {
    expect([...TASK_STATES_NEEDING_YOU].toSorted()).toEqual(["approval", "input", "review"]);
  });
});
