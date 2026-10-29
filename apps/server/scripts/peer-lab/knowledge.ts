// @effect-diagnostics nodeBuiltinImport:off globalDate:off - host-side lab harness: writes a seed and reads the logs.
/**
 * REAL_SCENARIO=knowledge: a change notice of the project's knowledge (`add-knowledge-extensions-and-change-notices`,
 * design D5/D6, task 6.1). The project keeps a kontext store with one committed decision, A ("Prices are whole
 * euros"), governing src/pricing.ts. On Ana's computer the reader session reads A with `peer knowledge <A>` and
 * then works on src/cart.ts; a bystander session works on src/shipping.ts and reads nothing. On Bob's computer the
 * author session reads A, and the lab lands as its person would: B ("Prices are integer cents") written with
 * `kontext capture --promote --supersedes <A>`, committed on main and pushed to the origin. Ana's checkout then
 * fetches (as Peer's drift refresh would see it), and the reader's next step must name B once: "superseded by
 * …", with `peer knowledge <B>`. The author (its checkout holds B) and the bystander hear nothing, and no later
 * step says it again. The coordination debug logs hold the `knowledge.changed` line and its tokens.
 *
 * Without REAL_AGENTS=1 scripted stand-ins play all three sessions and do what Peer's words say (the reader runs
 * the read command the notice gives). With REAL_AGENTS=1 the reader is a real agent (REAL_KINDS=claude); the
 * author and the bystander stay stand-ins: what they are told depends on what Peer keeps of them, not on a model.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { plainSession, toldTexts, type HookOut, type LabEvent } from "./told.ts";

/** A, the kept entry the reader reads, as a committed kontext decision file. */
export const ENTRY_A = {
  id: "2026-10-20-prices-are-whole-euros",
  title: "Prices are whole euros",
  file: ".ai/decisions/2026-10-20-prices-are-whole-euros.md",
  paths: ["src/pricing.ts"],
} as const;

/** B, which supersedes A: what the author's person keeps and lands. */
export const ENTRY_B = {
  title: "Prices are integer cents",
  body: "price() sums integer cents, never whole euros; format at the edge with formatPrice(cents).",
  paths: ["src/pricing.ts"],
} as const;

/** The first line of every change notice (`changeText`): how a hook's text is recognised as one. */
export const CHANGE_HEADER = "Peer · the project's knowledge changed on the default branch";

/** The project as the scenario seeds it: the files the three sessions change, and A. */
export const KNOWLEDGE_SEED: Readonly<Record<string, string>> = {
  "src/pricing.ts":
    "/** Whole euros. */\nexport function price(items: number[]): number {\n  return items.reduce((sum, item) => sum + item, 0);\n}\n",
  "src/cart.ts":
    'import { price } from "./pricing";\n\nexport const cartTotal = (items: number[]) => price(items);\n',
  "src/shipping.ts": "export const shippingFee = (weightKg: number) => (weightKg > 10 ? 9 : 4);\n",
  [ENTRY_A.file]: [
    "---",
    `id: ${ENTRY_A.id}`,
    "kind: decision",
    `title: ${ENTRY_A.title}`,
    "status: accepted",
    "date: 2026-10-20",
    "summary: price() in src/pricing.ts sums whole euros; nothing in the shop deals in cents.",
    "tags: [money]",
    `paths: [${ENTRY_A.paths.join(", ")}]`,
    "---",
    "",
    "The first shop sold whole-euro items only, so prices were kept as whole euros.",
    "",
  ].join("\n"),
};

/** Writes the seed into a fresh project directory (after `kontext init`, before the first commit). */
export function writeKnowledgeSeed(work: string) {
  for (const [file, text] of Object.entries(KNOWLEDGE_SEED)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(work, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(work, file), text);
  }
}

/** `kontext capture` as the author's person runs it: B written into the store, superseding A. */
export const supersedeArgs = (checkout: string) => [
  "-C",
  checkout,
  "capture",
  "--promote",
  "--kind",
  "decision",
  "--title",
  ENTRY_B.title,
  "--body",
  ENTRY_B.body,
  "--paths",
  ENTRY_B.paths.join(","),
  "--supersedes",
  ENTRY_A.id,
];

/** The id `kontext capture` printed it wrote (`wrote .ai/decisions/<id>.md`), or null. */
export function writtenId(output: string): string | null {
  const match = /wrote\s+\.ai\/[a-z]+\/([^\s/]+)\.md/.exec(output);
  return match?.[1] ?? null;
}

/** The read command a notice names for an entry (`Read it: peer knowledge <id>`), in order. */
export const readCommands = (text: string) =>
  [...text.matchAll(/Read it: \S+ knowledge (\S+)/g)].map((match) => match[1]!);

/** What a hook answered for an agent, as context or as a stop's reason. */
export const contextOf = (out: HookOut) =>
  out?.hookSpecificOutput?.additionalContext ?? out?.hookSpecificOutput?.permissionDecisionReason;

/** The real reader's prompts: read A, work; then two more small steps, each after the lab has acted. */
export const READER_TASK = `Before you change anything, run \`peer knowledge ${ENTRY_A.id}\` and keep to it. Then add \`export const itemCount = (items: number[]) => items.length;\` to src/cart.ts. Change no other file. Keep the change small; do not run tests or builds, and do not commit.`;
export const READER_NEXT =
  "Next, add `export const isEmpty = (items: number[]) => items.length === 0;` to src/cart.ts. Change no other file, do not commit, and do not run tests or builds.";
export const READER_LAST =
  "Last, add a one-line comment `// Cart helpers.` at the top of src/cart.ts. Change no other file, do not commit, and do not run tests or builds.";

