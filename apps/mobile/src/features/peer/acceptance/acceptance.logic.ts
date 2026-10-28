/**
 * What the phone shows of a task's acceptance, read-only: one line under the task's row, and a
 * section on the selected task with who accepted it, when, the note and the history. Accepting and
 * withdrawing happen on a computer.
 */
import {
  acceptanceBadge,
  acceptanceState,
  acceptedAtLabel,
  acceptedLine,
  currentOf,
  historyLine,
  historyNewestFirst,
  type DeliveryStatus,
} from "@t3tools/client-runtime/peer/acceptance";
import type { PeerAcceptanceSummary, PeerTaskAcceptance } from "@t3tools/contracts";

export interface AcceptanceSectionView {
  readonly heading: string;
  readonly note: string | undefined;
  readonly accepted: boolean;
  readonly history: ReadonlyArray<{
    readonly key: string;
    readonly line: string;
    readonly note: string | undefined;
  }>;
}

const nonEmpty = (text: string | undefined) =>
  text === undefined || text.trim() === "" ? undefined : text;

/**
 * The section, or null for a task that is not done and was never accepted. Until the page's read
 * arrives the status's summary stands in for it.
 */
export function sectionView(
  summary: PeerAcceptanceSummary | undefined,
  view: PeerTaskAcceptance | null | undefined,
  delivery: DeliveryStatus,
  nameOf: (email: string) => string,
  clock: (at: string) => string = acceptedAtLabel,
): AcceptanceSectionView | null {
  const current = view === null || view === undefined ? summary : currentOf(view);
  const state = acceptanceState(current, delivery);
  const history = historyNewestFirst(view?.history ?? []).map((event, index) => ({
    key: `${event.at}:${event.kind}:${index}`,
    line: historyLine(event, nameOf, clock),
    note: nonEmpty(event.note),
  }));
  if (state === "none" && history.length === 0) return null;
  return {
    heading:
      current === undefined
        ? state === "not-accepted"
          ? "Done · not accepted"
          : "Not accepted"
        : acceptedLine(current, delivery, nameOf, clock),
    note: current !== undefined && "note" in current ? nonEmpty(current.note) : undefined,
    accepted: current !== undefined,
    history,
  };
}

/** The line under a task's row: "Accepted", or "Accepted before reopening"; null with none. */
export const badgeText = (summary: PeerAcceptanceSummary | undefined, delivery: DeliveryStatus) =>
  acceptanceBadge(acceptanceState(summary, delivery));
