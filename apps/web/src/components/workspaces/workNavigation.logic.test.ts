import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import { ANA, BOB, ownerCallItem, workProject } from "./ownership/ownership.testkit";
import { ALL_PROJECTS, taskCards, taskTarget } from "./workBoard.logic";
import {
  attentionCards,
  workPrimaryTarget,
  workSearch,
  workTaskSummary,
} from "./workNavigation.logic";
import { localScope, resolveProjectScope, type ProjectCatalog } from "./projectScope.logic";
import { listRows } from "./workList.logic";

function cardsFor(email: string) {
  const project = workProject(email);
  const reviewing = {
    ...project,
    areas: project.areas.map((area) => ({
      ...area,
      tasks: area.tasks.map((task) => (task.key === "VL9" ? { ...task, inReview: true } : task)),
    })),
  };
  return taskCards([reviewing], {
    scope: ALL_PROJECTS,
    mine: false,
    query: "",
    needs: [ownerCallItem()],
    me: email,
  });
}

describe("Work decision navigation", () => {
  it("keeps the attention URL distinct without depending on a stored layout", () => {
    expect(workSearch({ view: "needs-you" })).toEqual({ view: "needs-you" });
    expect(workSearch({ view: "board" })).toEqual({});
    expect(workSearch({})).toEqual({});
  });

  it("shows the person's review and other decisions, leaving ordinary work out", () => {
    const cards = cardsFor(BOB);
    const waiting = attentionCards(cards);
    expect(waiting.some((card) => card.kind === "task" && card.task.key === "VL9")).toBe(true);
    expect(waiting.some((card) => card.kind === "owner-call")).toBe(true);
    expect(waiting.length).toBeLessThan(cards.length);
    expect(waiting.some((card) => card.kind === "task" && card.task.key === "VL10")).toBe(false);
    expect(
      attentionCards(cardsFor(ANA)).some((card) => card.kind === "task" && card.task.key === "VL9"),
    ).toBe(false);
    expect(attentionCards([])).toEqual([]);
  });

  it("opens a waiting review at its decision and preserves the explicit details target", () => {
    const review = cardsFor(BOB).find((card) => card.kind === "task" && card.task.key === "VL9");
    if (review?.kind !== "task") throw new Error("Missing review fixture");
    expect(workPrimaryTarget(review)).toEqual({
      kind: "review",
      workspace: "acme",
      project: "ordering",
      task: review.task.id,
    });
    expect(taskTarget(review)).toEqual({
      kind: "task",
      workspace: "acme",
      project: "ordering",
      task: review.task.id,
    });
    const waitingForBob = cardsFor(ANA).find(
      (card) => card.kind === "task" && card.task.key === "VL9",
    );
    if (waitingForBob?.kind !== "task") throw new Error("Missing teammate review fixture");
    expect(workPrimaryTarget(waitingForBob)).toEqual(taskTarget(waitingForBob));
  });

  it("keeps ordinary and approval tasks' details entry while retaining their action", () => {
    const ordinary = cardsFor(BOB).find((card) => card.kind === "task" && card.task.key === "VL10");
    if (ordinary?.kind !== "task") throw new Error("Missing ordinary fixture");
    expect(workPrimaryTarget(ordinary)).toEqual(taskTarget(ordinary));
    const approval = {
      ...ordinary,
      action: {
        label: "Approve" as const,
        target: {
          kind: "chat" as const,
          open: {
            kind: "thread" as const,
            environmentId: ownerCallItem().environmentId,
            threadId: ThreadId.make("approval-chat"),
          },
        },
      },
    };
    expect(workPrimaryTarget(approval)).toEqual(taskTarget(approval));
  });
});

describe("Work project scope", () => {
  const tree = [workProject(BOB)];
  const known: ProjectCatalog = {
    peer: [
      { scope: "acme/ordering", name: "Ordering demo", refs: [] },
      { scope: "acme/empty", name: "Empty project", refs: [] },
    ],
    groups: [{ projectKey: "server", displayName: "server", memberProjectRefs: [] }],
  };
  const contents = (stored: string) => {
    const selected = resolveProjectScope(stored, known);
    const board = taskCards(tree, {
      scope: selected.scope,
      mine: false,
      query: "",
      needs: [ownerCallItem()],
      me: BOB,
    });
    return {
      selected,
      board,
      active: listRows(board, "active"),
      done: listRows(board, "done"),
      attention: attentionCards(board),
    };
  };

  it("keeps a local project selected and never leaks team tasks or decisions into its views", () => {
    const view = contents(localScope("server"));
    expect(view.selected).toMatchObject({ scope: "local:server", name: "server" });
    expect(view.board).toEqual([]);
    expect(view.active).toEqual([]);
    expect(view.done).toEqual([]);
    expect(view.attention).toEqual([]);
  });

  it("retains a valid empty workspace project even before it has a work-tree node", () => {
    const view = contents("acme/empty");
    expect(view.selected).toMatchObject({ scope: "acme/empty", name: "Empty project" });
    expect(view.board).toEqual([]);
    expect(view.active).toEqual([]);
    expect(view.done).toEqual([]);
    expect(view.attention).toEqual([]);
  });

  it("preserves all-project work and falls back only for genuinely missing catalog entries", () => {
    const all = contents(ALL_PROJECTS);
    expect(all.active.length).toBeGreaterThan(0);
    expect(all.attention.some((card) => card.kind === "owner-call")).toBe(true);
    expect(contents("acme/deleted")).toEqual(all);
    expect(contents(localScope("deleted"))).toEqual(all);
    expect(contents("acme/ordering").board).toEqual(all.board);
  });
});

describe("Work summary", () => {
  it("does not describe unstarted or idle tasks as running", () => {
    const cards = cardsFor(BOB)
      .filter((card) => card.kind === "task")
      .map((card) => ({
        ...card,
        state: { kind: "new" as const, label: "Not started", waitingOn: undefined },
        column: "new" as const,
        task: { ...card.task, threads: [] },
      }));
    expect(workTaskSummary(cards)).toEqual({
      open: cards.length,
      running: 0,
      needsYou: 0,
      done: 0,
    });
  });
  it("counts attention separately and never treats a completed turn as a completed task", () => {
    const cards = cardsFor(BOB);
    const summary = workTaskSummary(cards);
    expect(summary.needsYou).toBe(attentionCards(cards).length);
    expect(summary.open + summary.done).toBe(cards.filter((card) => card.kind === "task").length);
    const base = cards.find((card) => card.kind === "task")!;
    const idle = {
      ...base,
      state: { kind: "paused" as const, label: "Waiting to continue", waitingOn: undefined },
      column: "paused" as const,
      task: {
        ...base.task,
        threads: base.task.threads.map((thread) => ({ ...thread, status: "done" as const })),
      },
    };
    expect(workTaskSummary([idle])).toEqual({ open: 1, running: 0, needsYou: 0, done: 0 });
  });
});
