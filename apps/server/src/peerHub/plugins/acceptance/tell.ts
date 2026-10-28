/**
 * What agents read of acceptance: one line at the end of `peer status` for the session's own task,
 * as a fact. Acceptance stops nothing, so it is never a notice, a verdict or a gate; an agent can
 * neither give nor withdraw one. The note is its lead's words, cleaned as other people's are.
 *
 * @module peerHub/plugins/acceptance/tell
 */
import type { PeerTaskAcceptance } from "@t3tools/contracts";

import { plain } from "../../peerText.ts";

/** A moment as the Hub stores it (UTC), the way the status reads it: `2026-10-28 10:00 UTC`. */
const when = (at: string) => `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;

/**
 * The status line: "Acceptance: accepted by Ana on 2026-10-28 10:00 UTC (note: "…")", said as given
 * before a reopening when the task is open again, or the last withdrawal; null when the task has
 * neither.
 */
export function statusLine(
  acceptance: PeerTaskAcceptance | undefined,
  taskStatus: string | undefined,
  nameOf: (email: string) => string,
): string | null {
  if (acceptance === undefined) return null;
  const { current, history } = acceptance;
  const note = (text: string | undefined) =>
    text === undefined || text.trim() === "" ? "" : ` (note: "${plain(text, 300)}")`;
  if (current !== null) {
    const reopened = taskStatus === "open" ? ", before the task was reopened" : "";
    return `Acceptance: accepted by ${plain(nameOf(current.by), 80)} on ${when(current.at)}${reopened}${note(current.note)}.`;
  }
  const last = history.at(-1);
  return last?.kind === "withdrawn"
    ? `Acceptance: withdrawn by ${plain(nameOf(last.by), 80)} on ${when(last.at)}${note(last.note)}; not accepted now.`
    : null;
}
