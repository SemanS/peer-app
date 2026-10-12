import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkTaskNode, WorkThreadNode } from "../workTree.logic";
import { handoffChat, reopenTarget, reviewState } from "./review.logic";

const HERE = EnvironmentId.make("here");

function thread(overrides: Partial<WorkThreadNode> & Pick<WorkThreadNode, "key">): WorkThreadNode {
  return {
    title: overrides.key,
    person: "You",
    mine: true,
    status: "done",
    delivery: "review",
    localEnvironment: true,
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

const task = (overrides: Partial<WorkTaskNode> = {}): WorkTaskNode => ({
  id: "ord-7",
  key: "ORD-7",
  title: "Order notes header",
  done: false,
  status: "idle",
  threads: [],
  removable: false,
  context: undefined,
  ...overrides,
});

const local = (key: string, activeAt: string) =>
  thread({
    key,
    activeAt,
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make(key) },
  });
const herdr = thread({
  key: "herdr:claude:a",
  source: "herdr",
  open: { kind: "herdr", agentId: "herdr:a", paneId: "w1:p1" },
});

describe("who hears a reopening note", () => {
  it("is your Peer thread here that was active last", () => {
    expect(
      reopenTarget({
        threads: [
          herdr,
          local("old", "2026-10-10T08:00:00Z"),
          local("new", "2026-10-10T09:00:00Z"),
        ],
      }),
    ).toMatchObject({ kind: "thread", threadId: "new" });
  });

  it("is your herdr agent when you have no Peer thread on the task", () => {
    expect(reopenTarget({ threads: [herdr] })).toEqual({
      kind: "herdr",
      agentId: "herdr:a",
      title: "herdr:claude:a",
    });
  });

  it("is nobody when only colleagues, other computers or gone runtimes are on it", () => {
    expect(
      reopenTarget({
        threads: [
          thread({
            key: "eva",
            mine: false,
            open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make("eva") },
          }),
          thread({ key: "laptop", localEnvironment: false }),
          { ...local("gone", "2026-10-10T09:00:00Z"), stale: true },
        ],
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("the review page's state pill", () => {
  it("reads Waiting for review while the task's agent still works", () => {
    const working = thread({ key: "working", status: "working" });
    expect(reviewState(task({ inReview: true, status: "working", threads: [working] }))).toEqual({
      label: "Waiting for review",
      tone: "delivery",
    });
  });

  it("says Done for a done task, whatever its chats do", () => {
    expect(reviewState(task({ done: true, inReview: true }))).toEqual({
      label: "Done",
      tone: "neutral",
    });
  });

  it("tells an approval from an answer with what Needs you says", () => {
    const waiting = local("waiting", "2026-10-10T09:00:00Z");
    const blocked = task({ threads: [{ ...waiting, status: "blocked" }] });
    expect(reviewState(blocked, new Map([["here:waiting", "approval"]]))).toEqual({
      label: "Needs your approval",
      tone: "needs",
    });
    expect(reviewState(blocked).label).toBe("Needs your answer");
  });

  it("says what a task not in review is doing in the same words", () => {
    expect(reviewState(task())).toEqual({ label: "Not started", tone: "neutral" });
    expect(reviewState(task({ threads: [thread({ key: "idle", status: "idle" })] })).label).toBe(
      "Paused",
    );
    expect(reviewState(task({ threads: [thread({ key: "busy", status: "working" })] }))).toEqual({
      label: "In progress",
      tone: "working",
    });
  });
});

describe("the chat a handoff came from", () => {
  it("is your Peer thread here that was active last, to open from the review", () => {
    expect(
      handoffChat({
        threads: [
          herdr,
          local("old", "2026-10-10T08:00:00Z"),
          local("new", "2026-10-10T09:00:00Z"),
        ],
      }),
    ).toEqual({
      title: "new",
      open: { kind: "thread", environmentId: HERE, threadId: "new" },
    });
  });

  it("is your herdr agent when you have no Peer thread on the task", () => {
    expect(handoffChat({ threads: [herdr] })).toEqual({
      title: "herdr:claude:a",
      open: herdr.open,
    });
  });

  it("is none when only colleagues, other computers or gone runtimes are on it", () => {
    expect(
      handoffChat({
        threads: [
          thread({
            key: "eva",
            mine: false,
            open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make("eva") },
          }),
          thread({ key: "laptop", localEnvironment: false }),
          { ...local("gone", "2026-10-10T09:00:00Z"), stale: true },
        ],
      }),
    ).toBeNull();
  });
});
