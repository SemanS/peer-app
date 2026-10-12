import type {
  PeerPlan,
  PeerPlanItem,
  PeerPlanMode,
  PeerPlanRelation,
  PeerPlanSide,
} from "@t3tools/contracts";
import { cutText, fenced, plain, plural, sinceText } from "../../peerText.ts";
import type { Items } from "./client/hub.ts";
import { orient, type Kind, type Reader } from "./client/relations.ts";
import { notesLines, type Notes } from "./client/resolve.ts";

/** An answer to `peer plan` takes at most this many characters; the rest is counted and read with `peer plan`. */
export const ANSWER_MAX = 1500;
const SHOW_MAX = 3000;

/** How `peer plan` is written, starting `indent` columns in: what a usage error and an empty plan show. */
export const form = (indent: number) =>
  [
    "peer plan [--amend] [--change <item>]... [--maybe <item>]... [--uses <item>]...",
    `${" ".repeat(indent + 10)}[--provides "<symbol> (<path>): <contract>"]...`,
    `${" ".repeat(indent)}peer plan --withdraw`,
    `${" ".repeat(indent + 2)}<item> = <path> | <dir>/ | <path>#<symbol>`,
  ].join("\n");

/** How a person and a task are named where an answer is read, and when it is. */
export interface Voice {
  readonly reader: Reader;
  readonly person: (email: string) => string;
  /** A task's key (`ORD-11`), when Peer knows the task. */
  readonly task: (id: string | undefined) => string | undefined;
  readonly now: number;
}

/** What a relation meets at (`applyTax (src/tax.ts)`, or the path alone), and an item as `peer plan` takes it. */
export const what = (item: PeerPlanItem) =>
  item.name === undefined
    ? plain(item.path, 160)
    : `${plain(item.name, 100)} (${plain(item.path, 100)})`;
const itemText = (item: PeerPlanItem) =>
  item.name === undefined
    ? plain(item.path, 160)
    : `${plain(item.path, 100)}#${plain(item.name, 100)}`;

/** Teammate text, fenced as data and indented under the line that introduces it. */
export const fence = (text: string) =>
  fenced([text])
    .split("\n")
    .map((line) => `  ${line}`);

/** The work on the other side: its task's key, or the label of its thread. */
export const workOf = (other: PeerPlanSide, voice: Voice) =>
  plain(voice.task(other.task) ?? other.label, 60);

/** `ORD-11 · Ana’s agent`, or `ORD-15 · Bob’s other work` when it is the reader's own person's. */
export const whoOf = (other: PeerPlanSide, voice: Voice) =>
  `${workOf(other, voice)} · ${plain(voice.person(other.email), 40)}’s ${other.email === voice.reader.email ? "other work" : "agent"}`;

export const HINTS: Readonly<Record<Kind, string>> = {
  "uses-their-change": "Build against it, or run: peer ask",
  "changes-their-use": "If its contract changes, update your contract line, or run: peer ask",
  "same-change": "Agree on who changes it, or run: peer ask",
};

/** One relation as the answer to `peer plan` lists it; its contract line is teammate text. */
export function relationLines(relation: PeerPlanRelation, voice: Voice): ReadonlyArray<string> {
  const oriented = orient(relation, voice.reader);
  if (oriented === null) return [];
  const { kind, other } = oriented;
  const marks = [relation.certain ? "" : "uncertain", relation.observed ? "observed" : ""];
  const who = whoOf(other, voice);
  const done = `${workOf(other, voice)}’s session already changed it.`;
  const doing =
    kind === "changes-their-use"
      ? "plans to use it"
      : kind === "same-change"
        ? "also plans to change it"
        : "plans to change it";
  const detail = !relation.observed
    ? `${who} ${doing}.`
    : kind === "changes-their-use"
      ? `${who} plans to use it; your session already changed it.`
      : done;
  const shown = kind === "uses-their-change" && relation.contract !== undefined;
  const ask = other.task === undefined ? null : plain(voice.task(other.task) ?? other.task, 60);
  return [
    `${kind}${marks.some(Boolean) ? ` (${marks.filter(Boolean).join(", ")})` : ""}  ${what(relation.item)}`,
    `  ${detail}${shown ? " Their contract (teammate text):" : ""}`,
    ...(shown ? fence(`${what(relation.item)}: ${plain(relation.contract ?? "", 200)}`) : []),
    ...(ask === null ? [] : [`  ${HINTS[kind]} ${ask}`]),
  ];
}

