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
import { cutText, plain } from "../../peerText.ts";
import type { Directory } from "./Ownership.ts";
import { effectiveOwner } from "./client/rules.ts";

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

/** Paths as one clause: `a`, `a and b`, `a, b and c`, `a, b, c and 2 more`. */
export function pathsText(paths: ReadonlyArray<string>): string {
  const shown = paths.slice(0, 3).map((path) => plain(path, 120));
  if (paths.length > 3) return `${shown.join(", ")} and ${paths.length - 3} more`;
  return shown.length < 2
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/**
 * What an agent reads when its edit of paths another person owns, and decides there, waits for their
 * call (at most 400 characters): whose they are, how to ask, and that nothing else is stopped. With
 * `pending`, the id of its call that waits for an answer, it says that instead of how to ask.
 */
export function editStop(owner: string, paths: ReadonlyArray<string>, pending?: string): string {
  const [who, theirs] = [plain(owner, 60), poss(owner)];
  const head = `Denied by Peer: ${pathsText(paths)} ${paths.length === 1 ? "is" : "are"} ${theirs}, and ${who} decides changes by others there.`;
  return cutText(
    pending === undefined
      ? `${head} Ask ${who} first: peer owner ask ${askedPaths(paths)} "<why you need it>". This edit waits for ${theirs} call; other files are not affected.`
      : `${head} Your call ${plain(pending, 60)} to ${who} has not been answered yet. This edit waits for ${theirs} answer; other files are not affected.`,
    400,
  );
}

/** The paths as `peer owner ask` takes them: at most the first five. */
const askedPaths = (paths: ReadonlyArray<string>) =>
  paths
    .slice(0, 5)
    .map((path) => plain(path, 120))
    .join(" ");

/**
 * What an agent reads when its landing step (`kind`: commit, push, pull request or merge) would land
 * changes in paths another person owns and decides, without an accepted call of theirs that covers
 * them: whose they are and how to ask, or that its call has not been answered.
 */
export function landingStop(
  kind: string,
  owner: string,
  paths: ReadonlyArray<string>,
  pending?: string,
): string {
  const [who, theirs] = [plain(owner, 60), poss(owner)];
  const head = `Denied by Peer: this ${kind} would land ${pathsText(paths)}, which ${paths.length === 1 ? "is" : "are"} ${theirs}: ${who} decides changes by others there`;
  return cutText(
    pending === undefined
      ? `${head}, and no call of ${theirs} covers ${paths.length === 1 ? "it" : "them"}. Ask ${who} first: peer owner ask ${askedPaths(paths)} "<why you need it>". This ${kind} waits for ${theirs} call.`
      : `${head}, and ${who} has not answered your call ${plain(pending, 60)} yet. This ${kind} waits for ${theirs} answer.`,
    600,
  );
}
