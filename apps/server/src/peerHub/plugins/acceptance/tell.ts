/**
 * What agents read of acceptance: one line at the end of `peer status` for the session's own task,
 * and a fact on each accepted task's line in `peer task list`. Acceptance stops nothing, so it is never a notice, a verdict or a gate; an agent can
 * neither give nor withdraw one. The note is its lead's words, cleaned as other people's are.
 *
 * @module peerHub/plugins/acceptance/tell
 */
import type { PeerTaskAcceptance } from "@t3tools/contracts";

import { plain } from "../../peerText.ts";

/** Whether the acceptance was given before the task was reopened: the Hub says so; an older Peer guessed it. */
const reopened = (acceptance: PeerTaskAcceptance, taskStatus: string | undefined) =>
  acceptance.beforeReopening ?? taskStatus === "open";

/** A moment as the Hub stores it (UTC), the way the status reads it: `2026-10-28 10:00 UTC`. */
const when = (at: string) => `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;

/**
 * The status line: "Acceptance: accepted by Ana on 2026-10-28 10:00 UTC (note: "…")", said as given
 * before a reopening when the Hub says the task was reopened after it, or the last withdrawal; null when the task has
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
    const before = reopened(acceptance, taskStatus) ? ", before the task was reopened" : "";
    return `Acceptance: accepted by ${plain(nameOf(current.by), 80)} on ${when(current.at)}${before}${note(current.note)}.`;
  }
  const last = history.at(-1);
  return last?.kind === "withdrawn"
    ? `Acceptance: withdrawn by ${plain(nameOf(last.by), 80)} on ${when(last.at)}${note(last.note)}; not accepted now.`
    : null;
}

/**
 * A task's fact in `peer task list` and `peer_task` list: "accepted by Ana", or "accepted by Ana
 * before reopening" when the task was reopened after it; null when nobody accepts it now.
 */
export function taskFact(
  acceptance: PeerTaskAcceptance | undefined,
  taskStatus: string | undefined,
  nameOf: (email: string) => string,
): string | null {
  const current = acceptance?.current;
  if (acceptance === undefined || current === null || current === undefined) return null;
  return `accepted by ${plain(nameOf(current.by), 60)}${reopened(acceptance, taskStatus) ? " before reopening" : ""}`;
}
