/**
 * What an agent hears of its overlaps: that one exists, once, at its next step, and what
 * `peer status` prints. An overlap is a fact Peer reports and a line in the room; nothing waits on
 * it.
 *
 * @module peerHub/core/coordination/news
 */
import type { HubCoordSession } from "../hub/coordApi.ts";
import { type BoardEntry, boardLine, type CommandsOn, EVERY_COMMAND } from "../index/text.ts";
import {
  announcementKey,
  type CoordinationView,
  describe,
  type NameOf,
  type SessionMemory,
  shortId,
  type TaskNamer,
  whereFrom,
} from "./edits.ts";

/**
 * The overlaps of this session it was not told about, or that files joined since: one short block,
 * or null.
 */
export function newsFor(input: {
  readonly me: HubCoordSession;
  readonly view: CoordinationView;
  readonly memory: SessionMemory;
  readonly nameOf: NameOf;
  readonly taskName?: TaskNamer;
  readonly cli: string;
  /** The plugins' commands it names: those of the active plugins. */
  readonly on?: CommandsOn;
}): { readonly text: string; readonly announced: string[] } | null {
  const { me, view, memory, nameOf } = input;
  const taskName = input.taskName ?? ((task: string) => task);
  const blocks: string[] = [];
  const announced: string[] = [];
  for (const overlap of view.overlaps) {
    if (!overlap.sessions.includes(me.id)) continue;
    if (memory.announced.has(announcementKey(overlap))) continue;
    announced.push(announcementKey(overlap));
    const other = view.sessions.find(
      (session) => session.id !== me.id && overlap.sessions.includes(session.id),
    );
    const who =
      other === undefined
        ? "another agent"
        : `${describe(other, nameOf, taskName)}, working ${whereFrom(me, other)},`;
    // Whether they changed the shared files already or only said they are about to.
    const changed = other?.files.some((file) => overlap.files.includes(file)) ?? false;
    const state = changed ? "they changed it too" : "they are about to change it";
    blocks.push(`Overlap with ${who} on ${overlap.files.join(", ")} (${state}).`);
  }
  if (blocks.length === 0) return null;
  const reply =
    (input.on ?? EVERY_COMMAND)("note") === true
      ? ` Tell them if it concerns your work: ${input.cli} note "<text>".`
      : "";
  return {
    text: `Peer: ${blocks.join(" ")}${reply} Details: ${input.cli} status.`,
    announced,
  };
}

/** What `peer status` prints: who works on what in the project, and this session's overlaps. */
export function statusText(input: {
  readonly mine?: {
    readonly claims: ReadonlyArray<string>;
    readonly task?: { readonly name: string; readonly status: string };
  };
  readonly me: HubCoordSession;
  readonly view: CoordinationView;
  readonly nameOf: NameOf;
  readonly taskName?: TaskNamer;
  /** The project's other works; without it, the other agents are listed as they are. */
  readonly board?: ReadonlyArray<BoardEntry>;
  readonly cli: string;
  /** The plugins' commands it names: those of the active plugins. */
  readonly on?: CommandsOn;
  /** Why this checkout's version control cannot be used, when it cannot (a jj too old). */
  readonly unsupported?: string | undefined;
}): string {
  const { me, view, nameOf } = input;
  const on = input.on ?? EVERY_COMMAND;
  const taskName = input.taskName ?? ((task: string) => task);
  const lines = [`Peer · project ${me.project} · you: ${describe(me, nameOf, taskName)}`];
  if (input.unsupported !== undefined)
    lines.push(`This checkout is unsupported: ${input.unsupported}`);
  if (input.mine?.claims.length) lines.push(`You hold: ${input.mine.claims.join(", ")}.`);
  if (input.mine?.task)
    lines.push(`Your task ${input.mine.task.name} is ${input.mine.task.status}.`);
  const others = view.sessions.filter((s) => s.project === me.project && s.id !== me.id);
  const line = (s: HubCoordSession) =>
    `${describe(s, nameOf, taskName)} — ${s.status}, ${s.files.length} file(s) changed`;
  if (input.board === undefined) {
    lines.push(
      others.length === 0
        ? "No other agents at work on this project."
        : `Also at work: ${others.map(line).join("; ")}`,
    );
  } else {
    const mine = others.filter((s) => s.task === me.task);
    const work = me.task === undefined ? "the work outside tasks" : "your task";
    lines.push(
      mine.length === 0
        ? `No other agent on ${work}.`
        : `Also on ${work}: ${mine.map(line).join("; ")}`,
    );
    lines.push(
      input.board.length === 0
        ? "No other work on this project now."
        : [
            "Other work on this project:",
            ...input.board.map((entry) => `- ${boardLine(entry)}`),
          ].join("\n"),
    );
  }
  for (const overlap of view.overlaps.filter((o) => o.sessions.includes(me.id))) {
    lines.push(`Overlap ${shortId(overlap.id)} on ${overlap.files.join(", ")}`);
  }
  const commands = [
    `${input.cli} index`,
    ...(on("ask") ? [`${input.cli} ask <task> "<question>"`] : []),
    ...(on("note") ? [`${input.cli} note "<text>"`] : []),
    `${input.cli} claim <path>... [--intent "<why>"]`,
    `${input.cli} release`,
  ];
  lines.push(`Commands: ${commands.join(" · ")}`);
  return lines.join("\n");
}

/** What Peer's command does, said when a session starts. */
function commandsText(cli: string, path: string | undefined, tools: boolean): string {
  return tools
    ? "Peer knows this session, its project and task. Use your peer_* tools; peer <command> below means peer_<command>. Before changing files, call peer_claim: it says who else is on them and stops nothing. `peer_status` shows who works on what."
    : `Peer knows this session, its project and task: run \`${cli}\`${path === undefined ? "" : ` (${path})`} as is, with no names or IDs, and never ask your person for Peer commands. \`${cli} status\` shows who works on what, \`${cli} claim <path>\` says what you are about to touch, and \`${cli}\` lists all commands.`;
}

/** What a session hears from core when it starts, resumes or comes back from a compaction. */
export function startText(input: {
  /** Who the agent is, e.g. "Ana's agent": it keeps its own lines apart from its teammates'. */
  readonly me?: string;
  /** Where Peer's command is, for an agent whose shell does not find it by name (Codex). */
  readonly cliPath?: string;
  readonly tools?: boolean;
  /** What the active plugins say of their commands: the room's line. */
  readonly startLines?: ReadonlyArray<string>;
  /** Who else is at work on the project (`indexText`). */
  readonly index?: string | null;
}): string {
  return [
    ...(input.me === undefined ? [] : [`You are ${input.me} here.`]),
    commandsText("peer", input.cliPath, input.tools === true),
    ...(input.startLines ?? []),
    ...(input.index ? [input.index] : []),
  ].join("\n\n");
}
