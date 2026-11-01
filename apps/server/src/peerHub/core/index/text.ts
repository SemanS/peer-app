/**
 * Who works on what in a project, as an agent reads it: at its start, in `peer status` and in
 * `peer index`. Peer keeps the state of everyone's work and shows it; it does not rank the work
 * against what the agent does, and what the agent wants more of, it asks in the room.
 *
 * @module peerHub/core/index/text
 */
import { plain } from "../../peerText.ts";

/** Another work on the project, as an agent hears of it: a task, or the work outside tasks. */
export interface BoardEntry {
  /** `task:<id>`, or `project` for the work outside tasks. */
  readonly scope: string;
  /** What agents type in `peer ask`: the task's key, else its id. */
  readonly handle: string;
  /** How people name it, e.g. `VL1 · Speakers can be named`. */
  readonly name: string;
  /** The agents at work on it, described with what they do now. */
  readonly agents: ReadonlyArray<string>;
  /** What its agents say they do. */
  readonly activity?: string | undefined;
  readonly files?: ReadonlyArray<string> | undefined;
}

/** One work on the board, in a line; `lean` leaves out what its agents do and touch. */
export function boardLine(entry: BoardEntry, options: { readonly lean?: boolean } = {}): string {
  const named = entry.name.toLowerCase().includes(entry.handle.toLowerCase())
    ? entry.name
    : `${entry.name} (${entry.handle})`;
  const who = entry.agents.length === 0 ? "nobody at work on it now" : entry.agents.join("; ");
  const lean = options.lean === true;
  const activity = lean || !entry.activity ? "" : ` · doing: ${plain(entry.activity, 120)}`;
  const files =
    lean || !entry.files?.length
      ? ""
      : ` · files: ${plain(entry.files.slice(0, 3).join(", "), 120)}`;
  return `${named} — ${who}${activity}${files}`;
}

/**
 * Whether an agent may run a plugin's `peer` command now (`ask`): Peer's own texts name a plugin's
 * command only while its plugin is active.
 */
export type CommandsOn = (command: string) => boolean;

/** Every plugin's command: Peer's texts as they read while all its plugins are active. */
export const EVERY_COMMAND: CommandsOn = () => true;

/** How many works a start names, and how many a page of `peer index` lists. */
export const INDEX_SHOWN = 10;
export const INDEX_ALL = 30;

/**
 * The project's other works as an agent gets them: at a start a table of contents (`shown`, lean),
 * or a page of `peer index` (`full`). Null when there are none.
 */
export function indexText(input: {
  readonly works: ReadonlyArray<BoardEntry>;
  readonly cli: string;
  readonly shown?: number;
  readonly full?: boolean;
}): string | null {
  const { works, cli } = input;
  if (works.length === 0) return null;
  const shown = input.shown ?? INDEX_SHOWN;
  const full = input.full === true;
  return [
    full
      ? "Who works on what on this project now:"
      : `Also on this project now (\`${cli} index\` lists all):`,
    ...works.slice(0, shown).map((entry) => `- ${boardLine(entry, { lean: !full })}`),
    ...(works.length > shown
      ? [`(${works.length - shown} more: \`${cli} index\` lists them)`]
      : []),
  ].join("\n");
}
