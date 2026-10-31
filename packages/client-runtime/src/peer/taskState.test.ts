import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { AgentNeed } from "./needsYou.ts";
import {
  openKey,
  taskColumn,
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

  it("reads a task in review with an acceptance as accepted, which waits on nobody", () => {
    const idle = thread({ key: "a", status: "idle" });
    const byPolicy = taskState(task([idle], { inReview: true, accepted: "policy" }));
    expect(byPolicy).toEqual({ kind: "accepted", label: "Accepted", waitingOn: undefined });
    expect(TASK_STATES_NEEDING_YOU.has(byPolicy.kind)).toBe(false);
    expect(taskColumn(byPolicy)).toBe("working");
    // Whom the review would have asked no longer matters.
    const route = { audience: "owner", names: ["Ana"], forMe: false } as const;
    expect(
      taskState(task([idle], { inReview: true, accepted: "person" }), new Map(), route).kind,
    ).toBe("accepted");
    // What the person's own chat waits for still comes first; a done task is done.
    const waiting = thread({ key: "b", status: "blocked" });
    expect(taskState(task([waiting], { inReview: true, accepted: "policy" })).kind).toBe("input");
    expect(taskState(task([idle], { done: true, accepted: "policy" })).kind).toBe("done");
    // An acceptance outside review (the field unset) changes nothing.
    expect(taskState(task([idle], { inReview: true })).kind).toBe("review");
  });

  describe("a handoff's open steps", () => {
    const at = "2026-10-31T09:00:00Z";
    const next = (over: object) => ({
      agentActions: 0,
      coordination: 0,
      humanDecisions: 0,
      at,
      ...over,
    });
    const idle = thread({ key: "a", status: "idle" });
    const working = thread({ key: "a", status: "working" });

    it("is with the agent while its run is live, and asks nobody yet", () => {
      const state = taskState(
        task([idle], {
          inReview: true,
          handoffNext: next({ agentActions: 2 }),
          runs: { running: 1, detached: 0, ended: 0 },
        }),
      );
      expect(state).toEqual({
        kind: "agent_action",
        label: "With the agent",
        waitingOn: undefined,
        since: at,
      });
      expect(TASK_STATES_NEEDING_YOU.has(state.kind)).toBe(false);
      expect(taskColumn(state)).toBe("working");
    });

    it("comes back to its person, naming the steps, when the run ends", () => {
      const state = taskState(
        task([idle], {
          inReview: true,
          handoffNext: next({ agentActions: 2 }),
          runs: { running: 0, detached: 1, ended: 0 },
        }),
      );
      expect(state.kind).toBe("review");
      expect(state.label).toBe("The agent stopped · 2 steps open");
      expect(taskColumn(state)).toBe("needs");
    });

    it("counts a chat at work as live where the Hub has no runs", () => {
      const state = taskState(
        task([working], { inReview: true, handoffNext: next({ agentActions: 1 }) }),
      );
      expect(state.kind).toBe("agent_action");
    });

    it("reads coordination under work in progress, and returns it to the person after the run", () => {
      const live = taskState(
        task([working], {
          inReview: true,
          handoffNext: next({ coordination: 1, agentActions: 1 }),
        }),
      );
      expect(live.kind).toBe("coordination");
      expect(live.label).toBe("Coordination needed");
      expect(taskColumn(live)).toBe("working");
      const ended = taskState(
        task([idle], { inReview: true, handoffNext: next({ coordination: 1 }) }),
      );
      expect(ended).toEqual({
        kind: "review",
        label: "Coordination needed",
        waitingOn: undefined,
      });
    });

    it("maps a human decision to input at once, whatever the run does", () => {
      const state = taskState(
        task([working], {
          inReview: true,
          handoffNext: next({ humanDecisions: 1, coordination: 1, agentActions: 1 }),
        }),
      );
      expect(state).toEqual({
        kind: "input",
        label: "Human decision needed",
        waitingOn: undefined,
      });
    });

    it("is a plain review with no step open, and an acceptance beats any step", () => {
      expect(taskState(task([working], { inReview: true, handoffNext: next({}) })).kind).toBe(
        "review",
      );
      expect(
        taskState(
          task([working], {
            inReview: true,
            accepted: "person",
            handoffNext: next({ agentActions: 1 }),
          }),
        ).kind,
      ).toBe("accepted");
    });

    it("puts your own waiting chat first and says the agent's move to anyone", () => {
      const waiting = thread({ key: "b", status: "blocked" });
      expect(
        taskState(
          task([waiting], {
            inReview: true,
            handoffNext: next({ agentActions: 1 }),
            runs: { running: 1, detached: 0, ended: 0 },
          }),
        ).kind,
      ).toBe("input");
      const route = { audience: "owner", names: ["Ana"], forMe: false } as const;
      const live = task([working], { inReview: true, handoffNext: next({ agentActions: 1 }) });
      expect(taskState(live, new Map(), route).kind).toBe("agent_action");
      const ended = task([idle], { inReview: true, handoffNext: next({ agentActions: 1 }) });
      expect(taskState(ended, new Map(), route).label).toBe("Ready for Ana's review");
    });
  });

  it("names the states that wait on the person", () => {
    expect([...TASK_STATES_NEEDING_YOU].toSorted()).toEqual(["approval", "input", "review"]);
  });
});
