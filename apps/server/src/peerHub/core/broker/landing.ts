// @effect-diagnostics globalDate:off - the budget for plugins' notices in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Nothing lands unread (G8). Before a session's work lands, Peer gives it every message addressed to
 * it that it has not read: the notes teammates wrote in its overlaps (their questions, answers, and
 * a person's request to settle one) and the notices plugins flag `landing` (a decision on a request
 * it made, an agreement kept for its task). Work lands when a `git commit`, `git push`,
 * `gh pr create` or `gh pr merge` runs in the agent's shell (`isLanding`), or when it runs
 * `peer review` or `peer done` (the commands check for themselves). Peer stops the step once to give
 * the messages; the same step again runs, unless something new came meanwhile. Advice (impact,
 * forecast, plans, dependencies, announcements, knowledge) never stops a step: it reaches the agent
 * as at any other, and a plugin's notice that is not flagged is advice.
 *
 * What is a landing step goes by the words of the command only, never by its output or a model: a
 * command hidden in a script or an alias is not recognized.
 *
 * @module peerHub/core/broker/landing
 */
import { gitCommands } from "../../handoffCommands.ts";
import { cutText, plain } from "../../peerText.ts";
import {
  type CoordinationView,
  editHookAnswer,
  type NameOf,
  noContest,
  overlapSubject,
  type TaskNamer,
} from "../coordination/edits.ts";
import { unseenNotes } from "../coordination/news.ts";
import type { OwnerCallNeeded } from "../hub/hubApi.ts";
import type { HubOverlap } from "../hub/coordApi.ts";
import type { PeerToolContext } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { type CliError, refused } from "./cliContract.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import {
  type PipelineStep,
  type PreparedDelivery,
  remainingMs,
  stepNotices,
  VERDICT_BUDGET_MS,
} from "./pipeline.ts";
import type { LocalSession } from "./sessions.ts";

/** What each landing command is called in the stop that waits for it. */
const KINDS: ReadonlyMap<string, string> = new Map([
  ["git commit", "commit"],
  ["git push", "push"],
  ["gh pr create", "pull request"],
  ["gh pr merge", "merge"],
]);

/**
 * The first landing step a shell command runs, as the stop names it (`commit`, `push`, `pull
 * request` or `merge`); undefined when it runs none. `echo "git commit"` and `git log` run none.
 */
export function landingKind(command: string): string | undefined {
  for (const run of gitCommands(command)) {
    const kind = KINDS.get(run);
    if (kind !== undefined) return kind;
  }
  return undefined;
}

/**
 * Whether a shell command runs a landing step, alone or within a compound command, after any
 * leading `VAR=value` words: `git commit`, `git push`, `gh pr create` or `gh pr merge`. `peer
 * review` and `peer done` are landing steps too, but they are Peer's own commands, which check
 * for themselves.
 */
export const isLanding = (command: string): boolean => landingKind(command) !== undefined;

/** A teammate's note, quoted in a stop, at most this long. */
const NOTE_MAX = 600;
/** What a note was about (its files, or the task asked about), at most this long. */
const SUBJECT_MAX = 200;

/** The messages waiting for a session at a landing step, as the stop gives them. */
export interface WaitingMessages {
  /** One block per message: teammates' notes in the session's overlaps, then the plugins' notices. */
  readonly blocks: ReadonlyArray<string>;
  /** How many of the blocks, the last ones, are plugins' notices. */
  readonly fromPlugins: number;
  /** The notes, by id, that now count as shown to the session. */
  readonly notes: ReadonlyArray<string>;
}

/**
 * A teammate's note as the stop gives it: who wrote it and about what, then its words in quotes,
 * cleaned of what a reader cannot see and of tags that could pose as Peer's or the harness's.
 */