/** The line every session start carries, and the one an agent with the Peer Mod hears on leaving plan mode without a plan. */
export const START_LINE =
  'Before your first edit run peer plan --change <path[#symbol]> --uses <path#symbol> --provides "<symbol> (<path>): <contract>"; it shows whose work meets yours.';
export const PLAN_MODE_LINE =
  "[Peer] You left plan mode without a plan. Declare it before your first edit: peer plan --change <path[#symbol]> --uses <path#symbol>. It tells you whose work meets yours.";

const NOTICE_MAX = 400;
const STEP_MAX = 1_150;
const STEP_RELATIONS = 3;

/** One relation as the other side's agent hears it at its next step: at most 400 characters, its contract line fenced as teammate text. */
export function noticeText(relation: PeerPlanRelation, voice: Voice): string | null {
  const oriented = orient(relation, voice.reader);
  if (oriented === null) return null;
  const { kind, other } = oriented;
  const thing = what(relation.item);
  const who = whoOf(other, voice);
  const ask = other.task === undefined ? null : plain(voice.task(other.task) ?? other.task, 60);
  const lead =
    kind === "changes-their-use"
      ? `${who} plans to use ${thing}, which your ${relation.observed ? "session already changed" : "plan changes"}.`
      : relation.observed
        ? `${workOf(other, voice)}’s session already changed ${thing}, which your plan ${kind === "same-change" ? "also changes" : "uses"}.`
        : kind === "uses-their-change"
          ? `${who} plans to change ${thing}, which your plan uses.`
          : `${who} also plans to change ${thing}${relation.certain ? "" : " (uncertain)"}.`;
  const tail =
    kind === "changes-their-use"
      ? ` If its contract changes, update your contract line: peer plan --amend --provides "${plain(relation.item.name ?? "<symbol>", 60)} (${plain(relation.item.path, 80)}): <contract>".`
      : ask === null
        ? ""
        : ` ${HINTS[kind]} ${ask}.`;
  const contract = kind === "uses-their-change" ? relation.contract : undefined;
  // The contract line gives way before the rest does, until the notice fits.
  for (let room = 200; ; room -= 40) {
    const said =
      contract === undefined || room <= 0
        ? ""
        : ` Their contract (teammate text):\n${fenced([`${thing}: ${plain(contract, room)}`])}`;
    const text = `[Peer] ${lead}${said}${tail}`;
    if (text.length <= NOTICE_MAX || room <= 0) return cutText(text, NOTICE_MAX);
  }
}

/**
 * What a session hears of the relations it was not told of, at one step: three at most within the
 * step's room, and how many are left, which `peer plan` lists.
 */
export function stepText(fresh: ReadonlyArray<PeerPlanRelation>, voice: Voice) {
  const heard: PeerPlanRelation[] = [];
  const texts: string[] = [];
  let size = 0;
  for (const relation of fresh) {
    const text = noticeText(relation, voice);
    if (text === null || texts.length === STEP_RELATIONS || size + text.length + 2 > STEP_MAX)
      break;
    texts.push(text);
    heard.push(relation);
    size += text.length + 2;
  }
  const left = fresh.length - heard.length;
  const more = left > 0 ? [`Further plan relations: peer plan (${left} more)`] : [];
  return { heard, text: texts.length === 0 ? null : [...texts, ...more].join("\n\n") };
}

/** `1 change, 1 maybe, 1 use, 1 contract`: what a plan names, without what it does not. */
export const countsText = (items: Items) =>
  [
    plural(items.changes.length, "change"),
    plural(items.maybes.length, "maybe"),
    plural(items.uses.length, "use"),
    plural(items.provides.length, "contract"),
  ]
    .filter((count) => !count.startsWith("0 "))
    .join(", ");

/** The line `peer status` carries: the session's plan and what meets it, or the ask to declare one. */
export const statusLine = (plan: PeerPlan | undefined, relations: number) =>
  plan === undefined
    ? "Plan: none declared. Before your first edit run peer plan --change <path[#symbol]>."
    : `Plan v${plan.version}: ${countsText(plan)}; ${relations === 0 ? "no relations" : plural(relations, "relation")}. peer plan shows them.`;

