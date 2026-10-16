/**
 * What an agent hears of its overlaps: what happened on them since it last heard (an overlap it was
 * not told about, notes others wrote), how its agents settle one and which of them closes it, and
 * what `peer status` prints.
 *
 * @module peerHub/core/coordination/news
 */
import { neutral } from "../../peerText.ts";
import type { HubCoordSession, HubOverlap } from "../hub/coordApi.ts";
import { type BoardEntry, boardLine, type CommandsOn, EVERY_COMMAND } from "../index/text.ts";
import {
  announcementKey,
  claimedTask,
  type CoordinationView,
  describe,
  type NameOf,
  overlapSubject,
  type SessionMemory,
  shortId,
  type TaskNamer,
  whereFrom,
} from "./edits.ts";

/**
 * The notes of an overlap that the session `me` did not write and was not shown yet: what an
 * ordinary step tells it, and what a landing step waits for (`broker/landing.ts`).
 */
export function unseenNotes(overlap: HubOverlap, me: string, memory: SessionMemory) {
  return overlap.notes.filter((note) => note.session !== me && !memory.seenNotes.has(note.id));
}

/**
 * What happened on this session's overlaps since it last heard: overlaps it
 * was not told about and notes others wrote. One short block, or null.
 */
export function newsFor(input: {
  readonly me: HubCoordSession;
  readonly view: CoordinationView;
  readonly memory: SessionMemory;
  readonly nameOf: NameOf;
  readonly taskName?: TaskNamer;
  /** The agent session that closes an overlap once its agents agree (`closerOf`). */
  readonly closer?: (overlap: HubOverlap) => string | undefined;
  /**
   * What would wake an idle agent: an overlap closed since it last heard is
   * not, it hears the agreement at its next step.
   */
  readonly waking?: boolean;
  readonly cli: string;
}): { readonly text: string; readonly announced: string[]; readonly seen: string[] } | null {
  const { me, view, memory, nameOf } = input;
  const taskName = input.taskName ?? ((task: string) => task);
  const blocks: string[] = [];
  const announced: string[] = [];
  const seen: string[] = [];
  let askedMe = false;
  // Whether this agent closes every overlap it hears of now, or another agent closes one.
  let closesAll = true;
  for (const overlap of view.overlaps) {
    if (!overlap.sessions.includes(me.id)) continue;
    const otherId = overlap.sessions.find((id) => id !== me.id);
    const other = view.sessions.find((session) => session.id === otherId);
    const fresh = overlap.state === "open" && !memory.announced.has(announcementKey(overlap));
    const notes = unseenNotes(overlap, me.id, memory);
    if (!fresh && notes.length === 0) continue;
    if (
      input.waking === true &&
      overlap.state === "resolved" &&
      notes.every((note) => note.text.startsWith("Resolved:"))
    ) {
      continue;
    }
    if (fresh) announced.push(announcementKey(overlap));
    seen.push(...notes.map((note) => note.id));
    const closer = input.closer?.(overlap);
    if (closer !== undefined && closer !== me.id) closesAll = false;
    const who =
      other === undefined
        ? "another agent"
        : fresh
          ? `${describe(other, nameOf, taskName)}, working ${whereFrom(me, other)},`
          : describe(other, nameOf, taskName);
    const said = notes.map((note) => {
      const author =
        note.session === undefined
          ? `${nameOf(note.email)} (person)`
          : `${nameOf(note.email)}'s agent`;
      return `${author}: "${neutral(note.text)}"`;
    });
    const tail = said.length === 0 ? "." : ` — ${said.join(" ")}`;
    const asked = overlap.files.flatMap((path) => {
      const task = claimedTask(path);
      return task === undefined ? [] : [task];
    });
    const files = overlap.files.filter((path) => claimedTask(path) === undefined);
    if (files.length === 0 && asked.length > 0) {
      // A question about a task, not a file both change: who asks the agents on which task.
      const about = asked.map(taskName).join(", ");
      const ofMe = me.task !== undefined && asked.includes(me.task);
      askedMe ||= ofMe && notes.length > 0;
      blocks.push(
        ofMe
          ? `Overlap ${shortId(overlap.id)}: ${who} asks the agents on your task ${about}${tail}`
          : `Overlap ${shortId(overlap.id)}: your question about ${about}, to ${who}${tail}`,
      );
      continue;
    }
    // Whether they changed the shared files already or only said they are about to.
    const changed = other?.files.some((file) => files.includes(file)) ?? false;
    const state = fresh
      ? files.every((file) => file.startsWith("resource:") || file.startsWith("pattern:"))
        ? " (they hold it)"
        : changed
          ? " (they changed it too)"
          : " (they are about to change it)"
      : "";
    blocks.push(
      `Overlap ${shortId(overlap.id)} with ${who} on ${overlapSubject(overlap.files, taskName)}${state}${tail}`,
    );
  }
  if (blocks.length === 0) return null;
  // Once notes go back and forth, say how the conversation ends.
  const settle =
    seen.length === 0
      ? ""
      : closesAll
        ? ` Once you agree, close it: ${input.cli} resolve "<agreement>".`
        : " Once you agree, the other agent closes it.";
  const reply = askedMe
    ? `Answer them: ${input.cli} note "<your answer>"`
    : `Reply if it concerns your work: ${input.cli} note "<text>"`;
  return {
    text: `Peer: ${blocks.join(" ")} ${reply}; details: ${input.cli} status.${settle}`,
    announced,
    seen,
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
  /** What time it is, for how old each work's context is. */
  readonly now?: number;
  readonly cli: string;
  /** The plugins' commands it names: those of the active plugins. */
  readonly on?: CommandsOn;
}): string {
  const { me, view, nameOf } = input;
  const on = input.on ?? EVERY_COMMAND;
  const taskName = input.taskName ?? ((task: string) => task);
  const lines = [`Peer · project ${me.project} · you: ${describe(me, nameOf, taskName)}`];
  if (input.mine?.claims.length)
    lines.push(
      `You hold: ${input.mine.claims.map((path) => (claimedTask(path) === undefined ? path : `asked ${taskName(claimedTask(path)!)}`)).join(", ")}.`,
    );
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
            ...input.board.map((entry) => `- ${boardLine(entry, input.now)}`),
          ].join("\n"),
    );
  }
  const mine = view.overlaps.filter((o) => o.sessions.includes(me.id));
  for (const overlap of mine) {
    lines.push(
      `Overlap ${shortId(overlap.id)} (${overlap.state}) on ${overlapSubject(overlap.files, taskName)}${overlap.resolution === undefined ? "" : ` — agreed: ${neutral(overlap.resolution)}`}`,
    );
    for (const note of overlap.notes.slice(-5)) {
      const author =
        note.session === me.id
          ? "you"
          : note.session === undefined
            ? `${nameOf(note.email)} (person)`
            : `${nameOf(note.email)}'s agent`;
      lines.push(`  ${author}: "${neutral(note.text)}"`);
    }
  }
  const commands = [
    `${input.cli} index`,
    `${input.cli} context [<task>]`,
    ...(on("knowledge") ? [`${input.cli} knowledge [<id or words>]`] : []),
    ...(on("find") ? [`${input.cli} find "<what you will do>"`] : []),
    ...(on("ask") ? [`${input.cli} ask <task> "<question>"`] : []),
    `${input.cli} note "<text>"`,
    `${input.cli} resolve "<agreement>"`,
    `${input.cli} claim <path>... [--intent "<why>"]`,
    `${input.cli} release`,
  ];
  lines.push(`Commands: ${commands.join(" · ")}`);
  return lines.join("\n");
}

