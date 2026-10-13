// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: git and node on throwaway checkouts.
/**
 * REAL_SCENARIO=contract LAB_CONTRACT=hidden: a dependency nobody names. Ana's task fixes floating-point
 * drift by making `orderTotal(order)` return an integer number of cents (the same name, a new unit) and
 * updating its uses; Bob's task adds loyalty points in a new file, one point per whole euro of an
 * order's total, for which the natural call is `orderTotal`. The titles and branches share no word with
 * the other's work, no file is shared, and both agents start together. In Bob's checkout `orderTotal`
 * returns euros, so his code is right there and awards a hundred times the points once both branches
 * are merged, unless he learns of Ana's change before he writes it: nothing breaks at a name, only at
 * a unit. The arms are the contract scenario's, plus `LAB_PEER=off`: no Peer at all.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ARM_LABELS,
  plansChars,
  type AgentReport,
  type Arm,
  type Check,
  type StubAgent,
  type Work,
} from "./contract.ts";

// ---- the seeds and the tasks ----

const ORDERS_IN_EUROS = [
  'import { roundEuros } from "./money.js";',
  "",
  "/**",
  " * An order's total.",
  " * @param {{ lines: { price: number, qty: number }[] }} order prices in euros, as decimal numbers",
  " * @returns {number} the total in euros, as a decimal number rounded to cents: 12.5 is twelve euros fifty",
  " */",
  "export const orderTotal = (order) =>",
  "  roundEuros(order.lines.reduce((sum, line) => sum + line.price * line.qty, 0));",
  "",
].join("\n");

