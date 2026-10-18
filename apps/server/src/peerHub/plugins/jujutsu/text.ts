/**
 * What this plugin says to agents, in one place. Whose change it is, and its task, are what another
 * person's agent wrote or a teammate's Hub entry holds, so they are cleaned of what a reader cannot
 * see and of tags that could pose as Peer's or the harness's (`peerText.ts`). Each text is at most
 * 400 characters.
 *
 * @module peerHub/plugins/jujutsu/text
 */
import { cutText, plain } from "../../peerText.ts";

const MAX = 400;

/** Whose change it is: the person, their task and the first thing a name could be asked by. */
export interface Owner {
  readonly person: string;
  readonly task: string | undefined;
}

/** A name as a possessive: `Ana’s`. */
const poss = (name: string) => `${plain(name, 60)}’s`;

/** `Ana’s change for ORD-11`, or `Ana’s change` when the task is not known. */
const whose = ({ person, task }: Owner) =>
  `${poss(person)} change${task === undefined ? "" : ` for ${plain(task, 60)}`}`;

/** How to ask the agent that works on the task. */
const ask = (task: string | undefined) =>
  `peer ask ${task === undefined ? "<task>" : plain(task, 60)} "…"`;

/** The stop of `--ignore-immutable` when its words name a change of another session. */
export const stopNamed = (change: string, owner: Owner) =>
  cutText(
    [
      "Peer stopped this command before it ran.",
      `--ignore-immutable would rewrite ${plain(change, 40)}, ${whose(owner)}.`,
      `Ask its agent: ${ask(owner.task)}.`,
      "A person can run it in a terminal.",
    ].join("\n"),
    MAX,
  );

/** The stop when the words name nothing of another session's: it could still rewrite a teammate's or landed history. */
export const stopGeneral = () =>
  [
    "Peer stopped this command before it ran.",
    "--ignore-immutable can rewrite a teammate's change or landed history.",
    `Ask first: ${ask(undefined)}.`,
    "A person can run it in a terminal.",
  ].join("\n");

/** After a command named another session's change: jj keeps it read-only here. Said once per change. */
export const protectedNotice = (change: string, owner: Owner) =>
  cutText(
    [
      `${plain(change, 40)} is ${whose(owner)}, so jj keeps it read-only in your workspace.`,
      `Keep the edit in your own change, or ask: ${ask(owner.task)}`,
    ].join("\n"),
    MAX,
  );

/** After Peer merged two versions of the agent's change that a rewrite in another workspace left. */
export const convergedNotice = (change: string) =>
  cutText(
    `Peer merged two versions of your change ${plain(change, 40)}: another agent rewrote it while your edit was not yet saved. Both are in the one version now. Re-read the files you edit before you change them again.`,
    MAX,
  );

/** When jj could not choose and a person must: both versions stay. */
export const twoVersionsNotice = (change: string) =>
  cutText(
    `Your change ${plain(change, 40)} has two versions, because another agent rewrote it while your edit was not yet saved. Nothing is lost: jj keeps both and Peer left them. Keep working in the files you have; a person can run jj converge.`,
    MAX,
  );
