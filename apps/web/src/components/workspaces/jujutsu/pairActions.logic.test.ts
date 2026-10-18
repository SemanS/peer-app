import type { PeerForecastPair } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  followOutcome,
  localSessions,
  pairAction,
  pairProblem,
  type PairActionInput,
} from "./pairActions.logic";

const tasks = [
  { id: "t11", key: "ORD-11", title: "orderTotal returns cents" },
  { id: "t12", key: "ORD-12", title: "Loyalty points" },
  { id: "t14", key: "ORD-14", title: "Totals include VAT" },
];

const side = (email: string, task: string, branch: string) => ({
  branch,
  email,
  task,
  title: "",
  where: "origin" as const,
});

const base = {
  workspace: "acme",
  project: "ordering",
  repository: "repo",
  files: [],
  more: 0,
  checkedAt: "2026-10-18T14:52:00Z",
};

/** ORD-11 (Ana) and ORD-12 (Bob) merge clean and fail the check; ORD-12 was started later. */
const failing: PeerForecastPair = {
  ...base,
  a: side("ana@acme.test", "t11", "feature/ORD-11-cents"),
  b: side("bob@acme.test", "t12", "feature/ORD-12-loyalty"),
  check: { state: "fails", at: "2026-10-18T14:52:00Z", commits: ["a", "b"] },
  later: "b",
};

/** ORD-11 (Ana) and ORD-14 (Eva) conflict in order.js; ORD-14 was started later. */
const conflict: PeerForecastPair = {
  ...base,
  a: side("ana@acme.test", "t11", "feature/ORD-11-cents"),
  b: side("eva@acme.test", "t14", "feature/ORD-14-vat"),
  files: ["order.js"],
  later: "b",
};

const nameOf = (email: string) => {
  const first = email.split("@")[0] ?? email;
  return first.charAt(0).toUpperCase() + first.slice(1);
};

const on = (
  pair: PeerForecastPair,
  me: string,
  sessions: PairActionInput["sessions"],
): PairActionInput => ({ pair, tasks, sessions, me, nameOf });

describe("a pair that merges clean and fails the check", () => {
  it("offers Build on Bob's computer, where his agent works on ORD-12", () => {
    const action = pairAction(
      on(failing, "bob@acme.test", [{ taskId: "t12", session: "codex:1" }]),
    );
    expect(action).toMatchObject({
      kind: "build",
      label: "Build ORD-12 on ORD-11",
      session: "codex:1",
      onto: { id: "t11", label: "ORD-11" },
      later: { id: "t12", label: "ORD-12" },
    });
  });

  it("asks Bob on Slavo's computer, for ORD-12, with the instruction", () => {
    const action = pairAction(on(failing, "slavo@acme.test", []));
    expect(action).toMatchObject({
      kind: "ask",
      label: "Ask Bob to build ORD-12 on ORD-11…",
      recipient: "bob@acme.test",
      task: { id: "t12", label: "ORD-12" },
      note: "“Build ORD-12 on ORD-11” is offered on Bob's computer, where ORD-12 lives",
    });
    expect(action.kind === "ask" && action.instruction).toContain(
      "build ORD-12 on ORD-11, then run the check again",
    );
  });

  it("asks the later side whichever side it is", () => {
    const swapped: PeerForecastPair = {
      ...failing,
      a: failing.b,
      b: failing.a,
      later: "a",
    };
    expect(pairAction(on(swapped, "slavo@acme.test", []))).toMatchObject({
      label: "Ask Bob to build ORD-12 on ORD-11…",
    });
  });

  it("offers no build for a pass, a timeout or a check that could not be read", () => {
    for (const state of ["passed", "timedOut", "couldNotRead"] as const) {
      const pair = { ...failing, check: { state, at: "x", commits: [] } };
      expect(pairProblem(pair)).toBeNull();
      expect(pairAction(on(pair, "slavo@acme.test", []))).toEqual({ kind: "none" });
    }
  });
});

describe("a conflict", () => {
  it("offers Resolve together on Eva's computer, with both sides and the later one", () => {
    const action = pairAction(
      on(conflict, "eva@acme.test", [{ taskId: "t14", session: "claude:2" }]),
    );
    expect(action).toMatchObject({
      kind: "resolve",
      label: "Resolve together…",
      integrate: {
        a: { task: "t11", rev: "feature/ORD-11-cents" },
        b: { task: "t14", rev: "feature/ORD-14-vat" },
        later: "b",
      },
      later: { id: "t14", label: "ORD-14" },
    });
  });

  it("asks Eva on Slavo's computer and never offers Resolve together there", () => {
    const action = pairAction(on(conflict, "slavo@acme.test", [{ taskId: "t12", session: "x" }]));
    expect(action).toMatchObject({
      kind: "ask",
      label: "Ask Eva to resolve…",
      recipient: "eva@acme.test",
      task: { id: "t14", label: "ORD-14" },
    });
    expect(action.kind === "ask" && action.instruction).toContain("conflict in order.js");
  });

  it("asks Eva on Ana's computer too: Ana's agent works on the earlier side", () => {
    const action = pairAction(on(conflict, "ana@acme.test", [{ taskId: "t11", session: "x" }]));
    expect(action).toMatchObject({ kind: "ask", label: "Ask Eva to resolve…" });
  });
});

