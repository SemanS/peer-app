import { createContext } from "react";

/** The chat a handoff came from, which the page can open: the person's own agent on the task. */
export interface HandoffChat {
  readonly title: string;
  readonly open: () => void;
}

/**
 * What the pages that show a task's handoff (the review, the task's context) tell the handoff
 * section drawn there: the person's chat on the task, when they have one here. A plugin's section
 * takes its data from its props, and this is not data of the Hub's: it comes from this computer's
 * threads, which only the page has built.
 */
export const HandoffChatContext = createContext<HandoffChat | null>(null);
