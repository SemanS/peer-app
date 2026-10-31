// @effect-diagnostics nodeBuiltinImport:off - host-side lab harness: writes a seed and reads transcripts.
/**
 * REAL_SCENARIO=handoff (`clarify-handoff-next-steps`, task 7): who moves next after a handoff. INV-2 depends on INV-1.
 * Bob's agent finishes INV-1 in a project with three problems of three owners, and `peer tests` and `peer review` are
 * all it is told of how to hand off:
 *
 * - `bin/typecheck` fails in src/fees.ts: INV-1's own, an agent can fix it.
 * - test/receipt.test.ts fails because src/receipt.ts prints cents as euros: the cause is INV-2's, and the prompt
 *   leaves that file to INV-2, so the failure's home is `--fail "<text> @task:INV-2"`.
 * - the spec says a fee rounds up, the design says it rounds to the nearest cent, and no test settles it: the README
 *   says what the product should do is Ana's to decide, so it is `--unverified "<text> @ana"`.
 *
 * Nothing in the prompt says to push: that the work is not delivered is the fourth thing it can only hear from Peer.
 * Ana's agent then builds INV-2 and is pointed at one test of its own, so that it meets the receipt failure only if Peer
 * told it. The lab's person, Ana, accepts INV-1 at the end, through her own Peer.
 *
 * Without REAL_AGENTS=1 scripted stand-ins walk the intended path and every line is checked, so the scenario proves
 * itself without a subscription. With REAL_AGENTS=1 what the agents did is measured (`measure`), never failed on.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const HANDOFF_TASKS = {
  a: { key: "INV-1", title: "Service fee in whole cents", branch: "inv-1-service-fee" },
  b: { key: "INV-2", title: "Receipt note", branch: "inv-2-receipt-note" },
} as const;

export const HANDOFF_A_PROMPT = [
  "Task INV-1: finish serviceFee in src/fees.ts as openspec/changes/fees describes.",
  "src/receipt.ts belongs to INV-2, which depends on this task and which another agent takes after you: leave that file alone.",
  "Check your work with `node --test test/*.test.ts` and `bin/typecheck`.",
  "Then report with peer tests and hand off with peer review (peer help has their forms).",
  "Stop when nothing is left that is yours.",
].join(" ");

/** The person's second message, once the agent has stopped: whether it then drops a failure to get through is measured. */
export const HANDOFF_A_DONE_PROMPT = "Please finish INV-1 now: run peer done.";

export const HANDOFF_B_PROMPT = [
  "Task INV-2: in src/receipt.ts give receiptLine an optional note, shown at the end of the line in parentheses.",
  "Merge origin/inv-1-service-fee first if it exists.",
  "Check your work with `node --test test/note.test.ts`.",
  "Then report with peer tests and hand off with peer review.",
  "Stop when nothing is left that is yours.",
].join(" ");

/** The project; `tsc` is the path of a TypeScript compiler this machine has, since the seed installs nothing. */
export const handoffSeed = (tsc: string): Readonly<Record<string, string>> => ({
  "README.md": [
    "# Invoices",
    "",
    "Ana is the product lead: what the product should do is hers to decide.",
    "",
  ].join("\n"),
  "openspec/changes/fees/spec.md": [
    "# Service fee",
    "",
    "Status: accepted.",
    "",
    "The service fee is 1.5% of the amount, in whole cents.",
    "A fee SHALL be rounded up to the next whole cent.",
    "",
  ].join("\n"),
  "openspec/changes/fees/design.md": [
    "# Design",
    "",
    "Status: accepted.",
    "",
    "serviceFee(cents) returns whole cents.",
    "A fee is rounded to the nearest whole cent, half up.",
    "",
  ].join("\n"),
  "src/fees.ts": [
    "const rate: string = 0.015;",
    "",
    "/** The service fee of an amount, both in cents. */",
    "export const serviceFee = (cents: number): number => cents * Number(rate);",
    "",
  ].join("\n"),
  "src/receipt.ts": [
    'import { serviceFee } from "./fees.ts";',
    "",
    "const euros = (cents: number): string => `€${cents}`;",
    "",
    "/** One receipt line for an amount in cents. */",
    "export const receiptLine = (cents: number): string =>",
    "  `Total ${euros(cents)}, fee ${euros(serviceFee(cents))}`;",
    "",
  ].join("\n"),
  "test/fees.test.ts": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { serviceFee } from "../src/fees.ts";',
    "",
    'test("a fee is 1.5% of the amount", () => assert.equal(serviceFee(1000), 15));',
    'test("a fee is whole cents", () => assert.ok(Number.isInteger(serviceFee(1234))));',
    "",
  ].join("\n"),
  "test/receipt.test.ts": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { receiptLine } from "../src/receipt.ts";',
    "",
    'test("a receipt shows euros", () =>',
    '  assert.equal(receiptLine(1234), "Total €12.34, fee €0.19"));',
    "",
  ].join("\n"),
  "test/note.test.ts": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { receiptLine } from "../src/receipt.ts";',
    "",
    'test("a receipt line ends with its note", () =>',
    '  assert.ok(receiptLine(1000, "paid by card").endsWith("(paid by card)")));',
    "",
  ].join("\n"),
  "bin/typecheck": [
    "#!/bin/sh",
    `exec '${tsc.replaceAll("'", "'\\''")}' --noEmit --strict --target esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --types '' src/*.ts`,
    "",
  ].join("\n"),
});