describe("where nothing is offered", () => {
  it("shows nothing without a later side (Git, an older Peer)", () => {
    const { later: _later, ...older } = conflict;
    expect(pairAction(on(older, "slavo@acme.test", []))).toEqual({ kind: "none" });
  });

  it("shows nothing for a side that meets another change's conflict", () => {
    const stacked: PeerForecastPair = {
      ...conflict,
      inheritedFrom: { side: "b", branch: "feature/ORD-11-cents", task: "t11" },
    };
    expect(pairAction(on(stacked, "slavo@acme.test", []))).toEqual({ kind: "none" });
  });

  it("shows nothing when the later side names no task, or the earlier one cannot be built on", () => {
    const noTask = { ...conflict, b: { ...conflict.b, task: undefined } };
    expect(pairAction(on(noTask, "slavo@acme.test", []))).toEqual({ kind: "none" });
    const noEarlier = { ...failing, a: { ...failing.a, task: undefined } };
    expect(
      pairAction(on(noEarlier, "bob@acme.test", [{ taskId: "t12", session: "codex:1" }])),
    ).toEqual({ kind: "none" });
  });

  it("does not ask the person who is looking when their agent runs on another computer", () => {
    expect(pairAction(on(failing, "bob@acme.test", []))).toEqual({ kind: "none" });
  });

  it("shows nothing for a pair that passes its check", () => {
    const passing = { ...failing, check: { state: "passed" as const, at: "x", commits: [] } };
    expect(pairAction(on(passing, "slavo@acme.test", []))).toEqual({ kind: "none" });
  });
});

describe("what a build says", () => {
  const action = { later: { id: "t12", label: "ORD-12" }, onto: { id: "t11", label: "ORD-11" } };

  it("says the pair is checked again and the agent hears", () => {
    expect(followOutcome({ conflicts: [] }, action)).toBe(
      "ORD-12's work now builds on ORD-11. The pair is checked again, and the agent hears what moved.",
    );
  });

  it("names the files of a conflict the move brought", () => {
    expect(followOutcome({ conflicts: ["a.js", "b.js", "c.js", "d.js"] }, action)).toContain(
      "holds a conflict in a.js, b.js, c.js and more",
    );
  });
});

describe("the sessions on this computer", () => {
  const project = {
    project: { id: "ordering" },
    work: {
      tasks: [
        { id: "t12", key: "ORD-12", title: "Loyalty points" },
        { id: "t14", key: "ORD-14", title: "VAT" },
      ],
      threads: [],
      assignments: { "herdr:codex:abc": "t12" },
    },
  } as unknown as Parameters<typeof localSessions>[0]["project"];
  const agent = (over: Record<string, unknown>) => ({
    id: "herdr:t1",
    paneId: "p",
    title: "work",
    status: "working",
    workspace: "acme",
    projectId: "ordering",
    vcs: "jj",
    ...over,
  });
  const run = (list: ReadonlyArray<Record<string, unknown>>) =>
    localSessions({
      status: {
        email: "bob@acme.test",
        environmentId: "env",
        agents: { list },
      } as unknown as Parameters<typeof localSessions>[0]["status"],
      workspace: "acme",
      project,
    });

  it("names an agent the way coordination does, on the task it was placed on", () => {
    expect(run([agent({ id: "herdr:codex:abc", agent: "codex", session: "abc" })])).toEqual([
      { taskId: "t12", session: "codex:abc" },
    ]);
  });

  it("finds the task by key in the branch, and names the agent by herdr's id before its session is known", () => {
    expect(run([agent({ branch: "feature/ORD-14-vat" })])).toEqual([
      { taskId: "t14", session: "herdr:t1" },
    ]);
  });

  it("leaves out Git checkouts, finished agents, other projects and agents on no task", () => {
    expect(
      run([
        agent({ vcs: "git", branch: "ORD-14" }),
        agent({ status: "done", branch: "ORD-14" }),
        agent({ projectId: "other", branch: "ORD-14" }),
        agent({ branch: "scratch" }),
      ]),
    ).toEqual([]);
  });
});
