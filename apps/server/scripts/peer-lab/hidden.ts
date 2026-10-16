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
 *
 * LAB_CONTRACT=deferred is the hidden seed with one change to Bob's task: he is told to compute his points
 * from `orderTotal(order)` and to keep his branch right with the code it has (the situation of a failed
 * real run, made the rule). What a careful Bob learns of Ana's change then belongs to whoever lands both
 * branches, so `LAB_INTEGRATE=1` (implied by `deferred`) adds the step that measures it: after both agents
 * finish, a fresh session on Ana's computer, on KRK-1, is asked to merge Bob's branch into hers and push it,
 * and the lab runs its checks on what was pushed. The arms are the default (agreements on),
 * `LAB_AGREEMENTS=off` and `LAB_PEER=off`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ANSWER,
  QUESTION,
  agreementWords,
  agreementsGiven,
  wasGiven,
  type AgreementsGiven,
} from "./agreements.ts";
import {
  ARM_LABELS,
  currentBranch,
  plansChars,
  textsOf,
  type AgentReport,
  type Arm,
  type Check,
  type StubAgent,
  type Work,
} from "./contract.ts";
import { peerAdded, plainSession, type LabEvent } from "./told.ts";

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

/**
 * Bob's task in `LAB_CONTRACT=deferred`: his points are computed from `orderTotal(order)`, and his branch must stay
 * right with the code it has. As in the hidden run, nothing in it names the dependency: no unit, no teammate, no task.
 */
export const DEFERRED_BOB_TASK =
  "Add `loyaltyPoints(order)` in a new file src/loyalty.js, computed from `orderTotal(order)`: a customer earns one point for every whole euro of the order's total, so an order that comes to 12.50 euros earns 12 points. Your branch must stay right with the code it has. Do not change other files. Keep the change small; do not run tests or builds.";

/** Writes the seeds into a directory. */
export function writeHiddenSeed(directory: string) {
  for (const [path, text] of Object.entries(HIDDEN_SEED)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(directory, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(directory, path), text);
  }
}

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
  /** Bob's code calls `orderTotal()`, building on its contract, rather than summing the order itself. */
  readonly bobCallsOrderTotal: boolean;
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
  // What Bob's added code calls, his comments left out.
  const bobsCode = bobsLines
    .map((line) => line.slice(1).replace(/\/\/.*$/, ""))
    .filter((line) => !/^\s*(\/\*|\*)/.test(line));
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
    bobCallsOrderTotal: bobsCode.some((line) => /\borderTotal\s*\(/.test(line)),
  };
}

/**
 * What the fresh session is asked, in the words of a person. `quick` (LAB_INTEGRATE_ASK=quick) is a hasty merge that
 * does not ask it to make sure the result works, as many integrations are asked.
 */
export const integratePrompt = (branch: string, quick = false) =>
  quick
    ? `Merge ${branch} into your branch and push it.`
    : `Merge ${branch} into your branch, make sure it works, and push it.`;

/** The branches of a bare repository and where each stands. */
function originRefs(origin: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    git(origin, "for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [sha = "", ...ref] = line.split(" ");
        return [ref.join(" "), sha] as const;
      }),
  );
}

/** Whether a git command ends well; its output is not wanted. */
const succeeds = (cwd: string, ...args: string[]) =>
  NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" }).status === 0;

/** Where the branches were when the integration began, before anyone merged anything. */
export interface IntegrationStart {
  readonly tips: { readonly ana: string; readonly bob: string };
  /** The name Bob's work was made reachable under in Ana's checkout: his task's own branch. */
  readonly branch: string;
  /** Ana's branch, the one the fresh session is on. */
  readonly anaBranch: string;
  /** The branches of the origin before the session pushed anything. */
  readonly refs: Readonly<Record<string, string>>;
}

/**
 * Takes the snapshot of the integration and prepares Ana's checkout for the session that merges. It
 * comes after `integrateHidden` has judged both branches as they are, because once Ana's branch holds
 * Bob's commits, "Ana alone" and the merge base are no longer what they were. Bob's branch is fetched
 * into Ana's checkout under his task's name, as a person who merges would have it; and the checkout
 * gets an identity of the lab, because herdr keeps HOME and a commit made there would otherwise carry
 * the operator's, signed or not.
 */