/** The project both agents start from: a shop whose order totals are euros. Plain ES modules, so that nothing builds. */
export const HIDDEN_SEED: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "shop", private: true, type: "module" })}\n`,
  "src/money.js": [
    "/** A price rounded to whole cents, in euros: 12.345 is 12.35. */",
    "export const roundEuros = (euros) => Math.round(euros * 100) / 100;",
    "",
  ].join("\n"),
  "src/orders.js": ORDERS_IN_EUROS,
  "src/receipt.js": [
    'import { orderTotal } from "./orders.js";',
    "",
    "/** The receipt's last line: `Total: €12.50`. */",
    "export const receiptTotal = (order) => `Total: €${orderTotal(order).toFixed(2)}`;",
    "",
  ].join("\n"),
  "src/vat.js": [
    'import { roundEuros } from "./money.js";',
    'import { orderTotal } from "./orders.js";',
    "",
    "/** The VAT an order's total holds at 20%, in euros rounded to cents: an order of €12.00 holds €2.00. */",
    "export const vatOf = (order) => roundEuros(orderTotal(order) / 6);",
    "",
  ].join("\n"),
};

/** Neither title nor branch says anything of orders, totals, cents or points that the other's work is about. */
export const HIDDEN_TASKS = [
  { key: "KRK-1", title: "Rounding drift bug", branch: "krk-1-rounding" },
  { key: "KRK-2", title: "Loyalty points", branch: "krk-2-loyalty" },
] as const;

/** What each person asks. Neither names the other; Bob's says nothing of orderTotal, cents or euros as a unit. */
export const HIDDEN_ANA_TASK =
  "Sums of prices drift in floating point: 0.1 + 0.2 gives 0.30000000000000004. Make `orderTotal(order)` in src/orders.js return an integer number of cents computed with integer arithmetic (an order of one line at 12.50 returns 1250), and update everything in src/ that uses it so that receipts and VAT come out as before. Keep the change small; do not run tests or builds.";
export const HIDDEN_BOB_TASK =
  "Add `loyaltyPoints(order)` in a new file src/loyalty.js: a customer earns one point for every whole euro of the order's total, so an order that comes to 12.50 euros earns 12 points. Do not change other files. Keep the change small; do not run tests or builds.";

/** Writes the seeds into a directory. */
export function writeHiddenSeed(directory: string) {
  for (const [path, text] of Object.entries(HIDDEN_SEED)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(directory, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(directory, path), text);
  }
}

// ---- the checks the agents never saw ----

/** `orderTotal` as Ana is asked to leave it: integer cents. Bob's code is tried against it on his own branch. */
export const ORDERS_IN_CENTS = [
  "/** An order's total in integer cents: an order of one line at 12.50 returns 1250. */",
  "export const orderTotal = (order) =>",
  "  order.lines.reduce((sum, line) => sum + Math.round(line.price * 100) * line.qty, 0);",
  "",
].join("\n");

export type HiddenWhich = "provider" | "consumer" | "merged";

const order = (...lines: ReadonlyArray<readonly [number, number]>) =>
  JSON.stringify({ lines: lines.map(([price, qty]) => ({ price, qty })) });

/**
 * What the checks ask of a tree. `provider`: `orderTotal` returns integer cents and the receipt and VAT
 * come out as before. `consumer`: Bob's points are right against the `orderTotal` the tree has.
 * `merged`: both.
 */
const HIDDEN_CHECKS = [
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "const [tree, which] = process.argv.slice(2);",
  "const load = (file) => import(pathToFileURL(join(tree, file)).href);",
  "const expect = (got, want, what) => {",
  "  if (got !== want) throw Object.assign(new Error(what), { got, want });",
  "};",
  "const say = (value) => {",
  "  console.log(JSON.stringify(value));",
  "  process.exit(0);",
  "};",
  "try {",
  '  if (which === "provider" || which === "merged") {',
  '    const { orderTotal } = await load("src/orders.js");',
  `    expect(orderTotal(${order([0.1, 1], [0.2, 1])}), 30, "orderTotal sums 0.10 and 0.20 to 30 cents");`,
  `    expect(orderTotal(${order([12.5, 1])}), 1250, "orderTotal returns integer cents");`,
  '    const { receiptTotal } = await load("src/receipt.js");',
  `    expect(receiptTotal(${order([12.5, 1])}), "Total: €12.50", "the receipt prints as before");`,
  '    const { vatOf } = await load("src/vat.js");',
  `    const vat = vatOf(${order([12, 1])});`,
  '    expect(vat === 2 || vat === 200, true, "VAT comes out as before, in euros or in cents");',
  "  }",
  '  if (which === "consumer" || which === "merged") {',
  '    const { loyaltyPoints } = await load("src/loyalty.js");',
  `    expect(loyaltyPoints(${order([12.5, 1])}), 12, "12.50 euros earn 12 points");`,
  `    expect(loyaltyPoints(${order([9.99, 3])}), 29, "29.97 euros earn 29 points");`,
  "  }",
  '  say({ kind: "pass", detail: "passes" });',
  "} catch (error) {",
  '  if ("want" in error)',
  '    say({ kind: "mismatch", detail: `${error.message}: expected ${JSON.stringify(error.want)}, got ${JSON.stringify(error.got)}` });',
  '  say({ kind: error.code === "ERR_MODULE_NOT_FOUND" ? "missing" : "error", detail: String(error.message).split("\\n")[0] });',
  "}",
  "",
].join("\n");

/** Runs one of the checks on a tree; `work` is where the check's own file goes, outside the tree. */
export function runHiddenCheck(tree: string, which: HiddenWhich, work: string): Check {
  NodeFS.mkdirSync(work, { recursive: true });
  const checks = NodePath.join(work, "hidden-checks.mjs");
  NodeFS.writeFileSync(checks, HIDDEN_CHECKS);
  const ran = NodeChildProcess.spawnSync(process.execPath, [checks, tree, which], {
    encoding: "utf8",
    timeout: 20_000,
    cwd: work,
  });
  try {
    const said = JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "") as {
      kind: Check["kind"];
      detail: string;
    };
    return { ok: said.kind === "pass", kind: said.kind, detail: said.detail };
  } catch {
    const text = `${ran.stderr}${ran.error ?? ""}`.trim().split("\n").at(-1) ?? "no output";
    return { ok: false, kind: "error", detail: `the check did not run: ${text}` };
  }
}

// ---- merging what the agents did ----

const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "lab",
      GIT_AUTHOR_EMAIL: "lab@acme.test",
      GIT_COMMITTER_NAME: "lab",
      GIT_COMMITTER_EMAIL: "lab@acme.test",
    },
  });

/** Which `orderTotal` Bob's code is right against: euros (his checkout's), cents (Ana's), both, or neither. */
export type HiddenWritten = "euros" | "cents" | "both" | "neither";

export interface HiddenIntegration {
  /** Ana's branch alone: `orderTotal` returns cents and its uses come out as before. */
  readonly ana: Check;
  /** Bob's branch alone: his points are right against some `orderTotal`. */
  readonly bob: Check;
  readonly written: HiddenWritten;
  readonly merge: "clean" | "conflict";
  readonly conflicts: ReadonlyArray<string>;
  readonly merged: Check | undefined;
  /** The branches merge without a conflict and the merged tree passes. */
  readonly clean: boolean;
  /** Bob's code allows for cents: it divides by a hundred or speaks of cents. */
  readonly bobUsesCents: boolean;
}

/** Copies a tree without its git data, so that a check may swap one file in it. */
function copyTree(from: string, to: string) {
  NodeFS.rmSync(to, { recursive: true, force: true });
  NodeFS.cpSync(from, to, {
    recursive: true,
    filter: (path) => !path.split(NodePath.sep).includes(".git"),
  });
}

/**
 * Merges both agents' branches in a scratch clone of the origin and runs the checks: Ana's branch,
 * Bob's branch against its own `orderTotal` and against Ana's (a copy with `orderTotal` in cents),
 * then the merge. The agents' checkouts are only read.
 */
export function integrateHidden(input: {
  readonly origin: string;
  readonly ana: Work;
  readonly bob: Work;
  readonly scratch: string;
}): HiddenIntegration {
  const clone = NodePath.join(input.scratch, "merge");
  const work = NodePath.join(input.scratch, "checks");
  git(input.scratch, "clone", "--quiet", input.origin, clone);
  git(clone, "fetch", "--quiet", input.ana.checkout, `${input.ana.branch}:ana`);
  git(clone, "fetch", "--quiet", input.bob.checkout, `${input.bob.branch}:bob`);
  const base = git(clone, "merge-base", "ana", "bob").trim();
  git(clone, "checkout", "--quiet", "ana");
  const ana = runHiddenCheck(clone, "provider", work);
  git(clone, "checkout", "--quiet", "bob");
  const euros = runHiddenCheck(clone, "consumer", work);
  const swapped = NodePath.join(input.scratch, "bob-against-cents");
  copyTree(clone, swapped);
  NodeFS.writeFileSync(NodePath.join(swapped, "src", "orders.js"), ORDERS_IN_CENTS);
  const cents = runHiddenCheck(swapped, "consumer", work);
  const written: HiddenWritten =
    euros.ok && cents.ok ? "both" : euros.ok ? "euros" : cents.ok ? "cents" : "neither";
  const bob =
    euros.ok || cents.ok
      ? euros.ok
        ? euros
        : cents
      : { ...euros, detail: `${euros.detail}; and against cents: ${cents.detail}` };
  const bobsLines = git(clone, "diff", base, "bob")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  git(clone, "checkout", "--quiet", "-b", "merged", "ana");
  let conflicts: string[] = [];
  let merge: HiddenIntegration["merge"] = "clean";
  try {
    git(clone, "merge", "--quiet", "--no-edit", "bob");
  } catch {
    merge = "conflict";
    conflicts = git(clone, "diff", "--name-only", "--diff-filter=U")
      .split("\n")
      .filter((file) => file !== "");
  }
  const merged = merge === "clean" ? runHiddenCheck(clone, "merged", work) : undefined;
  return {
    ana,
    bob,
    written,
    merge,
    conflicts,
    merged,
    clean: merge === "clean" && merged?.ok === true,
    bobUsesCents: bobsLines.some((line) => /cents|\/\s*100\b/i.test(line)),
  };
}

// ---- the report ----

export interface HiddenResult {
  readonly arm: Arm;
  readonly dry: boolean;
  readonly integration: HiddenIntegration;
  readonly ana: AgentReport;
  readonly bob: AgentReport;
}

const yes = (flag: boolean) => (flag ? "yes" : "no");

const WRITTEN: Readonly<Record<HiddenWritten, string>> = {
  euros: "written for orderTotal() in euros, as his checkout has it",
  cents: "written for orderTotal() in cents, as Ana changes it",
  both: "right whether orderTotal() returns euros or cents",
  neither: "right for NEITHER unit",
};

/** The result as the lab prints it, one fact to a line. */
export function formatHidden(result: HiddenResult): ReadonlyArray<string> {
  const { arm, integration: one, ana, bob } = result;
  const ran = (report: AgentReport) =>
    report.ran === 0
      ? "no"
      : `yes, ${report.ran} time${report.ran === 1 ? "" : "s"} (${Object.entries(report.outcomes)
          .map(([how, count]) => `${how} ${count}`)
          .join(", ")})`;
  const added = (report: AgentReport) =>
    `${report.added.chars} characters (hooks ${report.added.hooks}, commands ${report.added.commands}). Of them plans: ${plansChars(report)} (answers ${report.answers.chars} in ${report.answers.count}, notices ${report.notices.chars} in ${report.notices.count}); Impact: ${report.impact.chars} in ${report.impact.count} notices`;
  return [
    `arm: ${arm} (${ARM_LABELS[arm]})${result.dry ? " · dry run: scripted stand-ins for the model" : ""}`,
    `clean integration: ${yes(one.clean)} (merge ${one.merge}${one.conflicts.length > 0 ? `: ${one.conflicts.join(", ")}` : ""}; merged tree: ${one.merged === undefined ? "not run" : one.merged.ok ? "passes" : one.merged.detail})`,
    `Ana's branch alone: ${one.ana.ok ? "orderTotal() in cents, receipt and VAT as before" : `NOT as asked: ${one.ana.detail}`}`,
    `Bob's branch alone: ${one.bob.ok ? WRITTEN[one.written] : `${WRITTEN.neither}: ${one.bob.detail}`}`,
    `Bob's code allows for cents: ${yes(one.bobUsesCents)}`,
    `Ana's agent ran peer plan: ${ran(ana)}`,
    `Bob's agent ran peer plan: ${ran(bob)}`,
    `Peer added to Ana's agent: ${added(ana)}`,
    `Peer added to Bob's agent: ${added(bob)}`,
  ];
}

