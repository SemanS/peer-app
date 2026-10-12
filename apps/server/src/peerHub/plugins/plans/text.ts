import type {
  PeerPlan,
  PeerPlanItem,
  PeerPlanMode,
  PeerPlanRelation,
  PeerPlanSide,
} from "@t3tools/contracts";
import { cutText, fenced, plain, plural, sinceText } from "../../peerText.ts";
import type { Items, Notes } from "./items.ts";

/** The most characters an answer to `peer plan` takes: the rest is counted and read with `peer plan`. */
export const ANSWER_MAX = 1500;
const SHOW_MAX = 3000;
/** What a section of `peer plan` lists before it says how many more there are. */
const SECTION_MAX = 12;

/** How `peer plan` is written, starting `indent` columns in: what a usage error and an empty plan show. */
export const form = (indent: number) =>
  [
    "peer plan [--amend] [--change <item>]... [--maybe <item>]... [--uses <item>]...",
    `${" ".repeat(indent + 10)}[--provides "<symbol> (<path>): <contract>"]...`,
    `${" ".repeat(indent)}peer plan --withdraw`,
    `${" ".repeat(indent + 2)}<item> = <path> | <dir>/ | <path>#<symbol>`,
  ].join("\n");

/** Whose side of a relation an agent is: its session, as the Hub knows it, and the computer. */
export interface Reader {
  readonly session: string;
  readonly email: string;
  readonly environment: string;
}

/** How a person and a task are named where an answer is read, and when it is. */
export interface Voice {
  readonly reader: Reader;
  readonly person: (email: string) => string;
  /** A task's key (`ORD-11`), when Peer knows the task. */
  readonly task: (id: string | undefined) => string | undefined;
  readonly now: number;
}

export type Kind = "uses-their-change" | "changes-their-use" | "same-change";

const ours = (side: PeerPlanSide, reader: Reader) =>
  side.session === reader.session &&
  side.email === reader.email &&
  side.environment === reader.environment;

/** A relation as its reader's agent hears it: the Hub's `use` is `uses-their-change` to the user, `changes-their-use` to the changer. */
export function orient(
  relation: PeerPlanRelation,
  reader: Reader,
): { readonly kind: Kind; readonly other: PeerPlanSide } | null {
  const user = ours(relation.a, reader);
  if (!user && !ours(relation.b, reader)) return null;
  return {
    kind:
      relation.kind === "same-change"
        ? "same-change"
        : user
          ? "uses-their-change"
          : "changes-their-use",
    other: user ? relation.b : relation.a,
  };
}

/** What a relation meets at: `applyTax (src/tax.ts)`, or the path alone. */
export const what = (item: PeerPlanItem) =>
  item.name === undefined
    ? plain(item.path, 160)
    : `${plain(item.name, 100)} (${plain(item.path, 100)})`;

/** An item as `peer plan` takes it: `src/tax.ts#applyTax`. */
const itemText = (item: PeerPlanItem) =>
  item.name === undefined
    ? plain(item.path, 160)
    : `${plain(item.path, 100)}#${plain(item.name, 100)}`;

/** A contract line as a plan declares it, which another work reads as teammate text. */
export const contractLine = (provides: PeerPlan["provides"][number]) =>
  `${plain(provides.name, 100)} (${plain(provides.path, 100)}): ${plain(provides.contract, 200)}`;

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

/** What to run to ask the other work, when it is a task. */
const askOf = (other: PeerPlanSide, voice: Voice) =>
  other.task === undefined ? null : plain(voice.task(other.task) ?? other.task, 60);