/** One `knowledge.changed` line of a debug log. */
export interface ChangeNotice {
  readonly computer: string;
  readonly session: string;
  readonly entries: ReadonlyArray<{
    readonly id: string;
    readonly revision: string;
    readonly change: string;
    readonly how: string;
  }>;
  readonly tokens: number;
  readonly text: string;
}

/** The `knowledge.changed` lines of a computer's debug log, oldest first. */
export function changeNotices(computer: string, events: ReadonlyArray<LabEvent>) {
  return events.flatMap((entry): ChangeNotice[] => {
    if (entry.event !== "knowledge.changed") return [];
    const entries = Array.isArray(entry.entries) ? (entry.entries as ChangeNotice["entries"]) : [];
    return [
      {
        computer,
        session: plainSession(entry.session),
        entries,
        tokens: typeof entry.tokens === "number" ? entry.tokens : 0,
        text: typeof entry.text === "string" ? entry.text : "",
      },
    ];
  });
}

/** The change notices a session's hooks carried into its context (any text with the header). */
export const heardChanges = (events: ReadonlyArray<LabEvent>, session: string) =>
  toldTexts(events.filter((entry) => plainSession(entry.session) === session)).filter((text) =>
    text.includes(CHANGE_HEADER),
  );

/** The change part of a hook's text: from the header to the closing line. */
export function changePart(text: string): string {
  const at = text.indexOf(CHANGE_HEADER);
  if (at < 0) return "";
  const rest = text.slice(at);
  const end = rest.indexOf(" before handing over.");
  return end < 0 ? rest : rest.slice(0, end + " before handing over.".length);
}

export interface KnowledgeSessions {
  readonly reader: string;
  readonly bystander: string;
  readonly author: string;
}

export interface KnowledgeResult {
  readonly dry: boolean;
  /** B's id as kontext wrote it. */
  readonly superseding: string;
  readonly sessions: KnowledgeSessions;
  /** `knowledge.changed` lines by session. */
  readonly notices: Readonly<Record<keyof KnowledgeSessions, ReadonlyArray<ChangeNotice>>>;
  /** Hook texts with a change notice in them, by session. */
  readonly heard: Readonly<Record<keyof KnowledgeSessions, ReadonlyArray<string>>>;
  /** The reader read A (`knowledge.opened`). */
  readonly readA: boolean;
  /** The reader ran the read command the notice gave it. */
  readonly ranB: boolean;
  /** …and it found B: its checkout has B (it updated), or Peer reads it from the default branch. */
  readonly readB: boolean;
  /** Whether the one notice names A superseded by B, as read, with `peer knowledge <B>`. */
  readonly namesB: boolean;
}

/** What the logs of the two computers say each session was told of the change. */
export function knowledgeResult(input: {
  readonly dry: boolean;
  readonly superseding: string;
  readonly sessions: KnowledgeSessions;
  readonly ana: ReadonlyArray<LabEvent>;
  readonly bob: ReadonlyArray<LabEvent>;
}): KnowledgeResult {
  const { sessions, superseding } = input;
  const all = [...changeNotices("Ana", input.ana), ...changeNotices("Bob", input.bob)];
  const where = { reader: input.ana, bystander: input.ana, author: input.bob } as const;
  const keys = ["reader", "bystander", "author"] as const;
  const notices = Object.fromEntries(
    keys.map((key) => [key, all.filter((notice) => notice.session === sessions[key])]),
  ) as KnowledgeResult["notices"];
  const heard = Object.fromEntries(
    keys.map((key) => [key, heardChanges(where[key], sessions[key])]),
  ) as KnowledgeResult["heard"];
  const opened = (id: string) =>
    input.ana.some(
      (entry) =>
        entry.event === "knowledge.opened" &&
        plainSession(entry.session) === sessions.reader &&
        entry.entry === id,
    );
  const [only] = notices.reader;
  const namesB =
    notices.reader.length === 1 &&
    only !== undefined &&
    only.entries.length === 1 &&
    only.entries[0]!.id === ENTRY_A.id &&
    only.entries[0]!.change === "superseded" &&
    only.entries[0]!.how === "read" &&
    only.text.includes(`superseded by "${ENTRY_B.title}"`) &&
    readCommands(only.text).includes(superseding);
  return {
    dry: input.dry,
    superseding,
    sessions,
    notices,
    heard,
    readA: opened(ENTRY_A.id),
    readB: opened(superseding),
    ranB: input.ana.some(
      (entry) =>
        entry.event === "cli" &&
        entry.command === "knowledge" &&
        plainSession(entry.session) === sessions.reader &&
        JSON.stringify(entry).includes(superseding),
    ),
    namesB,
  };
}

/** The result as the lab prints it. */
export function formatKnowledge(result: KnowledgeResult): ReadonlyArray<string> {
  const line = (key: keyof KnowledgeSessions) => {
    const notices = result.notices[key];
    const tokens = notices.reduce((sum, notice) => sum + notice.tokens, 0);
    return `${key} (${result.sessions[key]}): ${notices.length} knowledge.changed, ${result.heard[key].length} hook texts with a change notice, ${tokens} tokens`;
  };
  return [
    `${result.dry ? "dry run (stand-ins)" : "real reader"}; B = ${result.superseding}`,
    `reader read A: ${result.readA ? "yes" : "no"}; ran the notice's read of B: ${result.ranB ? "yes" : "no"}, which found B: ${result.readB ? "yes" : "no"}`,
    line("reader"),
    line("bystander"),
    line("author"),
    `the one notice names A superseded by B with its read command: ${result.namesB ? "yes" : "no"}`,
  ];
}