export function startIntegration(input: {
  readonly origin: string;
  readonly ana: Work;
  readonly bob: Work;
}): IntegrationStart {
  const tips = {
    ana: git(input.ana.checkout, "rev-parse", "HEAD").trim(),
    bob: git(input.bob.checkout, "rev-parse", "HEAD").trim(),
  };
  const branch = HIDDEN_TASKS[1].branch;
  git(
    input.ana.checkout,
    "fetch",
    "--quiet",
    input.bob.checkout,
    `+${input.bob.branch}:refs/heads/${branch}`,
  );
  for (const [key, value] of [
    ["user.name", "Ana"],
    ["user.email", "ana@acme.test"],
    ["commit.gpgsign", "false"],
  ] as const)
    git(input.ana.checkout, "config", key, value);
  return {
    tips,
    branch,
    anaBranch: currentBranch(input.ana.checkout),
    refs: originRefs(input.origin),
  };
}

/** What Ana's checkout holds once the fresh session is done. */
export interface IntegratorMerge {
  readonly head: string;
  readonly branch: string;
  /** Bob's tip is in the history of its head. */
  readonly bobMerged: boolean;
  /** A merge is still going on (`MERGE_HEAD`). */
  readonly inProgress: boolean;
  /** Nothing is left uncommitted or untracked. */
  readonly clean: boolean;
}

export interface IntegrationFinish {
  readonly merge: IntegratorMerge;
  /** The branch of the origin that took what the session pushed, and where it stands. */
  readonly pushed: { readonly ref: string; readonly sha: string } | undefined;
  /** The merged checks on a clone of what was pushed; none when nothing was pushed. */
  readonly tree: Check | undefined;
}

/**
 * Reads what the session left: its checkout (the merge landed when Bob's tip is in its history, no
 * merge is going on and nothing is uncommitted), the branch of the origin that moved (the session's
 * own when it pushed that, else one that holds Bob's tip, else whichever moved), and the merged checks
 * on a clone of it.
 */
export function finishIntegration(input: {
  readonly origin: string;
  readonly ana: Work;
  readonly start: IntegrationStart;
  readonly scratch: string;
}): IntegrationFinish {
  const { origin, start } = input;
  const checkout = input.ana.checkout;
  const merge: IntegratorMerge = {
    head: git(checkout, "rev-parse", "HEAD").trim(),
    branch: currentBranch(checkout),
    bobMerged: succeeds(checkout, "merge-base", "--is-ancestor", start.tips.bob, "HEAD"),
    inProgress: succeeds(checkout, "rev-parse", "-q", "--verify", "MERGE_HEAD"),
    clean: git(checkout, "status", "--porcelain").trim() === "",
  };
  const changed = Object.entries(originRefs(origin)).filter(
    ([ref, sha]) => start.refs[ref] !== sha,
  );
  const found =
    changed.find(([ref]) => ref === merge.branch) ??
    changed.find(([, sha]) =>
      succeeds(origin, "merge-base", "--is-ancestor", start.tips.bob, sha),
    ) ??
    changed[0];
  const pushed = found === undefined ? undefined : { ref: found[0], sha: found[1] };
  if (pushed === undefined) return { merge, pushed, tree: undefined };
  const clone = NodePath.join(input.scratch, "pushed");
  NodeFS.rmSync(clone, { recursive: true, force: true });
  git(input.scratch, "clone", "--quiet", origin, clone);
  git(clone, "checkout", "--quiet", pushed.ref);
  return {
    merge,
    pushed,
    tree: runHiddenCheck(clone, "merged", NodePath.join(input.scratch, "pushed-checks")),
  };
}

/** What the integration step found, for the report and for the result the lab prints as JSON. */
export interface IntegratorReport {
  readonly tips: IntegrationStart["tips"];
  /** The agreements the Hub holds for Ana's and Bob's tasks that are not closed. */
  readonly kept: number;
  /** The sessions the fresh agent ran as, as Ana's log names them. */
  readonly sessions: ReadonlyArray<string>;
  /** What Peer gave those sessions of agreements, from Ana's debug log. */
  readonly given: AgreementsGiven;
  readonly merge: IntegratorMerge;
  readonly pushed: IntegrationFinish["pushed"];
  readonly tree: Check | undefined;
  /** What Peer added to their context, in characters. */
  readonly added: { readonly hooks: number; readonly commands: number; readonly chars: number };
}

