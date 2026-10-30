import { taskTarget, type TaskCard, type TaskTarget } from "./workBoard.logic";

/** One line of the sidebar's Needs your attention: what it is, what it asks, where that happens. */
export interface AttentionRow {
  readonly key: string;
  readonly title: string;
  readonly taskKey: string | undefined;
  readonly ask: string;
  /** Undefined for what is decided in the Needs your attention queue itself. */
  readonly target: TaskTarget | undefined;
}

/** A card of the board's Needs your attention column as the sidebar lists it. */
export function sidebarAttention(card: TaskCard): AttentionRow {
  const place = { key: card.key, taskKey: card.task?.key };
  switch (card.kind) {
    case "task":
      return {
        ...place,
        title: card.task.title,
        ask: card.state.label,
        target: card.action?.target ?? taskTarget(card),
      };
    case "chat":
      return {
        ...place,
        title: card.item.title,
        ask: card.item.need === "approval" ? "Needs your approval" : "Needs your answer",
        target: { kind: "chat", open: card.item.open },
      };
    case "request":
      return { ...place, title: card.item.title, ask: "A teammate asks you", target: undefined };
    case "overlap":
      return { ...place, title: card.item.title, ask: "Decide who goes on", target: undefined };
    case "owner-call":
      return { ...place, title: card.item.title, ask: "Your call", target: undefined };
    case "stale":
      return { ...place, title: card.item.title, ask: "Inputs changed", target: undefined };
  }
}