/** One relation, as the answer to `peer plan` lists it. */
export function relationLines(relation: PeerPlanRelation, voice: Voice): ReadonlyArray<string> {
  const oriented = orient(relation, voice.reader);
  if (oriented === null) return [];
  const { kind, other } = oriented;
  const marks = [relation.certain ? "" : "uncertain", relation.observed ? "observed" : ""]
    .filter((mark) => mark !== "")
    .join(", ");
  const key = workOf(other, voice);
  const who = whoOf(other, voice);
  const shown = kind === "uses-their-change" && relation.contract !== undefined;
  const detail =
    kind === "changes-their-use"
      ? relation.observed
        ? `${who} plans to use it; your session already changed it.`
        : `${who} plans to use it.`
      : relation.observed
        ? `${key}’s session already changed it.`
        : kind === "uses-their-change"
          ? `${who} plans to change it.`
          : `${who} also plans to change it.`;
  const ask = askOf(other, voice);
  const hint =
    ask === null
      ? []
      : [
          kind === "uses-their-change"
            ? `Build against it, or run: peer ask ${ask}`
            : kind === "changes-their-use"
              ? `If its contract changes, update your contract line, or run: peer ask ${ask}`
              : `Agree on who changes it, or run: peer ask ${ask}`,
        ];
  return [
    `${kind}${marks === "" ? "" : ` (${marks})`}  ${what(relation.item)}`,
    `  ${detail}${shown ? " Their contract (teammate text):" : ""}`,
    ...(shown ? fence(`${what(relation.item)}: ${plain(relation.contract ?? "", 200)}`) : []),
    ...hint.map((line) => `  ${line}`),
  ];
}

const countsOf = (items: Items) => [
  plural(items.changes.length, "change"),
  plural(items.maybes.length, "maybe"),
  plural(items.uses.length, "use"),
  plural(items.provides.length, "contract"),
];

/** `1 change, 1 maybe, 1 use, 1 contract`: what a plan names, without what it does not. */
export const countsText = (items: Items) =>
  countsOf(items)
    .filter((count) => !count.startsWith("0 "))
    .join(", ");

const NUMBERS = ["", "One", "Two", "Three"];
const names = (list: ReadonlyArray<string>) =>
  `${list
    .slice(0, 3)
    .map((name) => plain(name, 100))
    .join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`;

/** What the local code index said of a declaration's symbols, when something is left to say. */
export function notesLines(notes: Notes): ReadonlyArray<string> {
  const known = notes.unresolved.filter((one) => one.candidates.length < 2);
  const lines = [
    ...(notes.index === "unusable"
      ? ["No usable code index here: its symbols meet other plans only by exact name and by path."]
      : []),
    ...notes.unresolved
      .filter((one) => one.candidates.length > 1)
      .slice(0, 3)
      .map((one) => {
        const count = one.candidates.length;
        return `Kept as written: ${plain(one.name, 100)} (${plain(one.path, 100)}). ${NUMBERS[count] ?? count} symbols end with it:\n  ${names(one.candidates)}`;
      }),
    ...(known.length === 0
      ? []
      : [
          `Kept as written: ${names(known.map((one) => `${one.name} (${one.path})`))}. The index does not know ${known.length === 1 ? "it" : "them"}.`,
        ]),
  ];
  return notes.unresolved.length === 0
    ? lines
    : [
        ...lines,
        `${notes.unresolved.length === 1 ? "It meets" : "They meet"} other plans by exact name and by path.`,
      ];
}

/** Lines, then blocks as many as fit `max`, then how many were left out and where to read them. */
function compose(
  head: ReadonlyArray<string>,
  blocks: ReadonlyArray<string>,
  tail: ReadonlyArray<string>,
  max: number,
): string {
  const fixed = [...head, ...tail].join("\n").length + (blocks.length === 0 ? 0 : 2);
  const size = (n: number) =>
    fixed +
    blocks.slice(0, n).reduce((sum, block) => sum + block.length + 1, 0) +
    (n < blocks.length ? 24 : 0);
  let shown = blocks.length;
  while (shown > 0 && size(shown) > max) shown -= 1;
  const left = blocks.length - shown;
  const parts = [
    head.join("\n"),
    ...(blocks.length === 0
      ? []
      : [`${blocks.slice(0, shown).join("\n")}${left === 0 ? "" : `\n${left} more: peer plan`}`]),
    ...(tail.length === 0 ? [] : [tail.join("\n")]),
  ];
  const text = parts.filter((part) => part !== "").join(blocks.length === 0 ? "\n" : "\n\n");
  return cutText(text, max);
}

const planCounts = (plan: PeerPlan) => countsText(plan);

/** What a declaration answers: the version, how the plan meets others' now, and what the index made of its names. */
export interface DeclareAnswer {
  readonly plan: PeerPlan;
  readonly changed: boolean;
  readonly mode: PeerPlanMode;
  /** What the declaration named, as an amendment says what it added. */
  readonly named: Items;
  /** The relations to list: those this session was not told of yet (all, when nothing changed). */
  readonly relations: ReadonlyArray<PeerPlanRelation>;
  /** How many relations name this session now. */
  readonly total: number;
  readonly notes: Notes;
  readonly voice: Voice;
}