export function integratorReport(input: {
  readonly start: IntegrationStart;
  readonly finish: IntegrationFinish;
  /** Ana's debug log. */
  readonly events: ReadonlyArray<LabEvent>;
  readonly sessions: ReadonlyArray<string>;
  readonly kept: number;
}): IntegratorReport {
  const each = input.sessions.map((one) => peerAdded(input.events, plainSession(one)));
  const total = (field: "hooks" | "commands" | "chars") =>
    each.reduce((sum, one) => sum + one[field], 0);
  return {
    tips: input.start.tips,
    kept: input.kept,
    sessions: input.sessions,
    given: agreementsGiven(input.events, input.sessions),
    merge: input.finish.merge,
    pushed: input.finish.pushed,
    tree: input.finish.tree,
    added: { hooks: total("hooks"), commands: total("commands"), chars: total("chars") },
  };
}

/** The merge landed: Bob's work is in the session's branch, nothing is half done, and it was pushed. */
export const landed = (one: IntegratorReport) =>
  one.merge.bobMerged && !one.merge.inProgress && one.merge.clean && one.pushed !== undefined;

export interface HiddenResult {
  readonly arm: Arm;
  readonly dry: boolean;
  readonly integration: HiddenIntegration;
  readonly ana: AgentReport;
  readonly bob: AgentReport;
  /** The integration step, when it ran. */
  readonly integrator?: IntegratorReport | undefined;
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
    `Bob's code calls orderTotal(): ${yes(one.bobCallsOrderTotal)}`,
    `Ana's agent ran peer plan: ${ran(ana)}`,
    `Bob's agent ran peer plan: ${ran(bob)}`,
    `Peer added to Ana's agent: ${added(ana)}`,
    `Peer added to Bob's agent: ${added(bob)}`,
    ...(result.integrator === undefined ? [] : integratorLines(result.integrator)),
  ];
}

/** Where in the integrator's session an agreement reached it. */
const reached = (carried: AgreementsGiven["carried"]) =>
  [
    ...new Set(
      carried.map((one) =>
        one.stop
          ? "in the reason of a landing stop"
          : one.hookEvent === "UserPromptSubmit"
            ? "in the context of its prompt"
            : `in the context of a ${one.hookEvent} hook`,
      ),
    ),
  ].join(" and ");

/** What the integration step found, one fact to a line. */
export function integratorLines(one: IntegratorReport): ReadonlyArray<string> {
  const { given, merge, pushed, tree } = one;
  const times = (count: number) => `${count} time${count === 1 ? "" : "s"}`;
  const problems = [
    ...(merge.bobMerged ? [] : ["Bob's tip is not in its history"]),
    ...(merge.inProgress ? ["a merge is still going on"] : []),
    ...(merge.clean ? [] : ["files are left uncommitted"]),
    ...(pushed === undefined ? ["nothing was pushed"] : []),
  ];
  return [
    `the agents settled an agreement at the Hub: ${one.kept === 0 ? "no" : `yes (${one.kept})`}`,
    `the integrator (a fresh session on Ana's computer, on KRK-1; ${one.sessions.length} session${one.sessions.length === 1 ? "" : "s"}) was given the agreement: ${
      wasGiven(given)
        ? `yes (told ${times(given.told.count)}, ${given.told.chars} characters, ${reached(given.carried)}; landing steps stopped for messages: ${given.stops.count})`
        : `NO (told ${times(given.told.count)}; landing steps stopped for messages: ${given.stops.count})`
    }`,
    `the integrator's merge: ${problems.length === 0 ? "landed (Bob's tip is in its history, no merge is going on, nothing is left uncommitted, and it was pushed)" : `NOT landed: ${problems.join("; ")}`}`,
    `the integrator pushed: ${pushed === undefined ? "nothing" : `${pushed.ref} at ${pushed.sha.slice(0, 10)}`}`,
    `the pushed tree: ${tree === undefined ? "not checked: nothing was pushed" : tree.ok ? "right (the merged checks pass: 12.50 euros earn 12 points, the receipt and VAT as before)" : `NOT right: ${tree.detail}`}`,
    `Peer added to the integrator: ${one.added.chars} characters (hooks ${one.added.hooks}, commands ${one.added.commands}); of them agreements: ${given.told.chars}`,
  ];
}

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

