import { taskTarget, type TaskCard, type TaskTarget, type WorkTaskCard } from "./workBoard.logic";

export function workSearch(search: Record<string, unknown>): {
  readonly view?: "needs-you";
  readonly scope?: string;
} {
  return {
    ...(search.view === "needs-you" ? { view: "needs-you" as const } : {}),
    ...(typeof search.scope === "string" && search.scope.length > 0 ? { scope: search.scope } : {}),
  };
}

/** Reviews open at the decision; other tasks keep their usual details entry. */
export function workPrimaryTarget(card: WorkTaskCard): TaskTarget {
  return card.action?.target.kind === "review" ? card.action.target : taskTarget(card);
}

export function attentionCards(cards: ReadonlyArray<TaskCard>): ReadonlyArray<TaskCard> {
  return cards.filter((card) => card.column === "needs");
}

/** Open work includes unstarted and waiting tasks; only a live working agent counts as running. */
export function workTaskSummary(cards: ReadonlyArray<TaskCard>) {
  const tasks = cards.filter((card) => card.kind === "task");
  const open = tasks.filter((card) => card.state.kind !== "done");
  return {
    open: open.length,
    done: tasks.length - open.length,
    running: open.filter((card) =>
      card.task.threads.some((thread) => !thread.stale && thread.status === "working"),
    ).length,
    needsYou: attentionCards(cards).length,
  };
}
