// @effect-diagnostics globalDate:off - the time a view was read is told in the reader's local clock.
/**
 * What this plugin says to agents, in one place: `peer changes`, the project's changes in flight as
 * an index (at most 1,500 characters), and the session's start line (at most 200). What teammates
 * wrote (subjects, task keys, names) is cleaned of what a reader cannot see and of tags that could
 * pose as Peer's or the harness's (`peerText.ts`). The index is columns of facts with the commands
 * to read more; it carries no forecast result.
 *
 * @module peerHub/plugins/changes/text
 */
import type { ChangeRow } from "@t3tools/contracts";

import { cut, plain, plural } from "../../peerText.ts";

export const INDEX_MAX = 1_500;
export const START_MAX = 200;
const SHORT = 8;

/** How people and agents are named where a change is read. */
export interface Voice {
  readonly person: (email: string) => string;
}

const AGENTS: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex" };
export const agentName = (agent: string) => AGENTS[agent] ?? plain(agent, 30);

const KEYED = /^([A-Za-z][A-Za-z0-9]*-\d+)[:\s]\s*(.*)$/;

/** The task key of a change: its session's task, else the key its subject starts with. */
export const keyOf = (row: ChangeRow): string | undefined => {
  const task = row.task ?? row.sessions.find((s) => s.working && s.task)?.task ?? undefined;
  return plain(task ?? KEYED.exec(row.subject)?.[1] ?? "", 30) || undefined;
};

/** The subject without its task key, first letter up. */
export const titleOf = (row: ChangeRow): string => {
  const match = KEYED.exec(row.subject);
  const title = plain(match?.[2] ? match[2] : row.subject, 60);
  return title.charAt(0).toUpperCase() + title.slice(1);
};

export const shortId = (changeId: string) => changeId.slice(0, SHORT);

const whoOf = (row: ChangeRow, voice: Voice) =>
  `${plain(voice.person(row.author.email), 40)} · ${agentName(row.author.agent)}`;

/** One change as the rows of the index and the start line name it: its task key, else its id. */
const labelOf = (row: ChangeRow) => keyOf(row) ?? shortId(row.changeId);

export interface IndexRow {
  readonly row: ChangeRow;
  /** It is the reading session's own change. */
  readonly mine: boolean;
  /** A change of another session that the reading session's work sits on. */
  readonly buildsOn: ChangeRow | undefined;
}

const clock = (at: number) => {
  const date = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
};

const files = (row: ChangeRow) =>
  row.paths.length >= 50 ? "50+ files" : plural(row.paths.length, "file");

/** What `peer changes` prints: the rows in columns, yours first, then how to read more. */
export function indexText(input: {
  readonly project: string;
  readonly rows: ReadonlyArray<IndexRow>;
  readonly readAt: number;
  readonly voice: Voice;
}): string {
  const { rows, voice } = input;
  const head = `${plain(input.project, 80)} · ${rows.length === 0 ? "no changes" : plural(rows.length, "change")} in flight · checked ${clock(input.readAt)}`;
  if (rows.length === 0) return head;
  const foot =
    'Read one: jj show <id> · what moved under you: peer follow · ask: peer ask <task> "…"';
  const ordered = [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
  const cells = ordered.map(({ row, mine, buildsOn }) => [
    shortId(row.changeId),
    keyOf(row) ?? "-",
    titleOf(row),
    `${whoOf(row, voice)}${mine ? " (you)" : ""}`,
    files(row),
    mine
      ? buildsOn === undefined
        ? "yours"
        : `builds on ${shortId(buildsOn.changeId)}`
      : "read-only to you",
  ]);
  const widths = [0, 1, 2, 3, 4].map((at) => Math.max(...cells.map((c) => c[at]!.length)) + 2);
  const line = (c: ReadonlyArray<string>) =>
    c.map((cell, at) => (at < 5 ? cell.padEnd(widths[at]!) : cell)).join("");
  const lines = cells.map(line);
  // Rows that do not fit are counted instead, after the ones that do.
  const room = (shown: number) => {
    const rest = lines.length - shown;
    return [
      head,
      "",
      ...lines.slice(0, shown),
      ...(rest > 0 ? [`+ ${plural(rest, "more change")}: jj log shows them all.`] : []),
      "",
      foot,
    ].join("\n");
  };
  let shown = lines.length;
  while (shown > 1 && room(shown).length > INDEX_MAX) shown -= 1;
  return room(shown);
}

/**
 * The one line about the project's changes in a session's start text: what its work builds on, read
 * only to it, then what else is in flight. Null when nothing is.
 */
export function startLine(input: {
  readonly buildsOn: ReadonlyArray<ChangeRow>;
  readonly others: ReadonlyArray<ChangeRow>;
  readonly voice: Voice;
}): string | null {
  const { buildsOn, others, voice } = input;
  if (buildsOn.length === 0 && others.length === 0) return null;
  const parts: string[] = [];
  const first = buildsOn[0];
  if (first !== undefined) {
    parts.push(
      `you build on ${labelOf(first)} (${shortId(first.changeId)}, ${whoOf(first, voice)}), read-only to you.`,
    );
  }
  if (others.length > 0) {
    const names = others.slice(0, 3).map(labelOf);
    const more = others.length > 3 ? `, +${others.length - 3}` : "";
    parts.push(
      `${first === undefined ? "Changes in flight" : "Also in flight"}: ${names.join(", ")}${more}.`,
    );
  }
  parts.push("peer changes lists them.");
  return cut(`jj: ${parts.join(" ")}`, START_MAX);
}