/** What Bob's scripted agent settles with: his branch stays right as it is, and the change waits for whoever lands both. */
export const DEFERRAL_WORDS =
  "Loyalty keeps euros; src/loyalty.js divides orderTotal by 100 once KRK-1 lands";

/** Bob's points once `orderTotal` returns cents: what a session that knows of Ana's change puts right. */
export const LOYALTY_IN_CENTS = [
  'import { orderTotal } from "./orders.js";',
  "",
  "/** One loyalty point for every whole euro; orderTotal returns integer cents. */",
  "export const loyaltyPoints = (order) => Math.floor(orderTotal(order) / 100);",
  "",
].join("\n");

/** How a scripted agent reads the words of an agreement: whether they say the points are divided by a hundred. */
export const saysDivideByHundred = (words: string) => /\bdivid\w*\b[^.;]*\bby 100\b/i.test(words);

/** What the deferred stand-ins ask of the lab's simulated agent beyond the contract's: its exit status and its wait. */
export interface DeferredAgent extends StubAgent {
  readonly peerStatus: number;
  readonly idle: () => Promise<string | null>;
}

export interface DeferredStubInput {
  readonly ana: DeferredAgent;
  readonly bob: DeferredAgent;
  readonly pause: (milliseconds: number) => Promise<void>;
  readonly told: (who: string, text: string | null | undefined) => void;
  /** Whether Ana's computer has registered the wait of her idle agent. */
  readonly waiting: () => boolean;
}

/**
 * The scripted agents of the deferred dry run, who do what Peer's words say. Ana changes `orderTotal` and
 * its uses, and idles. Bob writes his points for the `orderTotal` his checkout has: if Peer offers him
 * `peer ask` he asks KRK-1 about it, hears her answer (cents), and settles the overlap with words that
 * defer the change to whoever lands both; with no Peer he writes and leaves. They end their sessions.
 * It checks the machinery (the ask, the settle, the agreement the Hub keeps) and spends nothing.
 */
export async function runDeferredStub(input: DeferredStubInput) {
  const { ana, bob, pause, told } = input;
  const heard = { ana: [] as string[], bob: [] as string[] };
  const hear = (who: "ana" | "bob", texts: ReadonlyArray<string | null | undefined>) => {
    for (const text of texts)
      if (text !== undefined && text !== null && text !== "") heard[who].push(text);
  };
  const write = async (agent: StubAgent, who: "ana" | "bob", path: string, text: string) => {
    hear(who, textsOf(agent.edit("PreToolUse", path)));
    NodeFS.mkdirSync(NodePath.dirname(agent.file(path)), { recursive: true });
    NodeFS.writeFileSync(agent.file(path), text);
    hear(who, textsOf(agent.edit("PostToolUse", path)));
    await pause(200);
  };

  hear("ana", [ana.start().told]);
  hear("bob", [bob.start().told]);
  hear("ana", textsOf(ana.hook("UserPromptSubmit", { prompt: HIDDEN_ANA_TASK })));
  hear("bob", textsOf(bob.hook("UserPromptSubmit", { prompt: DEFERRED_BOB_TASK })));
  for (const [path, text] of Object.entries(HIDDEN_ANA_FILES)) await write(ana, "ana", path, text);

  // Peer's words: whether it offers Bob a question to the agents of another task.
  const offered = heard.bob.some((text) => text.includes("peer ask <task>"));
  let answered = false;
  if (offered) {
    const woken = ana.idle();
    for (let step = 0; step < 80 && !input.waiting(); step += 1) await pause(250);
    let asked = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      asked = bob.peer("ask", HIDDEN_TASKS[0].key, QUESTION);
      if (bob.peerStatus === 0) break;
      await pause(500);
    }
    told(`${bob.name} (peer ask ${HIDDEN_TASKS[0].key})`, asked);
    if (bob.peerStatus !== 0) throw new Error(`Bob's scripted agent could not ask: ${asked}`);
    hear("ana", [await Promise.race([woken, pause(15_000).then(() => null)])]);
    hear("ana", [ana.peer("note", ANSWER)]);
    for (let step = 0; step < 80 && !answered; step += 1) {
      hear("bob", textsOf(bob.hook("UserPromptSubmit", { prompt: "continue" })));
      answered = heard.bob.some((text) => text.includes(ANSWER));
      if (!answered) await pause(250);
    }
    if (!answered) throw new Error("Bob's scripted agent did not hear Ana's answer within 20 s");
  }
  // His branch must stay right with the code it has: euros.
  await write(bob, "bob", "src/loyalty.js", LOYALTY_IN_EUROS);
  if (answered) {
    const settled = bob.peer("resolve", DEFERRAL_WORDS);
    told(`${bob.name} (peer resolve)`, settled);
    if (bob.peerStatus !== 0) throw new Error(`Bob's scripted agent could not settle: ${settled}`);
  }
  for (const agent of [ana, bob]) agent.hook("SessionEnd", { reason: "exit" });
  return heard;
}

