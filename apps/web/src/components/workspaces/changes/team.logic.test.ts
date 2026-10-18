import { describe, expect, it } from "vite-plus/test";

import type { WorkProjectNode, WorkTaskNode, WorkThreadNode } from "../workTree.logic";
import { awaitingReviewIds, gitTeammates, taskOfChange } from "./changes.logic.ts";
import { changeId, row } from "./fixtures.test-util.ts";

const thread = (overrides: Partial<WorkThreadNode> = {}): WorkThreadNode => ({
  key: "peer:1",
  title: "chat",
  person: "Eva",
  email: "eva@acme.dev",
  mine: false,
  status: "working",
  harness: "claude",
  branch: "feature/ORD-14",
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

const task = (overrides: Partial<WorkTaskNode> = {}): WorkTaskNode => ({
  id: "t11",
  key: "ORD-11",
  title: "Receipt totals in cents",
  done: false,
  status: "idle",
  threads: [],
  removable: false,
  context: undefined,
  ...overrides,
});

const project = (
  tasks: ReadonlyArray<WorkTaskNode>,
  unsorted: ReadonlyArray<WorkThreadNode> = [],
): WorkProjectNode => ({
  workspace: "acme",
  workspaceName: "Acme",
  projectId: "ordering",
  name: "Ordering demo",
  areas: [{ name: null, tasks }],
  unsorted,
  context: undefined,
  candidates: 0,
  tasks: [],
});

describe("which task a change belongs to", () => {
  const node = project([task()]);

  it("reads the key from the subject when the report names none", () => {
    expect(
      taskOfChange(node, row("lrorvllt", { subject: "ORD-11: orderTotal returns cents" }))?.id,
    ).toBe("t11");
  });

  it("prefers the task the session reported, by id or key", () => {
    expect(taskOfChange(node, row("lrorvllt", { subject: "wip", task: "t11" }))?.id).toBe("t11");
    expect(taskOfChange(node, row("lrorvllt", { subject: "wip", task: "ord-11" }))?.id).toBe("t11");
  });

  it("finds none for a change on no task of the project", () => {
    expect(taskOfChange(node, row("lrorvllt", { subject: "ORD-99: other" }))).toBeUndefined();
  });
});

describe("what waits for the person's first review", () => {
  const ana = row("lrorvllt", { subject: "ORD-11: cents" });
  const mine = row("qpvuntsm", {
    subject: "ORD-11: mine too",
    author: { email: "slavo@acme.dev", agent: "claude-code" },
  });

  it("lists a teammate's change of a task in review, with no ownership asking someone else", () => {
    const node = project([task({ inReview: true })]);
    expect([...awaitingReviewIds(node, [ana, mine], "slavo@acme.dev")]).toEqual([ana.changeId]);
  });

  it("lists nothing while the task is not in review", () => {
    expect(awaitingReviewIds(project([task()]), [ana], "slavo@acme.dev").size).toBe(0);
  });

  it("lists nothing for a project the work tree does not have", () => {
    expect(awaitingReviewIds(undefined, [ana], "slavo@acme.dev").size).toBe(0);
    expect(changeId("x")).toHaveLength(32);
  });
});

describe("teammates on Git", () => {
  it("lists a colleague's Git thread by branch, once, and leaves jj and own threads to the graph", () => {
    const node = project(
      [
        task({
          threads: [
            thread({ key: "a" }),
            thread({ key: "b" }),
            thread({ key: "c", vcs: "jj" }),
            thread({ key: "d", mine: true }),
            thread({ key: "e", stale: true }),
          ],
        }),
      ],
      [thread({ key: "f", email: "bob@acme.dev", branch: "bob/wip" })],
    );
    expect(gitTeammates(node)).toEqual([
      { email: "bob@acme.dev", agent: "claude", branch: "bob/wip" },
      { email: "eva@acme.dev", agent: "claude", task: "ORD-11", branch: "feature/ORD-14" },
    ]);
  });
});
