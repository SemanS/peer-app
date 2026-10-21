import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import { ANA, BOB, ownerCallItem, workProject } from "./ownership/ownership.testkit";
import { ALL_PROJECTS, taskCards, taskTarget } from "./workBoard.logic";
import { attentionCards, workPrimaryTarget, workSearch } from "./workNavigation.logic";

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
