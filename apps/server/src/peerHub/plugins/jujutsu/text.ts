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
const poss = (name: string) => `${plain(name, 60)}'s`;

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

/** `Claude Code` for `claude`, `Codex` for `codex`: how an agent is named to people and agents. */
const agentLabel = (harness: string | undefined) =>
  harness === undefined
    ? undefined
    : harness
        .split(/[-_\s]+/)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ")
        .replace(/^Claude$/, "Claude Code");

/** `ORD-11, Ana · Claude Code`: a followed change's task, person and agent, as far as they are known. */
export const whoseWork = (owner: Owner, harness?: string) =>
  [
    owner.task === undefined ? undefined : plain(owner.task, 60),
    [plain(owner.person, 60), agentLabel(harness)].filter(Boolean).join(" · "),
  ]
    .filter(Boolean)
    .join(", ");

/** What a followed change's new version changed in one file: `order.js +1: export const …`. */
const fileLine = (file: { path: string; added: number; removed: number; first?: string }) =>
  `${plain(file.path, 80)} ${[file.added > 0 ? `+${file.added}` : "", file.removed > 0 ? `-${file.removed}` : ""].filter(Boolean).join(" ")}${file.first === undefined ? "" : `: ${plain(file.first, 80)}`}`;

/** The moved notice (D6): at most 400 characters, the files cut first so the command to read more stays. */
export function movedNotice(input: {
  readonly owner: Owner | undefined;
  readonly change: string;
  readonly from: string;
  readonly files: ReadonlyArray<{ path: string; added: number; removed: number; first?: string }>;
  readonly conflicts: ReadonlyArray<string>;
}) {
  const { owner, change, conflicts } = input;
  const task = owner?.task === undefined ? "A change you build on" : plain(owner.task, 60);
  const who = owner === undefined ? "A teammate's agent" : `${poss(owner.person)} agent`;
  const head = `${task} moved under you. ${who} changed ${plain(change, 40)}. ${
    conflicts.length === 0
      ? "jj moved your change onto the new version and updated your files. No conflict with your change."
      : `jj moved your change onto the new version, and it conflicts in ${plain(conflicts.slice(0, 3).join(", "), 80)}. The conflict is stored in your change. Those lines are ${owner === undefined ? "a teammate's" : poss(owner.person)}: keep your edits in your own change.`
  }`;
  const tail = `Full diff: jj interdiff --from ${plain(input.from, 12)} --to ${plain(change, 40)}`;
  const room = MAX - head.length - tail.length - 2;
  const files = room > 20 ? cutText(input.files.slice(0, 3).map(fileLine).join("\n"), room) : "";
  return cutText([head, ...(files === "" ? [] : [files]), tail].join("\n"), MAX);
}

/**
 * The push notice (D6), said before the push runs; the spec's words. The other change is named by
 * its task, and by its bookmark only while no task is known.
 */
export const pushNotice = (input: {
  readonly task: string | undefined;
  readonly change: string;
  readonly other: string | undefined;
  readonly bookmark: string | undefined;
}) => {
  const mine = input.task === undefined ? "Your work" : plain(input.task, 60);
  const label = input.other ?? input.bookmark;
  const theirs = label === undefined ? "" : plain(label, 100);
  return [
    `${mine} builds on ${plain(input.change, 40)}${theirs === "" ? "" : ` (${theirs})`}, which has not landed, so the push carries both.`,
    input.bookmark === undefined
      ? "Open its pull request on that teammate's branch once it has one."
      : `Open its pull request with --base ${plain(input.bookmark, 100)}.`,
    `When ${input.other === undefined ? "that" : `${theirs}'s`} pull request merges and its branch is deleted, GitHub moves this one onto main.`,
    "Run the push again to go ahead.",
  ].join(" ");
};

/** After a person undid a step of this session (D7): once, at its next step. */
export const undoneNotice = (input: {
  readonly by: string;
  readonly description: string;
  readonly files: ReadonlyArray<string>;
}) =>
  cutText(
    `${plain(input.by, 60)} undid your step ${plain(input.description, 80)} (jj op revert). ${
      input.files.length === 0
        ? "The files you edit may have changed."
        : `${plain(input.files.slice(0, 3).join(", "), 120)} ${input.files.length === 1 ? "is" : "are"} back in your change.`
    } Re-read the files you edit.`,
    MAX,
  );