function noteBlock(input: {
  readonly note: HubOverlap["notes"][number];
  readonly overlap: HubOverlap;
  readonly view: CoordinationView;
  readonly nameOf: NameOf;
  readonly taskName: TaskNamer;
}): string {
  const { note, overlap, view, nameOf, taskName } = input;
  const name = plain(nameOf(note.email), 60);
  const task = view.sessions.find((session) => session.id === note.session)?.task;
  // The task's key says which agent it is, as a title would at greater length.
  const key = task === undefined ? "" : `${plain(taskName(task).split(" · ")[0] ?? task, 40)} · `;
  const author = note.session === undefined ? `${name} (person)` : `${key}${name}’s agent`;
  const subject = plain(overlapSubject(overlap.files, taskName), SUBJECT_MAX);
  return `[teammate text] ${author}, in your overlap on ${subject}:\n"${plain(note.text, NOTE_MAX)}"`;
}

/**
 * The messages the session has not read, which the landing step waits for: the notes of its
 * overlaps that an ordinary step would give it (`unseenNotes`), then the plugins' notices flagged
 * `landing`, read for at most `budgetMs`. Null when nothing waits. The notes count as shown from
 * here on, as at an ordinary step; a plugin marks its own text told when it reads it.
 */
export async function landingMessages(
  this: CoordinationBroker,
  session: LocalSession,
  step: PipelineStep,
  ctx: PeerToolContext,
  budgetMs: number,
): Promise<WaitingMessages | null> {
  const view = this.merged(session.workspace, this.views.get(session.workspace));
  const nameOf = this.nameOf(session.workspace);
  const taskName = this.taskNamer(session.workspace, session.project);
  const notes = view.overlaps
    .filter((overlap) => overlap.sessions.includes(session.id))
    .flatMap((overlap) =>
      unseenNotes(overlap, session.id, session.memory).map((note) => ({
        id: note.id,
        block: noteBlock({ note, overlap, view, nameOf, taskName }),
      })),
    );
  for (const { id } of notes) session.memory.seenNotes.add(id);
  const theirs = (await stepNotices(step, ctx, { landing: budgetMs }))?.blocks ?? [];
  if (notes.length + theirs.length === 0) return null;
  return {
    blocks: [...notes.map(({ block }) => block), ...theirs],
    fromPlugins: theirs.length,
    notes: notes.map(({ id }) => id),
  };
}

/** A stop's reason, at most this long, so a landing step costs the agent no more. */
const STOP_MAX = 2000;
/** What the line that names the rest takes, at most, with its line break. */
const MORE_ROOM = 70;

const waits = (count: number) =>
  count === 1
    ? "a message from a teammate waits for you"
    : `${count} messages from teammates wait for you`;

/**
 * What a stop says: `head`, as many of the messages as fit within the bound (the first always goes,
 * cut if it alone is more), `tail`, and when some did not fit, the line that ends it: how to read
 * the rest.
 */
export function stopText(input: {
  readonly head: string;
  readonly blocks: ReadonlyArray<string>;
  readonly tail?: string;
  readonly cli: string;
}): string {
  const { head, blocks, tail, cli } = input;
  const room = STOP_MAX - head.length - (tail?.length ?? 0) - MORE_ROOM;
  const carried: string[] = [];
  let used = 0;
  for (const block of blocks) {
    const text = carried.length === 0 ? cutText(block, room - 1) : block;
    if (carried.length > 0 && used + text.length + 1 > room) break;
    carried.push(text);
    used += text.length + 1;
  }
  const left = blocks.length - carried.length;
  return [
    head,
    ...carried,
    ...(tail === undefined ? [] : [tail]),
    ...(left === 0 ? [] : [`${left} more: read ${left === 1 ? "it" : "them"} with ${cli} status.`]),
  ].join("\n");
}

/** What a hook's stop says: that messages wait, the messages, and to run the step again. */
const stopReason = (cli: string, kind: string, blocks: ReadonlyArray<string>) => {
  const them = blocks.length === 1 ? "it" : "them";
  return stopText({
    head: `Denied by Peer: ${waits(blocks.length)}. Read ${them} before this ${kind} lands.`,
    blocks,
    tail: `Run the ${kind} again once you have taken ${them} into account.`,
    cli,
  });
};

/**
 * A delivery that puts the messages back should the stop never reach the agent (its hook script
 * stopped waiting): the notes count as unread again and the plugins' texts, which marked
 * themselves told, wait for the agent's next step.
 */