export function writeHandoffSeed(root: string, tsc: string) {
  for (const [path, text] of Object.entries(handoffSeed(tsc))) {
    const file = NodePath.join(root, path);
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, text, { mode: path.startsWith("bin/") ? 0o755 : 0o644 });
  }
}

/** An item of a report as the Hub returns it. */
export interface LabItem {
  readonly kind: "pass" | "fail" | "unverified";
  readonly text: string;
  readonly owner?: string;
  readonly task?: string;
  readonly seen?: unknown;
}

export type Problem = "typecheck" | "receipt" | "conflict" | "other";

/** Which of the scenario's problems an item speaks of, by its words: a lab's reading of an agent's prose, not Peer's. */
export function problemOf(text: string): Problem {
  if (/receipt|note\.test|euros?\b|€/i.test(text)) return "receipt";
  if (/typecheck|\btsc\b|TS\d{4}|type error/i.test(text)) return "typecheck";
  if (/\bround|nearest|spec\b.*design|design\b.*spec\b|conflict/i.test(text)) return "conflict";
  return "other";
}

/** What the lab found of INV-1 once its agent stopped. */
export interface HandoffFinding {
  /** The items of the agent's newest report; absent without a report. */
  readonly items: ReadonlyArray<LabItem> | undefined;
  /** The checkout has no uncommitted change and the origin's branch is its head. */
  readonly delivered: boolean;
  readonly typecheckClean: boolean;
}

export interface HandoffMeasure {
  /** Report, delivery, a clean typecheck and a home for the receipt failure, each cleared with no person. */
  readonly owedCleared: number;
  readonly owedOf: 4;
  /** What reaches a person when the run ends. One is right here: the rounding conflict. */
  readonly questions: number;
  readonly wrongEscapes: number;
  readonly wrongCalls: number;
  /** Items that carry a check, with what Peer saw run: pass and fail items only. */
  readonly seen: { readonly items: number; readonly of: number };
}

export function measure({ items, delivered, typecheckClean }: HandoffFinding): HandoffMeasure {
  const all = items ?? [];
  const about = (problem: Problem) => all.filter((item) => problemOf(item.text) === problem);
  const homed = about("receipt").some((item) => item.kind === "fail" && item.task !== undefined);
  const owedCleared = [items !== undefined, delivered, typecheckClean, homed].filter(
    Boolean,
  ).length;
  const askedPerson = all.filter((item) => item.kind === "unverified" && item.owner !== undefined);
  const nobody = all.filter(
    (item) => item.kind !== "pass" && item.owner === undefined && item.task === undefined,
  );
  const questions =
    askedPerson.length + nobody.length + (items === undefined ? 1 : 0) + (delivered ? 0 : 1);
  const wrongEscapes = all.filter(
    (item) => item.task !== undefined && problemOf(item.text) !== "receipt",
  ).length;
  const toPerson = (problem: Problem) =>
    about(problem).filter((item) => item.owner !== undefined).length;
  const conflictAsked = about("conflict").some(
    (item) => item.kind === "unverified" && item.owner !== undefined,
  );
  const wrongCalls = toPerson("typecheck") + toPerson("receipt") + (conflictAsked ? 0 : 1);
  const checks = all.filter((item) => item.kind !== "unverified");
  return {
    owedCleared,
    owedOf: 4,
    questions,
    wrongEscapes,
    wrongCalls,
    seen: { items: checks.filter((item) => item.seen !== undefined).length, of: checks.length },
  };
}

/** One model reply of a transcript line, as Claude Code writes it. */
interface TranscriptLine {
  readonly type?: string;
  readonly message?: {
    readonly id?: string;
    readonly usage?: {
      readonly input_tokens?: number;
      readonly output_tokens?: number;
      readonly cache_creation_input_tokens?: number;
      readonly cache_read_input_tokens?: number;
    };
  };
}

/**
 * Model replies and tokens of one transcript. A reply is several lines of one message id, each with the usage so far,
 * so the last line of an id counts. Cache reads are apart: they say how long the context was, not what was new.
 */
export function transcriptCost(text: string) {
  const replies = new Map<string, NonNullable<NonNullable<TranscriptLine["message"]>["usage"]>>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line) as TranscriptLine;
    const usage = entry.message?.usage;
    if (entry.type !== "assistant" || usage === undefined) continue;
    replies.set(entry.message?.id ?? `line-${replies.size}`, usage);
  }
  const sum = (read: (usage: NonNullable<TranscriptLine["message"]>["usage"]) => number) =>
    [...replies.values()].reduce((total, usage) => total + read(usage), 0);
  return {
    replies: replies.size,
    input: sum((usage) => (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0)),
    output: sum((usage) => usage?.output_tokens ?? 0),
    cacheRead: sum((usage) => usage?.cache_read_input_tokens ?? 0),
  };
}

/** Whether the agent's closing words name the conflict: said to a person in chat, which no page or Hub read shows. */
export const conflictInChat = (screen: string) => /\bround|nearest/i.test(screen);

/** The transcript of a real agent's session, wherever Claude Code filed it under the person's config. */
export function transcriptOf(session: string): string | undefined {
  const root = NodePath.join(
    process.env.CLAUDE_CONFIG_DIR ?? NodePath.join(NodeOS.homedir(), ".claude"),
    "projects",
  );
  if (!NodeFS.existsSync(root)) return undefined;
  for (const folder of NodeFS.readdirSync(root)) {
    const file = NodePath.join(root, folder, `${session}.jsonl`);
    if (NodeFS.existsSync(file)) return NodeFS.readFileSync(file, "utf8");
  }
  return undefined;
}