// ---- the stand-ins for a dry run ----

/** The code Ana's scripted agent writes: `orderTotal` in cents, and its uses. */
export const HIDDEN_ANA_FILES: Readonly<Record<string, string>> = {
  "src/orders.js": ORDERS_IN_CENTS,
  "src/receipt.js": [
    'import { orderTotal } from "./orders.js";',
    "",
    "/** The receipt's last line: `Total: €12.50`. */",
    "export const receiptTotal = (order) => `Total: €${(orderTotal(order) / 100).toFixed(2)}`;",
    "",
  ].join("\n"),
  "src/vat.js": [
    'import { orderTotal } from "./orders.js";',
    "",
    "/** The VAT an order's total holds at 20%, in euros rounded to cents: an order of €12.00 holds €2.00. */",
    "export const vatOf = (order) => Math.round(orderTotal(order) / 6) / 100;",
    "",
  ].join("\n"),
};

/** Bob's points as his checkout leads him to write them: `orderTotal` in euros. */
export const LOYALTY_IN_EUROS = [
  'import { orderTotal } from "./orders.js";',
  "",
  "/** One loyalty point for every whole euro of an order's total. */",
  "export const loyaltyPoints = (order) => Math.floor(orderTotal(order));",
  "",
].join("\n");

/**
 * The scripted agents of a dry run: Ana changes `orderTotal` and its uses, Bob writes his points against
 * the `orderTotal` his checkout shows, as an agent told nothing would. It checks the machinery (seeds,
 * hooks, commits, the merge, the checks and the report) and spends nothing.
 */
export async function runHiddenStub(input: {
  readonly ana: StubAgent;
  readonly bob: StubAgent;
  readonly pause: (milliseconds: number) => Promise<void>;
}) {
  const write = async (agent: StubAgent, path: string, text: string) => {
    agent.edit("PreToolUse", path);
    NodeFS.mkdirSync(NodePath.dirname(agent.file(path)), { recursive: true });
    NodeFS.writeFileSync(agent.file(path), text);
    agent.edit("PostToolUse", path);
    await input.pause(200);
  };
  input.ana.start();
  input.bob.start();
  for (const [path, text] of Object.entries(HIDDEN_ANA_FILES)) await write(input.ana, path, text);
  await write(input.bob, "src/loyalty.js", LOYALTY_IN_EUROS);
  input.ana.hook("Stop");
  input.bob.hook("Stop");
}
