/**
 * What this plugin says to agents, in one place. People's words in it (their names, the paths they
 * own, a reason, a note) are cleaned of what a reader cannot see and cannot pose as Peer's or the
 * harness's (`peerText.ts`); a note or a reason a teammate wrote is quoted after a line that says it
 * is teammate text, never as an instruction.
 *
 * @module peerHub/plugins/ownership/text
 */
import type { PeerOwnerCall, PeerOwnershipProject } from "@t3tools/contracts";

import type { PeerSessionView } from "../../core/plugin.ts";
import { plain } from "../../peerText.ts";
import type { Directory } from "./Ownership.ts";
import { effectiveOwner } from "./rules.ts";

/** A person's name as a possessive: `Ana’s`. */
export const poss = (name: string) => `${plain(name, 60)}’s`;

/** How long ago, in the units an agent reads at a glance: `now`, `40 min`, `2 h`, `3 days`. */
export function ageText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

/** Whether a call still waits for its owner at `now`: the Hub reads one past its expiry as expired later. */
export const waiting = (call: PeerOwnerCall, now: number) =>
  call.state === "pending" && Date.parse(call.expiresAt) > now;

/**
 * The line `peer status` ends with: whose the session's task is, and the calls its session waits
 * on; null when there is nothing to say of either.
 */
export function statusLine(input: {
  readonly session: PeerSessionView;
  readonly project: PeerOwnershipProject;
  readonly person: string;
  readonly directory: Directory;
  readonly now: number;
}): string | null {
  const { session, project, person, directory, now } = input;
  const parts: string[] = [];
  if (session.task !== undefined) {
    const owner = effectiveOwner(
      directory.task(session.task) ?? {},
      Object.hasOwn(project.tasks, session.task) ? project.tasks[session.task] : undefined,
      project.map,
      directory.people,
    )?.owner;
    if (owner !== undefined)
      parts.push(
        `${plain(directory.label(session.task), 40)} is ${owner === person ? "yours" : poss(directory.name(owner))}`,
      );
  }
  const asked = project.calls.filter(
    (call) => call.email === person && call.session === session.id && waiting(call, now),
  );
  const first = asked[0];
  if (first !== undefined) {
    const age = (call: PeerOwnerCall) => `${call.id}, ${ageText(now - Date.parse(call.createdAt))}`;
    parts.push(
      asked.length === 1
        ? `1 call to ${plain(directory.name(first.owner), 60)} pending (${age(first)})`
        : `${asked.length} calls pending (${asked.slice(0, 3).map(age).join("; ")})`,
    );
  }
  return parts.length === 0 ? null : `Ownership: ${parts.join(" · ")}`;
}
