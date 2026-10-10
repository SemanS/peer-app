import { EnvironmentId, ThreadId, type PeerHubStatus } from "@t3tools/contracts";
import { LockIcon } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";

import type { ProjectSignal } from "../slots.types";
import type { WorkProjectNode, WorkThreadNode } from "../workTree.logic";
import {
  answerWithDecision,
  approvalSignals,
  denyWithNote,
  PROJECT_DECISION_LINE,
} from "./approval.logic";

const HERE = EnvironmentId.make("here");

function thread(key: string, threadId: string): WorkThreadNode {
  return {
    key,
    title: key,
    person: "You",
    mine: true,
    status: "blocked",
    delivery: "open",
    localEnvironment: true,
    harness: undefined,
    branch: undefined,
    source: "peer",
    stale: false,
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make(threadId) },
    placeable: true,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
  };
}

const booking: WorkProjectNode = {
  workspace: "acme",
  workspaceName: "Acme",
  projectId: "booking",
  name: "Booking",
  areas: [
    {
      name: null,
      tasks: [
        {
          id: "bkg-812",
          key: "BKG-812",
          title: "Split Payments",
          done: false,
          status: "blocked",
          threads: [thread("peer:opera", "opera")],
          removable: true,
          context: undefined,
        },
      ],
    },
  ],
  unsorted: [thread("peer:loose", "loose")],
  context: undefined,
  candidates: 0,
  tasks: [],
};

const status = {
  email: "you@acme.test",
  workspaces: [
    {
      slug: "acme",
      projects: [
        {
          project: { id: "booking", members: [{ email: "eva@acme.test", name: "Eva" }] },
          work: { tasks: [] },
        },
      ],
    },
  ],
  coordination: {
    enabled: true,
    sessions: [
      { id: "claude:you", workspace: "acme", project: "booking", email: "you@acme.test" },
      { id: "claude:eva", workspace: "acme", project: "booking", email: "eva@acme.test" },
    ],
    overlaps: [
      {
        id: "o1",
        workspace: "acme",
        project: "booking",
        sessions: ["claude:you", "claude:eva"],
        files: ["payments/webhooks.ts"],
        state: "open",
        notes: [],
        updatedAt: "2026-10-10T10:00:00Z",
      },
      {
        id: "o2",
        workspace: "acme",
        project: "booking",
        sessions: ["claude:eva", "claude:third"],
        files: ["ledger.ts"],
        state: "open",
        notes: [],
        updatedAt: "2026-10-10T10:00:00Z",
      },
    ],
  },
} as unknown as PeerHubStatus;

const held: ProjectSignal = {
  id: "resources",
  label: "Held resources",
  icon: LockIcon,
  count: 1,
  detail: "staging-db",
  tone: "coordination",
};

describe("the Peer band of a waiting thread", () => {
  it("names the thread's task, its project's overlaps with your agents and what is held", () => {
    const signals = approvalSignals({
      tree: [booking],
      status,
      threadKey: "here:opera",
      signals: () => [held],
    });
    expect(signals?.project.name).toBe("Booking");
    expect(signals?.task?.key).toBe("BKG-812");
    expect(signals?.overlaps).toEqual([{ id: "o1", topic: "payments/webhooks.ts", with: "Eva" }]);
    expect(signals?.held).toBe("staging-db");
  });

  it("knows a thread on no task, and nothing is held when the signal counts nothing", () => {
    const signals = approvalSignals({
      tree: [booking],
      status,
      threadKey: "here:loose",
      signals: () => [{ ...held, count: 0 }],
    });
    expect(signals?.task).toBeUndefined();
    expect(signals?.held).toBeUndefined();
  });

  it("is nothing outside a Peer workspace project", () => {
    expect(
      approvalSignals({ tree: [booking], status, threadKey: "here:other", signals: () => [] }),
    ).toBeNull();
  });
});

describe("an answer marked as a project decision", () => {
  it("asks the agent to record it, and leaves an unmarked answer as it is", () => {
    expect(answerWithDecision("3 times, then wait.  ", true)).toBe(
      `3 times, then wait.\n\n${PROJECT_DECISION_LINE}`,
    );
    expect(answerWithDecision("3 times", false)).toBe("3 times");
  });
});

describe("deny with a note", () => {
  const record = (declined: boolean) => {
    const calls: string[] = [];
    return {
      calls,
      steps: {
        decline: async () => {
          calls.push("decline");
          return declined;
        },
        send: async (note: string) => {
          calls.push(`send:${note}`);
        },
      },
    };
  };

  it("declines before it sends the note", async () => {
    const { calls, steps } = record(true);
    expect(await denyWithNote("  Write a reversible migration first.  ", steps)).toBe(true);
    expect(calls).toEqual(["decline", "send:Write a reversible migration first."]);
  });

  it("sends nothing when the decline fails or the note is empty", async () => {
    const failed = record(false);
    expect(await denyWithNote("No.", failed.steps)).toBe(false);
    expect(failed.calls).toEqual(["decline"]);
    const empty = record(true);
    expect(await denyWithNote("   ", empty.steps)).toBe(false);
    expect(empty.calls).toEqual([]);
  });
});
