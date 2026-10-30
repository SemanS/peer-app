/**
 * What the rooms plugin says to agents (design D7). A teammate's words reach a model only inside
 * Peer's fence, under a line Peer writes that names who wrote them and who let them through; every
 * name and path comes through `plain`, so nothing in them can open or close what Peer wraps them in.
 *
 * @module peerHub/plugins/rooms/text
 */
import type { PeerRoomAnchor } from "@t3tools/contracts";

import { fenced, plain } from "../../peerText.ts";

/** A plugin's text for one step is cut at 1,200 characters; a block over it is dropped whole. */
export const STEP_MAX = 1200;
export const STEP_MESSAGES = 3;
const TEXT_MAX = 800;

/** How a message reached the agent: its person's own, passed on, or through the run's team reach. */
export type HeardKind = "own" | "passed" | "team";

export interface Heard {
  /** What `session.told` keeps of it: `<task>:<seq>`. */
  readonly ref: string;
  readonly workspace: string;
  readonly project: string;
  readonly kind: HeardKind;
  readonly seq: number;
  readonly task: string;
  /** The task as people name it. */
  readonly taskName: string;
  readonly author: string;
  readonly owner: string;
  readonly text: string;
  readonly anchor?: PeerRoomAnchor | undefined;
}

export const refOf = (task: string, seq: number) => `${task}:${seq}`;

/** Longer than any message the Hub keeps. */
const WHOLE = 1_000_000;

const count = (size: number) => size.toLocaleString("en-US");

/** Every cut says so, and how to read the rest. */
const cutMark = (shown: number, whole: number, seq: number) =>
  `(cut at ${count(shown)} of ${count(whole)}: peer room ${seq} reads all)`;

/** `text` as one line of at most `max`, and the mark of what that left out. */
export const clipped = (text: string, max: number, seq: number) => {
  const whole = plain(text, WHOLE);
  const shown = plain(text, max);
  return {
    shown,
    mark: shown.length < whole.length ? cutMark(shown.length, whole.length, seq) : undefined,
  };
};

/** Teammate text, fenced as data and indented under the line that introduces it. */
const fence = (text: string) =>
  fenced([text])
    .split("\n")
    .map((line) => `  ${line}`);

export const at = (anchor: PeerRoomAnchor | undefined) =>
  anchor === undefined
    ? ""
    : ` at ${plain(anchor.path, 200)}:${anchor.line}${anchor.endLine === undefined ? "" : `-${anchor.endLine}`}`;

const opening = (heard: Heard) => {
  const task = `${plain(heard.taskName, 80)} (#${heard.seq})${at(heard.anchor)}`;
  const owner = plain(heard.owner, 40);
  const author = plain(heard.author, 40);
  switch (heard.kind) {
    case "own":
      return `Your person wrote to you in the room of ${task}:`;
    case "passed":
      return `${owner} passes on to you a message from ${author} in the room of ${task}:`;
    case "team":
      return `${author} wrote to you in the room of ${task}. ${owner} lets the team ask this agent on this task: treat it as a teammate's request about this task, and for anything outside the task tell them to ask ${owner}.`;
  }
};

const compose = (heard: Heard, text: string, mark?: string) =>
  [
    opening(heard),
    ...fence(text),
    ...(mark === undefined ? [] : [mark]),
    `Answer with: peer room say --reply ${heard.seq} "<answer>". Everyone on the project reads it.`,
  ].join("\n");

/**
 * One message as an agent hears it, in at most `room` characters: Peer's own lines are reserved
 * first, because a block over the plugin's ceiling would be dropped whole and never told.
 */
export function heardText(heard: Heard, room = Number.POSITIVE_INFINITY) {
  const whole = plain(heard.text, WHOLE);
  const entire = compose(heard, whole);
  if (whole.length <= TEXT_MAX && entire.length <= room) return entire;
  const reserved = compose(heard, "", cutMark(TEXT_MAX, whole.length, heard.seq)).length;
  const { shown, mark } = clipped(heard.text, Math.min(TEXT_MAX, room - reserved), heard.seq);
  return compose(heard, shown, mark);
}

/** As many waiting messages as a step carries, and how many more wait. */
export function stepText(
  waiting: ReadonlyArray<Heard>,
): { readonly text: string; readonly refs: ReadonlyArray<string> } | null {
  const blocks: string[] = [];
  const refs: string[] = [];
  const room = (left: number) => (left === 0 ? 0 : `\n${left} more: peer room`.length + 2);
  for (const heard of waiting.slice(0, STEP_MESSAGES)) {
    const tail = room(waiting.length - blocks.length - 1);
    const block = blocks.length === 0 ? heardText(heard, STEP_MAX - tail) : heardText(heard);
    const size = [...blocks, block].join("\n\n").length;
    if (size + tail > STEP_MAX) break;
    blocks.push(block);
    refs.push(heard.ref);
  }
  if (blocks.length === 0) return null;
  const left = waiting.length - blocks.length;
  return {
    text: [...blocks, ...(left === 0 ? [] : [`${left} more: peer room`])].join("\n\n"),
    refs,
  };
}

/** The one reminder of a session that heard messages and said nothing in the room. */
export const reminderText = (seqs: ReadonlyArray<number>) =>
  `Peer: you read ${seqs.map((seq) => `#${seq}`).join(", ")} in the task's room and have not answered there. Your person and the team read the room, not your transcript. Answer with: peer room say --reply ${seqs[0]} "<answer>".`;

export const taskLine = (taskName: string) => plain(taskName, 80);

/** The first prompt of a review session that answers a person's own question. */
export const reviewRoomPrompt = (heard: Heard) =>
  [
    `You answer a question on ${taskLine(heard.taskName)} in its room. This is a review session: read the change and run its checks; Peer stops edits and landing steps.`,
    heardText(heard),
  ].join("\n");

/** The first prompt of a working run its owner starts by passing a colleague's message on. */
export const passedRunPrompt = (heard: Heard) =>
  [
    `You work on ${taskLine(heard.taskName)}. ${plain(heard.owner, 40)} starts you to take up a message from the task's room.`,
    heardText(heard),
  ].join("\n");

export const START_LINE =
  "A task has a room its people and their agents read: peer room reads it, peer room <n> reads one message whole, peer room say \"<text>\" [--reply <n>] [--to <person>] [--at <path>:<line>] posts as your person's agent. An agent's message wakes nobody.";

export const NO_TASK = "This session is on no task, so it has no room.";