const putBack = (
  session: LocalSession,
  reason: string,
  waiting: WaitingMessages,
): PreparedDelivery => ({
  plugin: "core",
  first: false,
  text: reason,
  notify: async (state) => {
    if (state !== "dropped") return;
    for (const id of waiting.notes) session.memory.seenNotes.delete(id);
    session.pending.push(...waiting.blocks.slice(waiting.blocks.length - waiting.fromPlugins));
  },
});

/**
 * The answer of a PreToolUse hook to a shell command that lands work: a denial giving the messages
 * waiting for the session, once (they count as shown, so the same command again runs), or null
 * when none waits. A hook within a moment of its deadline answers nobody, so it leaves them
 * unshown for the agent's next step.
 */
export async function landingStop(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
  command: string,
  step: PipelineStep,
  budgetMs: number,
): Promise<Record<string, unknown> | null> {
  if (remainingMs(step) === 0) return null;
  const ctx = this.toolContext(session, body, "pre-tool", remainingMs(step));
  const waiting = await this.landingMessages(session, step, ctx, budgetMs);
  if (waiting === null) return null;
  const reason = stopReason(this.cli, landingKind(command) ?? "step", waiting.blocks);
  this.record("landing.stopped", {
    session: session.id,
    messages: waiting.blocks.length,
    chars: reason.length,
  });
  step.deliveries?.push(putBack(session, reason, waiting));
  return (
    editHookAnswer(session.agent, [{ ...noContest(), decision: "deny", reason }])?.output ?? null
  );
}

/**
 * `peer review` and `peer done` while messages wait for the session: the command ends refused with
 * the first line saying so, the messages below it and `Next:` naming the same command, before it
 * contacts the Hub, and the task stays as it was. Null when none waits, and the command goes on.
 */
export async function landingRefusal(
  this: CoordinationBroker,
  session: LocalSession,
  plugins: PeerBrokerPlugins,
  command: "review" | "done",
): Promise<CliError | null> {
  const step = this.pipelineStep(session, plugins, Date.now() + 2500);
  const ctx: PeerToolContext = {
    session: step.session,
    event: "pre-tool",
    tool: "Bash",
    paths: [],
    command: `${this.cli} ${command}`,
    remainingMs: remainingMs(step),
  };
  const waiting = await this.landingMessages(session, step, ctx, VERDICT_BUDGET_MS);
  if (waiting === null) return null;
  const reason = stopText({
    head: waits(waiting.blocks.length),
    blocks: waiting.blocks,
    cli: this.cli,
  });
  this.record("landing.stopped", {
    session: session.id,
    messages: waiting.blocks.length,
    chars: reason.length,
  });
  return refused(reason, `${this.cli} ${command}`);
}

/** The Hub's refusal of an agent's move to review or done for an owner's call that is missing, if that is what it answered. */
export const ownerCallNeeded = (answer: unknown): OwnerCallNeeded | undefined =>
  typeof answer === "object" && answer !== null && "ownerCallNeeded" in answer
    ? (answer as { readonly ownerCallNeeded: OwnerCallNeeded }).ownerCallNeeded
    : undefined;

/**
 * `peer review` and `peer done` when the Hub did not move the task because a change the session
 * reported waits for an owner's call: the command ends refused, naming the paths and whose call
 * they wait for, and how to ask (`peer owner ask`, while that command is on).
 */
export function ownerCallRefusal(
  this: CoordinationBroker,
  session: LocalSession,
  command: "review" | "done",
  needed: OwnerCallNeeded,
  asking: boolean,
): CliError {
  const owner = plain(this.nameOf(session.workspace)(needed.owner), 60);
  const task = this.taskNamer(
    session.workspace,
    session.project,
  )(session.task ?? "").split(" · ")[0];
  const [first, ...more] = needed.paths.map((path) => plain(path, 120));
  const paths = more.length === 0 ? first : `${first} and ${more.length} more`;
  return refused(
    `${paths} ${more.length === 0 ? "waits" : "wait"} for ${owner}’s call before ${plain(task ?? "", 40)} can go to ${command === "done" ? "done" : "review"}`,
    asking
      ? `peer owner ask ${first} "<why>"`
      : `ask your person to ask ${owner} for the call in Peer, or to turn Ownership on in Settings.`,
  );
}
