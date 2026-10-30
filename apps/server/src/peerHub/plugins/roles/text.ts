/**
 * What the roles plugin says to agents (design D3, the session-roles spec): the deny of an edit and
 * of a landing step, the start block of a review session, the notice of files it changed through
 * the shell, and the prompt a review started from Peer begins with. Paths come from the session's
 * own checkout and are cut to their bound; nothing here quotes a teammate.
 *
 * @module peerHub/plugins/roles/text
 */
import type { PeerTask } from "@t3tools/contracts";

import { plain } from "../../peerText.ts";

/** How a review session reports what it found. */
const REPORT =
  'File what you found with peer tests pass|fail|mixed "<summary>", or tell your person what should change.';

/** A few paths, the rest counted. */
export function pathsText(paths: ReadonlyArray<string>, shown = 3): string {
  const named = paths.slice(0, shown).map((path) => plain(path, 120));
  const more = paths.length - named.length;
  return more > 0 ? `${named.join(", ")} and ${more} more` : named.join(", ");
}

/** The deny of a structured edit by a review session. */
export const editStop = (paths: ReadonlyArray<string>) =>
  `Denied by Peer: this is a review session, and a review session changes no files (${pathsText(paths)}). ${REPORT}`;

/** The deny of a commit, push, pull request or merge by a review session. */
export const landingStop = (kind: string) =>
  `Denied by Peer: this is a review session, and a review session lands nothing (this ${kind} did not run). ${REPORT}`;

/** The deny of a shell command that writes files, before it runs. */
export const shellStop = (write: string) =>
  `Denied by Peer: this is a review session, and a review session changes no files (this ${plain(write, 120)} did not run). ${REPORT}`;

/** A review session's start block: its role and limits, at most 300 characters. */
export const startBlock = () =>
  "Peer: this session reviews (role review). You may read files and run commands. You may not edit files, commit, push, open or merge pull requests, or run peer review or peer done. File what you found with peer tests.";

/** Files a review session changed through the shell, where no edit hook looks: told once each. */
export const changedText = (paths: ReadonlyArray<string>) =>
  `Peer: ${pathsText(paths)} changed in this review session. A review session leaves no changes, and Peer denies the shell's ways of undoing one too: tell your person, and report what you found with peer tests.`;

/** `peer review` from a review session. */
export const reviewRefusal = {
  reason: "this is a review session, and a review session hands nothing over",
  next: "file what you found with peer tests; the task's author hands it over.",
} as const;

/** The first prompt of a review a person started from Peer on `task`. */
export const reviewPrompt = (task: Pick<PeerTask, "id" | "key" | "title">) =>
  [
    `Review ${plain(task.key ?? task.id, 40)}: ${plain(task.title, 120)}.`,
    "You are a review session: read the change, run its tests and checks, and change nothing.",
    "Peer stops edits, commits, pushes and pull requests in this session.",
    'When you are done, file a test report with peer tests pass|fail|mixed "<summary>" --pass "<check>" --fail "<check>" --unverified "<what nobody checked> @<person>".',
  ].join(" ");

/** `peer role` for the session's role. */
export const roleText = (role: string | undefined) =>
  role === "review"
    ? "This session reviews (role review): it may read and run commands, and may not edit files, land work, or run peer review or peer done. Only your person can clear the role, in Peer."
    : "This session has no role: it works as any session does. peer role review makes it a review session, while it has changed nothing.";

/** What `peer role review` answers once the session reviews. */
export const tookText =
  "This session now reviews (role review). It may read files and run commands; it may not edit files, commit, push, open or merge pull requests, or run peer review or peer done. File what you found with peer tests.";