export interface IntegratorStubInput {
  /** The fresh session on Ana's computer. */
  readonly integrator: StubAgent;
  /** Ana's checkout, which Bob's branch was made reachable in. */
  readonly checkout: string;
  /** Bob's branch as that checkout has it. */
  readonly branch: string;
  readonly told: (who: string, text: string | null | undefined) => void;
}

/**
 * The scripted integrator of the dry run: asked to merge Bob's branch and push, it merges, makes sure it
 * works by what Peer told it, and pushes. If that says the points are to be divided by a hundred, it puts
 * Bob's file right and commits, whether it read so at its prompt or in the stop of a landing step (a
 * stop is read and the same step again runs, as an agent would). With nothing told of any agreement it
 * makes sure of nothing, which is what an agent that never heard of the change does, and the pushed tree
 * shows it.
 */
export async function runIntegratorStub(input: IntegratorStubInput) {
  const { integrator, checkout, branch, told } = input;
  const heard: string[] = [];
  const hear = (...texts: ReadonlyArray<string | null | undefined>) => {
    for (const text of texts)
      if (text !== undefined && text !== null && text !== "") heard.push(text);
  };
  /**
   * A shell command as the agent's Bash tool runs it: its hook first. A stop is read, the agent takes
   * it into account (`afterStop`), and the same command again runs.
   */
  const run = (command: string, afterStop?: () => void) => {
    const call = { tool_name: "Bash", tool_input: { command } };
    let before = integrator.hook("PreToolUse", call);
    for (let tries = 0; before?.hookSpecificOutput?.permissionDecision === "deny"; tries += 1) {
      if (tries === 3)
        throw new Error(
          `the scripted integrator was stopped for good at ${command}: ${textsOf(before).join(" ")}`,
        );
      hear(...textsOf(before));
      afterStop?.();
      before = integrator.hook("PreToolUse", call);
    }
    hear(...textsOf(before));
    NodeChildProcess.execFileSync("sh", ["-c", command], {
      cwd: checkout,
      encoding: "utf8",
      stdio: "pipe",
    });
    hear(...textsOf(integrator.hook("PostToolUse", call)));
  };

  hear(integrator.start().told);
  const prompt = integratePrompt(branch);
  const asked = textsOf(integrator.hook("UserPromptSubmit", { prompt }));
  hear(...asked);
  told(
    `the integrator, a fresh session of ${integrator.name.replace(/ agent$/, "")} computer (asked: ${prompt})`,
    agreementWords(asked)
      .map((words) => `an agreement: ${words}`)
      .join("\n") || null,
  );
  run(`git merge --no-edit ${branch}`);
  // "Make sure it works": by what it has been told of the merge, once.
  let divided = false;
  const makeSure = () => {
    if (divided || !agreementWords(heard).some(saysDivideByHundred)) return;
    divided = true;
    const path = "src/loyalty.js";
    hear(...textsOf(integrator.edit("PreToolUse", path)));
    NodeFS.writeFileSync(integrator.file(path), LOYALTY_IN_CENTS);
    hear(...textsOf(integrator.edit("PostToolUse", path)));
    run("git add -A");
    run('git commit -m "Loyalty points: orderTotal returns cents now, divide by 100"');
  };
  makeSure();
  run(`git push --set-upstream origin ${currentBranch(checkout)}`, makeSure);
  integrator.hook("SessionEnd", { reason: "exit" });
  return { heard, divided };
}
