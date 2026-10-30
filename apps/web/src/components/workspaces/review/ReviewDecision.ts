import { createContext } from "react";

/**
 * The review page's two ways on, for the decision line a plugin draws at the top of the page:
 * Mark done, and Reopen (with a note when the person's agent can hear one). The page owns them,
 * since they act on the task whatever plugins are on; `claim` tells it that a decision line shows
 * them, so its bar at the bottom keeps only the note and the links. `claim` returns the release.
 */
export interface ReviewDecision {
  readonly markDone: () => void;
  readonly reopen: () => void;
  /** "Reopen with a note…", "Continue note…" or "Reopen task". */
  readonly reopenLabel: string;
  readonly busy: boolean;
  readonly done: boolean;
  readonly claim: () => () => void;
}

export const ReviewDecisionContext = createContext<ReviewDecision | null>(null);
