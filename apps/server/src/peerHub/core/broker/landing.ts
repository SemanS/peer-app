/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Nothing lands unread (G8). Before a session's work lands, Peer gives it every message addressed to
 * it that it has not read: the notes teammates wrote in its overlaps (their questions, answers, and
 * a person's request to settle one) and the notices plugins flag `landing` (a decision on a request
 * it made). Work lands when a `git commit`, `git push`, `gh pr create` or `gh pr merge` runs in the
 * agent's shell (`isLanding`), or when it runs `peer review` or `peer done` (the commands check for
 * themselves). Peer stops the step once to give the messages; the same step again runs, unless
 * something new came meanwhile. Advice (impact, forecast, plans, dependencies, announcements,
 * knowledge) never stops a step: it reaches the agent as at any other, and a plugin's notice that is
 * not flagged is advice.
 *
 * What is a landing step goes by the words of the command only, never by its output or a model: a
 * command hidden in a script or an alias is not recognized.
 *
 * @module peerHub/core/broker/landing
 */
import { gitCommands } from "../../handoffCommands.ts";
import { plain } from "../../peerText.ts";
import {
  type CoordinationView,
  type NameOf,
  overlapSubject,
  type TaskNamer,
} from "../coordination/edits.ts";
import { unseenNotes } from "../coordination/news.ts";
import type { HubOverlap } from "../hub/coordApi.ts";
import type { PeerToolContext } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { type PipelineStep, stepNotices } from "./pipeline.ts";
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
