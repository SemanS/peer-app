// @effect-diagnostics globalDate:off - the budget for plugins' notices in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Nothing lands unread (G8). Before a session's work lands, Peer gives it every message addressed to
 * it that it has not read: the notices plugins flag `landing` (words in its room). Work lands when a
 * `git commit`, `git push`, `gh pr create`, `gh pr merge`, `jj commit`, `jj squash`, `jj new` or
 * `jj git push` runs in the agent's shell (`isLanding`). Peer stops the step once to give the
 * messages; the same step again runs, unless something new came meanwhile. A plugin's notice that is
 * not flagged is advice: it never stops a step, and reaches the agent as at any other.
 *
 * What is a landing step goes by the words of the command only, never by its output or a model: a
 * command hidden in a script or an alias is not recognized.
 *
 * @module peerHub/core/broker/landing
 */
import { gitCommands } from "../../shellCommands.ts";
import { cutText } from "../../peerText.ts";
import { editHookAnswer, noContest } from "../coordination/edits.ts";
import type { PeerToolContext } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { type PipelineStep, type PreparedDelivery, remainingMs, stepNotices } from "./pipeline.ts";
import type { LocalSession } from "./sessions.ts";

/** What each landing command is called in the stop that waits for it. */
const KINDS: ReadonlyMap<string, string> = new Map([
  ["git commit", "commit"],
  ["git push", "push"],
  ["gh pr create", "pull request"],
  ["gh pr merge", "merge"],
  // `jj squash` finishes work into a change, `jj new` leaves the change before it finished.
  ["jj commit", "commit"],
  ["jj squash", "commit"],
  ["jj new", "commit"],
  ["jj git push", "push"],
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
 * leading `VAR=value` words: `git commit`, `git push`, `gh pr create`, `gh pr merge`, or jj's
 * `commit`, `squash`, `new` and `git push`.
 */
export const isLanding = (command: string): boolean => landingKind(command) !== undefined;

/**
 * The messages the session has not read, which the landing step waits for: the plugins' notices
 * flagged `landing`, read for at most `budgetMs`; one block each. A plugin marks its own text told
 * when it reads it.
 */
export async function landingMessages(
  this: CoordinationBroker,
  step: PipelineStep,
  ctx: PeerToolContext,
  budgetMs: number,
): Promise<ReadonlyArray<string>> {
  return (await stepNotices(step, ctx, { landing: budgetMs }))?.blocks ?? [];
}

/** A stop's reason, at most this long, so a landing step costs the agent no more. */
const STOP_MAX = 2000;
/** What the line that names the rest takes, at most, with its line break. */
const MORE_ROOM = 40;

const waits = (count: number) =>
  count === 1
    ? "a message from a teammate waits for you"
    : `${count} messages from teammates wait for you`;

/**
 * What a stop says: `head`, as many of the messages as fit within the bound (the first always goes,
 * cut if it alone is more), `tail`, and when some did not fit, how many wait for the next step.
 * `carried` is how many it says.
 */
export function stopText(input: {
  readonly head: string;
  readonly blocks: ReadonlyArray<string>;
  readonly tail?: string;
}): { readonly text: string; readonly carried: number } {
  const { head, blocks, tail } = input;
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
  return {
    text: [
      head,
      ...carried,
      ...(tail === undefined ? [] : [tail]),
      ...(left === 0 ? [] : [`${left} more at your next step.`]),
    ].join("\n"),
    carried: carried.length,
  };
}

/** What a hook's stop says: that messages wait, the messages, and to run the step again. */
const stopReason = (kind: string, blocks: ReadonlyArray<string>) => {
  const them = blocks.length === 1 ? "it" : "them";
  return stopText({
    head: `Denied by Peer: ${waits(blocks.length)}. Read ${them} before this ${kind} lands.`,
    blocks,
    tail: `Run the ${kind} again once you have taken ${them} into account.`,
  });
};

/**
 * A delivery that puts the messages back should the stop never reach the agent (its hook script
 * stopped waiting): the plugins' texts, which marked themselves told, wait for its next step.
 */
const putBack = (
  session: LocalSession,
  reason: string,
  blocks: ReadonlyArray<string>,
): PreparedDelivery => ({
  plugin: "core",
  first: false,
  text: reason,
  notify: async (state) => {
    if (state === "dropped") session.pending.push(...blocks);
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
  const blocks = await this.landingMessages(step, ctx, budgetMs);
  if (blocks.length === 0) return null;
  const { text: reason, carried } = stopReason(landingKind(command) ?? "step", blocks);
  this.record("landing.stopped", {
    session: session.id,
    messages: blocks.length,
    chars: reason.length,
  });
  session.pending.push(...blocks.slice(carried));
  step.deliveries?.push(putBack(session, reason, blocks.slice(0, carried)));
  return (
    editHookAnswer(session.agent, [{ ...noContest(), decision: "deny", reason }])?.output ?? null
  );
}
