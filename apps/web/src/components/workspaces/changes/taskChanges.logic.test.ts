import { taskStack } from "@t3tools/client-runtime/peer/changes";
import type { ReviewDiff } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkTaskNode, WorkThreadNode } from "../workTree.logic";
import { NOW, at, changeId, row } from "./fixtures.test-util.ts";
import {
  followSession,
  landingText,
  movedModel,
  stackLine,
  stopTarget,
} from "./taskChanges.logic.ts";

const ana = row("lrorvllt", {
  subject: "ORD-11: orderTotal returns integer cents",
  author: { email: "ana@acme.dev", agent: "claude-code" },
  bookmarks: ["feature/ORD-11-cents"],
  working: false,
  versionCount: 7,
  lastReportAt: at("14:57"),
});
const bob = row("mspqrmyv", {
  subject: "ORD-12: loyalty points",
  parents: [ana.changeId],
  author: { email: "bob@acme.dev", agent: "codex" },
  paths: ["loyalty.js"],
  lines: { added: 3, removed: 0 },
  versionCount: 6,
  lastReportAt: at("14:59"),
});
const landed = {
  changeId: changeId("zsmtoopz"),
  commitId: "f".repeat(40),
  subject: "ORD-9 Refund fee field",
  bookmark: "main@origin",
};
const stack = taskStack({ changes: [ana, bob], landed }, "ORD-12", {
  me: "bob@acme.dev",
  now: NOW,
});

describe("a task's stack", () => {
  it("reads the task's own change first and the teammate's under it, down to trunk", () => {
    expect(stack.entries.map((entry) => entry.change.changeId)).toEqual([
      bob.changeId,
      ana.changeId,
    ]);
    expect(stack.landed?.bookmark).toBe("main@origin");
  });

  it("says the person's own change is theirs and their agent works in it", () => {
    const ids = stack.entries.map((entry) => entry.change.changeId);
    const own = stackLine(stack.entries[0]!, ids);
    expect(own.detail).toBe("Yours · Codex works in it · 1 file +3 · 6 versions");
    expect(own.readOnly).toBe(false);
  });

  it("says a teammate's change is read-only to the agent, with its version and when it moved", () => {
    const ids = stack.entries.map((entry) => entry.change.changeId);
    const theirs = stackLine(stack.entries[1]!, ids);
    expect(theirs.detail).toBe("Ana's, read-only for your agent · version 7, moved 3 min ago");
    expect(theirs.readOnly).toBe(true);
  });

  it("offers to stop building on the teammate's change, and on none when the stack is the person's own", () => {
    expect(stopTarget(stack)?.change.changeId).toBe(ana.changeId);
    const alone = taskStack({ changes: [bob], landed }, "ORD-12", { me: "bob@acme.dev", now: NOW });
    expect(stopTarget(alone)).toBeUndefined();
  });
});

describe("how a stacked task lands", () => {
  const target = stopTarget(stack)!;

  it("names the branch the pull request is based on", () => {
    const text = landingText(target, "ORD-12");
    expect(text.title).toBe("A stacked pull request, on feature/ORD-11-cents");
    expect(text.body).toContain("--base feature/ORD-11-cents");
    expect(text.body).toContain("GitHub moves this one onto main");
  });

  it("does not invent a branch the change has none of", () => {
    const text = landingText({ ...target, change: { ...target.change, bookmarks: [] } }, "ORD-12");
    expect(text.body).not.toContain("--base feature");
    expect(text.body).toContain("once ORD-11 has one");
  });
});

describe("what moved under the task", () => {
  const target = stopTarget(stack)!;
  const diff: ReviewDiff = {
    state: "ok",
    mode: "since",
    fromVersion: 6,
    toVersion: 7,
    leftOut: 2,
    files: [
      {
        path: "order.js",
        added: 1,
        removed: 0,
        lines: [{ kind: "add", n: 5, text: "export const toEuros = (c) => c / 100;" }],
      },
    ],
  };

  it("heads with who amended what, between which versions", () => {
    expect(movedModel(diff, target).heading).toBe("Ana amended ORD-11: version 6 → 7");
  });

  it("says that main's own commits are left out", () => {
    expect(movedModel(diff, target).notes).toEqual([
      "Main gained 2 commits meanwhile; they are left out.",
    ]);
  });

  it("says a newest version that is not here instead of showing nothing moved", () => {
    const missing = movedModel({ state: "notHere", mode: "since", files: [] }, target);
    expect(missing.heading).toContain("not pushed or shared yet");
    expect(missing.files).toEqual([]);
  });

  it("says how far a partial comparison reaches", () => {
    expect(movedModel({ ...diff, state: "partial", leftOut: 0 }, target).notes).toEqual([
      "Compared up to version 7, the newest this computer has.",
    ]);
  });
});

describe("the session that stops building on a change", () => {
  const thread = (overrides: Partial<WorkThreadNode>): WorkThreadNode => ({
    key: "k",
    title: "chat",
    person: "Bob",
    mine: true,
    status: "working",
    harness: "codex",
    branch: undefined,
    source: "peer",
    stale: false,
    open: undefined,
    placeable: false,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
    ...overrides,
  });
  const env = "environment-1" as never;

  it("is the person's own live agent, by the work tree's id for its thread", () => {
    const task: Pick<WorkTaskNode, "threads"> = {
      threads: [
        thread({ mine: false, open: { kind: "herdr", agentId: "theirs", paneId: "p" } }),
        thread({ open: { kind: "herdr", agentId: "mine", paneId: "p" } }),
      ],
    };
    expect(followSession(task)).toBe("mine");
    expect(
      followSession({
        threads: [
          thread({ open: { kind: "thread", environmentId: env, threadId: "t-1" as never } }),
        ],
      }),
    ).toBe("peer:t-1");
  });

  it("is none while the person has no live agent on the task", () => {
    expect(
      followSession({
        threads: [thread({ stale: true, open: { kind: "herdr", agentId: "a", paneId: "p" } })],
      }),
    ).toBeUndefined();
    expect(followSession({ threads: [] })).toBeUndefined();
  });
});