export function answerText(answer: DeclareAnswer): string {
  const { plan, voice } = answer;
  const header = !answer.changed
    ? `Plan v${plan.version} unchanged: ${planCounts(plan)}.`
    : answer.mode === "amend"
      ? `Plan v${plan.version} recorded: added ${countsText(answer.named)}.`
      : `Plan v${plan.version} recorded: ${planCounts(plan)}.`;
  const blocks = answer.relations
    .map((relation) => relationLines(relation, voice).join("\n"))
    .filter((block) => block !== "");
  const result = !plan.live
    ? "Peer has not heard from this session yet, so relations follow at your next step."
    : answer.total === 0
      ? "Nothing in the project meets your plan."
      : blocks.length === 0
        ? "Nothing new meets your plan."
        : null;
  return compose(
    result === null ? [header] : [header, result],
    blocks,
    notesLines(answer.notes),
    ANSWER_MAX,
  );
}

/** What `peer plan` shows of the session's plan. */
export interface ShowAnswer {
  readonly plan: PeerPlan | undefined;
  /** The relations to list: those this session was not told of yet. */
  readonly relations: ReadonlyArray<PeerPlanRelation>;
  readonly total: number;
  /** A declaration is waiting for the Hub to answer. */
  readonly pending: boolean;
  readonly voice: Voice;
}

const WAITING = "A declaration is waiting for the Hub; Peer sends it when the Hub answers.";

export function showText(answer: ShowAnswer): string {
  const { plan, voice } = answer;
  if (plan === undefined)
    return [
      "This session has no plan yet. Declare one before your first edit:",
      form(0),
      ...(answer.pending ? [WAITING] : []),
    ].join("\n");
  const section = (label: string, lines: ReadonlyArray<string>) => {
    const shown =
      lines.length > SECTION_MAX
        ? [...lines.slice(0, SECTION_MAX), `…and ${lines.length - SECTION_MAX} more`]
        : lines;
    return shown.map((line, at) => `${at === 0 ? label.padEnd(10) : " ".repeat(10)}${line}`);
  };
  const told = answer.total - answer.relations.length;
  const relations =
    answer.total === 0
      ? "Relations: none"
      : `Relations: ${answer.total}${told > 0 ? `, ${told === answer.total ? "listed" : `${told} listed`} as in your last answer` : ""}`;
  const blocks = answer.relations
    .map((relation) => relationLines(relation, voice).join("\n"))
    .filter((block) => block !== "");
  return compose(
    [
      `Plan v${plan.version} · declared ${sinceText(Math.max(0, voice.now - Date.parse(plan.updatedAt)))}`,
      ...section("Changes:", [
        ...plan.changes.map(itemText),
        ...plan.maybes.map((item) => `${itemText(item)}  (maybe)`),
      ]),
      ...section("Uses:", plan.uses.map(itemText)),
      ...section("Provides:", plan.provides.map(contractLine)),
      ...(answer.pending ? [WAITING] : []),
      relations,
    ],
    blocks,
    [],
    SHOW_MAX,
  );
}

/** The live plans of a project, read by a person's shell: who, which version, how big, how old. */
export interface PublicAnswer {
  readonly project: string;
  readonly plans: ReadonlyArray<PeerPlan>;
  readonly voice: Voice;
}

export function publicText({ project, plans, voice }: PublicAnswer): string {
  if (plans.length === 0) return `No live plans in ${plain(project, 80)}.`;
  const shown = plans.slice(0, 20).map((plan) => {
    const work = plain(voice.task(plan.task) ?? plan.label, 60);
    return `${work} · ${plain(voice.person(plan.email), 40)} · Plan v${plan.version} · ${planCounts(plan)} · ${sinceText(Math.max(0, voice.now - Date.parse(plan.updatedAt)))}`;
  });
  return [
    `Live plans in ${plain(project, 80)} (read-only):`,
    ...shown,
    ...(plans.length > shown.length ? [`…and ${plans.length - shown.length} more`] : []),
  ].join("\n");
}

export const WITHDRAWN = "Plan withdrawn. Its relations are gone from every view.";
