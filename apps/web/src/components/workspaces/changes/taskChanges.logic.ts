/**
 * What a task's page says about its changes: the stack down to trunk, what moves under the task,
 * and how it lands. The stack itself (`taskStack`) is the client runtime's; this is its wording.
 */
import {
  changeIdParts,
  changeKeyAndTitle,
  changeStat,
  type TaskStack,
  type TaskStackEntry,
} from "@t3tools/client-runtime/peer/changes";
import { agentName, personName } from "@t3tools/client-runtime/peer/jujutsu";
import type { ReviewDiff } from "@t3tools/contracts";

import type { WorkTaskNode } from "../workTree.logic";

export interface StackLine {
  readonly changeId: string;
  readonly pre: string;
  readonly rest: string;
  readonly subject: string;
  readonly shape: TaskStackEntry["shape"];
  readonly detail: string;
  readonly readOnly: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One entry of the stack in words: whose it is, who may touch it, how far it has come. */
export function stackLine(entry: TaskStackEntry, ids: ReadonlyArray<string>): StackLine {
  const { change } = entry;
  const person = personName(change.author.email);
  const detail = entry.readOnly
    ? `${person}'s, read-only for your agent · version ${entry.versions}${entry.movedAgo === undefined ? "" : `, moved ${entry.movedAgo}`}`
    : [
        entry.yours
          ? change.working
            ? `Yours · ${agentName(change.author.agent)} works in it`
            : `Yours · ${agentName(change.author.agent)} is idle in it`
          : `${person}'s`,
        changeStat(change),
        plural(entry.versions, "version", "versions"),
      ]
        .filter((part) => part !== "")
        .join(" · ");
  return {
    changeId: change.changeId,
    ...changeIdParts(change.changeId, ids),
    subject: change.subject,
    shape: entry.shape,
    detail,
    readOnly: entry.readOnly,
  };
}

/** The teammate's change the task builds on directly: what "Stop building on …" lets go of. */
export function stopTarget(stack: TaskStack): TaskStackEntry | undefined {
  return stack.entries.find((entry) => entry.readOnly);
}

/** "ORD-11": a change's task key, else its short id. */
export const changeName = (entry: TaskStackEntry): string =>
  changeKeyAndTitle(entry.change).key ?? entry.change.changeId.slice(0, 8);

export function buildsOnText(entry: TaskStackEntry): string {
  return `Your agent builds on ${personName(entry.change.author.email)}'s change. When it is amended, jj carries your task's change along, and Peer tells your agent what moved at its next tool step.`;
}

/** The stacked pull request: the agent opens it with `--base`; GitHub retargets it when the base merges. */
export function landingText(
  target: TaskStackEntry,
  taskName: string,
): { title: string; body: string } {
  const person = personName(target.change.author.email);
  const bookmark = target.change.bookmarks[0];
  const name = changeName(target);
  return {
    title:
      bookmark === undefined
        ? `A stacked pull request, on ${name}'s branch`
        : `A stacked pull request, on ${bookmark}`,
    body:
      `${taskName} sits on ${person}'s change, so a push carries both. When your agent runs jj git push, Peer tells it to open the pull request with ` +
      (bookmark === undefined
        ? `--base set to ${name}'s branch, once ${name} has one. `
        : `--base ${bookmark}. `) +
      `When ${name}'s pull request merges and its branch is deleted, GitHub moves this one onto main.`,
  };
}

/**
 * The session `peer.jujutsu.follow` acts on: the person's own live agent on the task, by the work
 * tree's id for its thread: `peer:<thread id>` for a Peer thread, herdr's agent id for a herdr
 * agent. The pair cards send the same form.
 */
export function followSession(task: Pick<WorkTaskNode, "threads">): string | undefined {
  for (const thread of task.threads) {
    if (!thread.mine || thread.stale || thread.open === undefined) continue;
    if (thread.open.kind === "thread") return `peer:${thread.open.threadId}`;
    if (thread.open.kind === "herdr") return thread.open.agentId;
  }
  return undefined;
}

export interface MovedModel {
  readonly heading: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly added: number;
    readonly removed: number;
    readonly lines: ReadonlyArray<{
      readonly kind: "context" | "add" | "del";
      readonly text: string;
    }>;
  }>;
  readonly notes: ReadonlyArray<string>;
}

const MOVED_LINES = 6;

/** What moved under the task, from the diff of the change it builds on. */
export function movedModel(diff: ReviewDiff, target: TaskStackEntry): MovedModel {
  const person = personName(target.change.author.email);
  const name = changeName(target);
  if (diff.state === "notHere") {
    return {
      heading: `${person}'s newest version of ${name} is not pushed or shared yet`,
      files: [],
      notes: ["Nothing is compared until it is on this computer."],
    };
  }
  const versions =
    diff.fromVersion !== undefined && diff.toVersion !== undefined
      ? `: version ${diff.fromVersion} → ${diff.toVersion}`
      : "";
  return {
    heading: `${person} amended ${name}${versions}`,
    files: diff.files.slice(0, 3).map((file) => ({
      path: file.path,
      added: file.added,
      removed: file.removed,
      lines: file.lines.slice(0, MOVED_LINES),
    })),
    notes: [
      ...(diff.state === "partial" && diff.toVersion !== undefined
        ? [`Compared up to version ${diff.toVersion}, the newest this computer has.`]
        : []),
      ...(diff.leftOut !== undefined && diff.leftOut > 0
        ? [
            `Main gained ${plural(diff.leftOut, "commit", "commits")} meanwhile; ${diff.leftOut === 1 ? "it is" : "they are"} left out.`,
          ]
        : []),
    ],
  };
}
