import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkThreadNode } from "../workTree.logic";
import { reopenTarget, reviewState } from "./review.logic";

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

  it("says where the task stands", () => {
    expect(reviewState("review")).toEqual({ label: "Needs review", tone: "delivery" });
    expect(reviewState("done").label).toBe("Done");
    expect(reviewState("open").label).toBe("Open");
  });
});
