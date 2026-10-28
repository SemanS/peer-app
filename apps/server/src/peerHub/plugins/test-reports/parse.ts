/**
 * `peer tests` as an agent types it: `pass|fail|mixed "<summary>" [--for <task>] [--pass "<text>"]...
 * [--fail "<text>"]... [--unverified "<text> [@<person>]"]...`, or `show [<task>]`. Flags repeat, so
 * the command reads its own arguments rather than core's one-value `flag`.
 *
 * @module peerHub/plugins/test-reports/parse
 */
import type { PeerTestReportItemKind, PeerTestReportResult } from "@t3tools/contracts";

import { usage } from "../../core/plugin.ts";

export const FORM =
  'peer tests pass|fail|mixed "<summary>" [--for <task>] [--pass "<text>"]... [--fail "<text>"]... [--unverified "<text> [@<person>]"]..., or peer tests show [<task>]';

export interface ParsedItem {
  readonly kind: PeerTestReportItemKind;
  readonly text: string;
  /** As typed after `@`: a short name or an address; the Hub completes and checks it. */
  readonly owner?: string;
}

export type Parsed =
  | {
      readonly kind: "file";
      readonly result: PeerTestReportResult;
      readonly summary: string;
      readonly task: string | undefined;
      readonly items: ReadonlyArray<ParsedItem>;
    }
  | { readonly kind: "show"; readonly task: string | undefined };

const RESULTS: ReadonlySet<string> = new Set(["pass", "fail", "mixed"]);
const ITEM_FLAGS: Readonly<Record<string, PeerTestReportItemKind>> = {
  "--pass": "pass",
  "--fail": "fail",
  "--unverified": "unverified",
};
/** A trailing `@ana` or `@ana@acme.test` names who answers for the item. */
const OWNER = /^(.*\S)\s+@([^\s@]+(?:@[^\s@]+)?)$/;

const bad = (reason: string) => usage(reason, `run ${FORM}.`);

/** An unverified item's text and its owner, when it names one. */
export function itemOf(kind: PeerTestReportItemKind, raw: string): ParsedItem {
  const text = raw.trim();
  const owned = kind === "unverified" ? OWNER.exec(text) : null;
  return owned === null ? { kind, text } : { kind, text: owned[1]!, owner: owned[2]! };
}

/** The command line read, or a usage error naming what is wrong with it. */
export function parse(args: ReadonlyArray<string>): Parsed {
  const [first, ...rest] = args;
  if (first === "show") {
    if (rest.length > 1 || rest.some((arg) => arg.startsWith("--")))
      throw bad("tests show takes at most one task");
    return { kind: "show", task: rest[0] };
  }
  if (first === undefined || !RESULTS.has(first))
    throw bad("tests starts with pass, fail, mixed or show");
  const words: string[] = [];
  const items: ParsedItem[] = [];
  let task: string | undefined;
  for (let at = 0; at < rest.length; at++) {
    const arg = rest[at]!;
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const value = rest[at + 1];
    if (value === undefined || value.trim() === "") throw bad(`${arg} needs a value`);
    at++;
    if (arg === "--for") {
      if (task !== undefined) throw bad("--for names one task");
      task = value.trim();
    } else if (ITEM_FLAGS[arg] !== undefined) items.push(itemOf(ITEM_FLAGS[arg], value));
    else throw bad(`unknown flag ${arg}`);
  }
  const summary = words.join(" ").trim();
  if (summary === "") throw bad("a test report needs a summary");
  return { kind: "file", result: first as PeerTestReportResult, summary, task, items };
}

/**
 * What the Hub will store as the result: `mixed` when the items disagree with the one filed (a
 * failed item in a pass, a passed one in a fail, an unverified one in either), with why.
 */
export function corrected(
  result: PeerTestReportResult,
  items: ReadonlyArray<{ readonly kind: PeerTestReportItemKind }>,
): { readonly result: PeerTestReportResult; readonly why?: string } {
  const has = (kind: PeerTestReportItemKind) => items.some((item) => item.kind === kind);
  if (result === "pass" && has("fail")) return { result: "mixed", why: "it has a failed item" };
  if (result === "fail" && has("pass")) return { result: "mixed", why: "it has a passed item" };
  if (result !== "mixed" && has("unverified"))
    return { result: "mixed", why: "it has an unverified item" };
  return { result };
}
