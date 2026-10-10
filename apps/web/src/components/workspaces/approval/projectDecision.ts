import type { RuntimeRequestId, UserInputQuestion } from "@t3tools/contracts";
import { create } from "zustand";

import { answerWithDecision } from "./approval.logic";

/** Which questions the person answers as a project decision, by request, until answered. */
export const useProjectDecisions = create<{
  readonly marked: Readonly<Record<string, boolean>>;
  readonly mark: (requestId: RuntimeRequestId, marked: boolean) => void;
}>((set) => ({
  marked: {},
  mark: (requestId, marked) =>
    set((state) => ({ marked: { ...state.marked, [requestId]: marked } })),
}));

/**
 * The answers to send for a request: unchanged, unless the person marked them as a project
 * decision. Then the last answer becomes text that asks the agent to record the decision marked
 * [project]: the person's own words, or the chosen options' labels when the question takes free
 * text. A question that takes only its options keeps them as they are.
 */
export function withProjectDecision(
  requestId: RuntimeRequestId,
  questions: ReadonlyArray<UserInputQuestion>,
  answers: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const marked = useProjectDecisions.getState().marked[requestId] === true;
  useProjectDecisions.getState().mark(requestId, false);
  if (!marked) return answers;
  const last = questions.at(-1);
  const answer = last === undefined ? undefined : answers[last.id];
  if (last === undefined || answer === undefined || last.allowCustomAnswer === false) {
    return answers;
  }
  const labels = (Array.isArray(answer) ? answer : [answer]).map(
    (value) =>
      last.options.find((option) => (option.value ?? option.label) === value)?.label ?? value,
  );
  return { ...answers, [last.id]: answerWithDecision(labels.join(", "), true) };
}