/** How a person's request to settle an overlap starts, so every Peer and agent recognizes it. */
export const SETTLE_REQUEST = "Settle this between you now:";

/**
 * The agent that closes an overlap once its agents agree, the same on every
 * computer: for a question about a task, the agent that asked (it knows when
 * it has its answer); otherwise the first of them still at work.
 */
export function closerOf(
  overlap: Pick<HubOverlap, "sessions" | "files">,
  atWork: ReadonlyArray<Pick<HubCoordSession, "id" | "task">>,
): string | undefined {
  const present = overlap.sessions.filter((id) => atWork.some((s) => s.id === id)).toSorted();
  const asked = overlap.files.flatMap((path) => {
    const task = claimedTask(path);
    return task === undefined ? [] : [task];
  });
  if (asked.length > 0 && asked.length === overlap.files.length) {
    const asker = present.find((id) => {
      const task = atWork.find((s) => s.id === id)?.task;
      return task === undefined || !asked.includes(task);
    });
    if (asker !== undefined) return asker;
  }
  return present[0];
}

/** A person's request, as a note both agents hear: settle it between you, and who closes it. */
export function settleRequest(input: {
  /** The agent that closes it, as people name it ("Ana's agent"). */
  readonly closer: string | undefined;
  readonly message?: string | undefined;
  readonly cli: string;
}): string {
  const close =
    input.closer === undefined
      ? `then close it: ${input.cli} resolve "<agreement>"`
      : `then ${input.closer} closes it: ${input.cli} resolve "<agreement>"`;
  const message = input.message?.trim() ?? "";
  return `${SETTLE_REQUEST} agree who changes what in a note each, ${close}. If the other agent does not answer, close it with what you will do.${message === "" ? "" : ` ${message}`}`;
}

/** When a person last asked the agents to settle an overlap, unless an agent wrote since. */
export function settleAskedAt(
  notes: ReadonlyArray<{
    readonly session?: string | undefined;
    readonly text: string;
    readonly at: string;
  }>,
): string | undefined {
  const asked = notes.findLastIndex(
    (note) => note.session === undefined && note.text.startsWith(SETTLE_REQUEST),
  );
  if (asked < 0) return undefined;
  return notes.slice(asked + 1).some((note) => note.session !== undefined)
    ? undefined
    : notes[asked]?.at;
}

/**
 * What the agent that closes an overlap hears once both agents wrote and the
 * notes went quiet: close it if you agree, or say what is left.
 */
export function settleNudge(input: {
  readonly overlap: HubOverlap;
  readonly other: string;
  readonly minutes: number;
  readonly taskName: TaskNamer;
  readonly cli: string;
}): string {
  return `Peer: overlap ${shortId(input.overlap.id)} with ${input.other} on ${overlapSubject(input.overlap.files, input.taskName)} has been quiet for ${input.minutes} min since you both wrote. If you agree, close it now: ${input.cli} resolve "<agreement>". If not, write what is still open: ${input.cli} note "<text>".`;
}
