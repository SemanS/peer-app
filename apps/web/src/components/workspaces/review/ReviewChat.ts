import { createContext } from "react";

/** The chat a handoff came from, which the review can open: the person's own agent on the task. */
export interface ReviewChat {
  readonly title: string;
  readonly open: () => void;
}

/**
 * What the review page tells the sections plugins draw on it: their chat, when they have one on
 * the task here. A plugin's section takes its data from its props, and this is not data of the
 * Hub's: it comes from this computer's threads, which only the page has built.
 */
export const ReviewChatContext = createContext<ReviewChat | null>(null);
