import {
  EnvironmentId,
  ThreadId,
  type PeerHubStatus,
  type PeerProjectState,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkTaskNode, WorkThreadNode } from "../workTree.logic";
import { detailRows } from "./taskDetails.logic";

const HERE = EnvironmentId.make("env-here");
const NOW = new Date(2026, 9, 18, 10, 0).getTime();

function thread(overrides: Partial<WorkThreadNode> & Pick<WorkThreadNode, "key">): WorkThreadNode {
  return {
    title: overrides.key,
    person: "Slavo",
    mine: true,
    status: "idle",
    delivery: "open",
    localEnvironment: true,
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

const task = (threads: ReadonlyArray<WorkThreadNode>): WorkTaskNode => ({
  id: "ord-7",
  key: "ORD-7",
  title: "Order notes header",
  done: false,
  status: "idle",
  threads,
  removable: true,
  context: undefined,
});

/** A project whose only checkout here is of the given kind; Git says no kind at all. */
const state = (vcs: "git" | "jj") =>
  ({
    repositories: [
      {
        id: "app",
        url: "git@example.test:acme/app.git",
        branch: "main",
        path: "/work/app",
        state: "ready",
        ...(vcs === "jj" ? { vcs } : {}),
      },
    ],
    work: { areas: [], tasks: [], threads: [], assignments: {} },
  }) as unknown as PeerProjectState;

const STATUS = { email: "slavo@acme.test", environmentId: HERE } as unknown as PeerHubStatus;

const rows = (threads: ReadonlyArray<WorkThreadNode>, project = state("git")) =>
  detailRows({
    task: task(threads),
    summaries: [],
    handoff: undefined,
    created: undefined,
    state: project,
    status: STATUS,
    workspace: "acme",
    now: NOW,
    clock: () => "10:00",
  });

describe("the task details' ref row", () => {
  it("says Bookmark for a jj thread and Branch for a Git one", () => {
    const jj = rows([thread({ key: "a", branch: "feature/ord-7-a1", vcs: "jj" })], state("jj"));
    expect(jj[0]).toEqual({ label: "Bookmark", value: "feature/ord-7-a1", mono: true });
    const git = rows([thread({ key: "b", branch: "ord-7-split" })]);
    expect(git[0]).toEqual({ label: "Branch", value: "ord-7-split", mono: true });
  });

  it("takes the project's words here before any thread has a ref", () => {
    expect(rows([], state("jj"))[0]).toEqual({ label: "Bookmark", value: "None yet", mono: false });
    expect(rows([], state("git"))[0]?.label).toBe("Branch");
  });

  it("names both when a Git teammate and a jj checkout work on one task", () => {
    const mixed = rows(
      [
        thread({ key: "a", branch: "feature/ord-7-a1", vcs: "jj" }),
        thread({ key: "b", branch: "ord-7-split", mine: false, person: "Ana" }),
      ],
      state("jj"),
    );
    expect(mixed[0]?.label).toBe("Branches and bookmarks");
  });
});
