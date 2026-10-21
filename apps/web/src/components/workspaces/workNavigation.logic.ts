import { taskTarget, type TaskCard, type TaskTarget, type WorkTaskCard } from "./workBoard.logic";

export function workSearch(search: Record<string, unknown>): { readonly view?: "needs-you" } {
  return search.view === "needs-you" ? { view: "needs-you" } : {};
}

/** Reviews open at the decision; other tasks keep their usual details entry. */
export function workPrimaryTarget(card: WorkTaskCard): TaskTarget {
  return card.action?.target.kind === "review" ? card.action.target : taskTarget(card);
}

export function attentionCards(cards: ReadonlyArray<TaskCard>): ReadonlyArray<TaskCard> {
  return cards.filter((card) => card.column === "needs");
}