/** Lines, then as many blocks as fit `max`, how many were left out and where to read them, then lines. */
function compose(
  head: ReadonlyArray<string>,
  blocks: ReadonlyArray<string>,
  tail: ReadonlyArray<string>,
  max: number,
): string {
  const shown: string[] = [];
  let size = [...head, ...tail].join("\n").length + 30;
  for (const block of blocks) {
    if (size + block.length + 1 > max) break;
    shown.push(block);
    size += block.length + 1;
  }
  const left = blocks.length - shown.length;
  const text = [
    ...head,
    ...(shown.length === 0
      ? []
      : ["", ...shown, ...(left === 0 ? [] : [`${left} more: peer plan`])]),
    ...(tail.length > 0 && shown.length > 0 ? [""] : []),
    ...tail,
  ].join("\n");
  return cutText(text, max);
}

const blocksOf = (relations: ReadonlyArray<PeerPlanRelation>, voice: Voice) =>
  relations.map((relation) => relationLines(relation, voice).join("\n")).filter(Boolean);

/** What a declaration answers: what the plan is now, how it meets others', and what the index made of its names. */
export interface DeclareAnswer {
  readonly plan: PeerPlan;
  readonly changed: boolean;
  readonly mode: PeerPlanMode;
  /** What the declaration named: an amendment says what it added. */
  readonly named: Items;
  /** The relations to list: those the session was not told of (all, when nothing changed). */
  readonly relations: ReadonlyArray<PeerPlanRelation>;
  /** How many relations name the session now. */
  readonly total: number;
  readonly notes: Notes;
  readonly voice: Voice;
}

export function answerText({
  plan,
  changed,
  mode,
  named,
  relations,
  total,
  notes,
  voice,
}: DeclareAnswer) {
  const header = !changed
    ? `Plan v${plan.version} unchanged: ${countsText(plan)}.`
    : mode === "amend"
      ? `Plan v${plan.version} recorded: added ${countsText(named)}.`
      : `Plan v${plan.version} recorded: ${countsText(plan)}.`;
  const blocks = blocksOf(relations, voice);
  const result = !plan.live
    ? "Peer has not heard from this session yet, so relations follow at your next step."
    : total === 0
      ? "Nothing in the project meets your plan."
      : blocks.length === 0
        ? "Nothing new meets your plan."
        : null;
  return compose(
    result === null ? [header] : [header, result],
    blocks,
    notesLines(notes),
    ANSWER_MAX,
  );
}

/** What `peer plan` shows of the session's plan, and the relations it was not told of. */
export interface ShowAnswer {
  readonly plan: PeerPlan | undefined;
  readonly relations: ReadonlyArray<PeerPlanRelation>;
  readonly total: number;
  readonly voice: Voice;
}

const age = (plan: PeerPlan, voice: Voice) =>
  sinceText(Math.max(0, voice.now - Date.parse(plan.updatedAt)));

export function showText({ plan, relations, total, voice }: ShowAnswer): string {
  if (plan === undefined)
    return `This session has no plan yet. Declare one before your first edit:\n${form(0)}`;
  const section = (label: string, lines: ReadonlyArray<string>) =>
    lines.map((line, at) => `${at === 0 ? label.padEnd(10) : " ".repeat(10)}${line}`);
  const told = total - relations.length;
  return compose(
    [
      `Plan v${plan.version} · declared ${age(plan, voice)}`,
      ...section("Changes:", [
        ...plan.changes.map(itemText),
        ...plan.maybes.map((item) => `${itemText(item)}  (maybe)`),
      ]),
      ...section("Uses:", plan.uses.map(itemText)),
      ...section(
        "Provides:",
        plan.provides.map((one) => `${what(one)}: ${plain(one.contract, 200)}`),
      ),
      total === 0
        ? "Relations: none"
        : `Relations: ${total}${told === 0 ? "" : `, ${told === total ? "listed" : `${told} listed`} as in your last answer`}`,
    ],
    blocksOf(relations, voice),
    [],
    SHOW_MAX,
  );
}

/** The live plans of a project, as a person's shell reads them. */
export interface PublicAnswer {
  readonly project: string;
  readonly plans: ReadonlyArray<PeerPlan>;
  readonly voice: Voice;
}

export function publicText({ project, plans, voice }: PublicAnswer): string {
  const named = plain(project, 80);
  if (plans.length === 0) return `No live plans in ${named}.`;
  const shown = plans.map((plan) => {
    const who = plain(voice.person(plan.email), 40);
    return `${plain(voice.task(plan.task) ?? plan.label, 60)} · ${who} · Plan v${plan.version} · ${countsText(plan)} · ${age(plan, voice)}`;
  });
  return [`Live plans in ${named} (read-only):`, ...shown].join("\n");
}

export const WITHDRAWN = "Plan withdrawn. Its relations are gone from every view.";
