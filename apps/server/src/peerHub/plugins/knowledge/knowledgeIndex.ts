/**
 * knowledgeIndex — what a project's reviewed knowledge says it is, for the agents that work there.
 *
 * A project keeps what its people reviewed and committed (kontext, `.ai/` in its repository):
 * decisions, conventions, learnings, incidents, each with the paths it governs. An agent that does
 * not think of looking works against a decision it never saw, so Peer puts a small index of them
 * in the agent's context and lets the agent choose what it needs (`peer knowledge`). Peer does not
 * rank them against what the agent does: choosing is the model's work. The one thing it decides
 * itself is a fact, not a guess: an entry whose `paths` name a file the agent is about to change
 * says so, once, as a lock on a file says who has it.
 *
 * @module peerHub/plugins/knowledge/knowledgeIndex
 */
import { type KnowledgeEntry } from "../../knowledgeEntry.ts";
import { plain, plural } from "../../peerText.ts";

export type { KnowledgeEntry };

export interface Known {
  readonly entry: KnowledgeEntry;
}
export const known = (entry: KnowledgeEntry): Known => ({ entry });
export interface Governing {
  readonly entry: KnowledgeEntry;
  readonly pattern: string;
  readonly path: string;
}

const code = (text: string) => `\`${text}\``;

/** `decision (accepted, 2026-10-04)`: what kind it is and where it stands. */
function kindText(entry: KnowledgeEntry): string {
  const state = [entry.status, entry.publication?.state, entry.date]
    .filter((part) => part !== undefined)
    .join(", ");
  return `${entry.kind}${state === "" ? "" : ` (${state})`}`;
}

/** How many entries of a kind Peer names at once when a file is governed. */
const GOVERNING_SHOWN = 3;

/** What to say when the files an agent changes are governed by entries: which, and how to read them. */
export function governingText(found: ReadonlyArray<Governing>, cli: string): string | null {
  if (found.length === 0) return null;
  const shown = found.slice(0, GOVERNING_SHOWN);
  return [
    `Peer · the project's knowledge store has ${shown.length === 1 ? "an entry that governs" : "entries that govern"} what you change (kept there by its people; check your change against ${shown.length === 1 ? "it" : "them"}, and if ${shown.length === 1 ? "it no longer holds" : "one no longer holds"}, say so to your person):`,
    ...shown.map(({ entry, pattern, path }) => {
      const summary = entry.summary === "" ? "" : ` — ${plain(entry.summary, 240)}`;
      return `- ${kindText(entry)} "${entry.title}"${summary} It governs ${code(plain(pattern, 120))}, and you change ${code(plain(path, 160))}. Read it: ${cli} knowledge ${entry.id}`;
    }),
  ].join("\n");
}

/** One entry in the index: what it is, what it governs, and the id that reads it. */
export function knowledgeLine(entry: KnowledgeEntry): string {
  const paths =
    entry.paths.length === 0
      ? ""
      : ` · governs ${entry.paths
          .slice(0, 3)
          .map((path) => plain(path, 80))
          .join(", ")}${entry.paths.length > 3 ? ", …" : ""}`;
  return `${kindText(entry)} ${entry.title}${paths} · ${entry.id}`;
}

/**
 * One entry as a start names it: what it is and what it says, and the files it governs; what the
 * agent reads on request (its id, its date, its summary) stays out. `peer knowledge <words>` finds
 * it by the words of its title.
 */
export function knowledgeTitleLine(entry: KnowledgeEntry): string {
  const proposed =
    entry.status === "proposed"
      ? " (proposed)"
      : entry.publication?.state !== undefined &&
          entry.publication.state !== "committed" &&
          entry.publication.state !== "reviewed_ref"
        ? ` (${plain(entry.publication.state, 40)})`
        : "";
  const paths =
    entry.paths.length === 0
      ? ""
      : ` · governs ${entry.paths
          .slice(0, 2)
          .map((path) => plain(path, 60))
          .join(", ")}${entry.paths.length > 2 ? ", …" : ""}`;
  return `${entry.kind}${proposed}: ${entry.title}${paths}`;
}

/**
 * A project's local convention on what to mark `[project]`; the label does not assert Git review.
 */
export function projectGuidanceText(guidance: string): string {
  return `This project's local guidance on what to mark [project]:\n${guidance.trim()}`;
}

/** The entries that stand, newest first. */
export function standing(book: ReadonlyArray<Known>): KnowledgeEntry[] {
  return book
    .map(({ entry }) => entry)
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

/**
 * The index of a project's knowledge, newest first. A start names the entries by title (`titles`):
 * what is cheap to name and costs a command to read. `peer knowledge` lists them whole.
 */
export function knowledgeIndexText(
  book: ReadonlyArray<Known>,
  options: { readonly cli: string; readonly shown: number; readonly titles?: boolean },
): string | null {
  const entries = standing(book);
  if (entries.length === 0) return null;
  const { cli, shown } = options;
  const titles = options.titles === true;
  return [
    titles
      ? `Project knowledge, kept by its people (${plural(entries.length, "entry", "entries")}; \`${cli} knowledge <words>\` reads or searches them):`
      : `Project knowledge, kept by its people (${plural(entries.length, "entry", "entries")}; \`${cli} knowledge <id>\` reads one, \`${cli} knowledge <words>\` searches them):`,
    ...entries
      .slice(0, shown)
      .map((entry) => `- ${titles ? knowledgeTitleLine(entry) : knowledgeLine(entry)}`),
    ...(entries.length > shown
      ? [`(${entries.length - shown} more: \`${cli} knowledge <words>\` finds them)`]
      : []),
  ].join("\n");
}

/** An entry as `peer knowledge <id>` prints it. */
export function entryText(entry: KnowledgeEntry): string {
  return [
    `${kindText(entry)} · ${entry.title}`,
    `id ${entry.id} · ${entry.file}${entry.paths.length === 0 ? "" : ` · governs ${entry.paths.join(", ")}`}`,
    ...(entry.summary === "" ? [] : ["", entry.summary]),
    ...(entry.body === "" ? [] : ["", entry.body]),
  ].join("\n");
}
