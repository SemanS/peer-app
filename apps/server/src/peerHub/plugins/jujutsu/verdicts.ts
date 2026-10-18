/**
 * The way around protection (`--ignore-immutable`) is stopped before jj runs, from the command's
 * words and what Peer last knew of whose changes are whose, from memory: the budget a verdict has
 * never changes its outcome, since the fallback is the same function. It is a deny, never an ask: an
 * ask would prompt the agent's own person, who is not the change's owner. Only the hook of an agent
 * session reaches it, so a person's terminal is never stopped.
 *
 * @module peerHub/plugins/jujutsu/verdicts
 */
import {
  jjInvocations,
  type JjInvocation,
  type PeerToolContext,
  type PeerVerdict,
} from "../../core/plugin.ts";
import { stopGeneral, stopNamed, type Owner } from "./text.ts";

/** Another session's change in flight: its ids and bookmark, and whose and for which task. */
export interface Other {
  readonly ids: ReadonlyArray<string>;
  readonly bookmark?: string | undefined;
  readonly owner: Owner;
}

/** A change of another session that a command's words name. */
export interface Named {
  /** What to tell once per change: the id, or `bookmark:<name>`. */
  readonly key: string;
  /** The word the command used. */
  readonly word: string;
  readonly owner: Owner;
}

/** A change id is letters `k` to `z`; a shorter prefix names too many changes. */
const ID_PREFIX = /^[k-z]{4,}$/;

/** The words of a jj command that could name a revision, past quoting and revset operators. */
const wordsOf = (run: JjInvocation) =>
  [...run.subcommand, ...run.args]
    .flatMap((word) => word.split(/[\s'"()|&~:,]+|\.\./))
    .map((word) => word.replace(/[-+]+$/, ""))
    .filter((word) => word !== "");

/** Which of `others` the jj commands among `runs` name, each change once, in the order named. */
export function named(
  runs: ReadonlyArray<JjInvocation>,
  others: ReadonlyArray<Other>,
): ReadonlyArray<Named> {
  const found = new Map<string, Named>();
  for (const word of runs.flatMap(wordsOf))
    for (const other of others) {
      const id = ID_PREFIX.test(word) ? other.ids.find((id) => id.startsWith(word)) : undefined;
      const key = id ?? (other.bookmark === word ? `bookmark:${word}` : undefined);
      if (key !== undefined && !found.has(key)) found.set(key, { key, word, owner: other.owner });
    }
  return [...found.values()];
}

/** What a session's hook knows of its checkout, kept in `session.local`. */
export interface Place {
  /** A colocated jj checkout this plugin works in. */
  jj: boolean;
  others: ReadonlyArray<Other>;
}

/**
 * The stop for a shell command, or null: a jj command carrying `--ignore-immutable` among jj's global
 * options, in a jj checkout with protection on. The first change of another session that its words
 * name is named; with none named the general text says what the flag could rewrite.
 */
export function judge(ctx: PeerToolContext, place: Place, protection: boolean): PeerVerdict | null {
  if (!protection || !place.jj || ctx.command === undefined) return null;
  const runs = jjInvocations(ctx.command).filter((run) =>
    run.globals.some((option) => option.name === "--ignore-immutable"),
  );
  if (runs.length === 0) return null;
  const [first] = named(runs, place.others);
  return {
    decision: "deny",
    reason: first === undefined ? stopGeneral() : stopNamed(first.word, first.owner),
  };
}
