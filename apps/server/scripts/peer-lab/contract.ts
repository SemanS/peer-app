// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: git and node on throwaway checkouts.
/**
 * REAL_SCENARIO=contract (design D15), the lab's measure of plan preflight. Ana's task renames the
 * method `Invoice.amount()` (dollars, a decimal number) to `amountCents()` (an integer number of
 * cents) and updates its uses; Bob's task adds an invoice total in a new file. Bob's checkout has
 * the contract as it was, so his code is right in his checkout and wrong once both branches are
 * merged, unless he knows what Ana changes before he writes it. A method, not a field: CodeGraph
 * indexes methods and the calls to them, so the code index has something to say about the change
 * (a field is no symbol of its own to it) and Impact can pair Ana's change with Bob's use. Three
 * arms run on the same seeds:
 *
 *   LAB_PLANS=off      Peer without plans and without Impact: only the file protocol.
 *   LAB_IMPACT_ONLY=1  Impact on, plans off: a changed interface is told after the change.
 *   (neither)          plans on: before the work, with Impact on as it is by default.
 *
 * LAB_CONTRACT=hard removes what the default run gives away (see HARD_TASKS): the task titles and
 * branches say nothing of cents, and both agents start together.
 *
 * After both agents finish, the lab commits what each changed, merges both branches in a scratch
 * clone and runs checks the agents never saw: Ana's branch alone (the rename was made), Bob's
 * branch alone (his total works against the old contract, or against the new one if he was told of
 * it), and the merged tree (the total works against the new contract). It reports clean
 * integration, whether Bob's code uses `amountCents`, whether either agent ran `peer plan`, and
 * the characters Peer added to each agent's context.
 *
 * Without REAL_AGENTS=1 it is a dry run: scripted stand-ins for the agents' model do what Peer's
 * words say (declare a plan when asked, amend it as a notice suggests, write against the contract
 * they heard). That checks the machinery (arms, what Peer says, merge, checks, report) and spends
 * nothing; only a run with real agents measures whether they do.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { START_WORDS } from "./plans.ts";
import { peerAdded, type HookOut, type LabEvent } from "./told.ts";

// ---- the arms ----

export type Arm = "off" | "impact" | "plans";

export const ARM_LABELS: Readonly<Record<Arm, string>> = {
  off: "plugins off: Peer without plans and without Impact",
  impact: "Impact only: a changed interface is told after the change",
  plans: "plans on: what will change is declared before the work (Impact on as by default)",
};

/** The arm the environment names: `LAB_PLANS=off`, `LAB_IMPACT_ONLY=1`, or neither. */
export function armOf(env: Readonly<Record<string, string | undefined>>): Arm {
  if (env.LAB_PLANS !== undefined && env.LAB_PLANS !== "off" && env.LAB_PLANS !== "on")
    throw new Error(`LAB_PLANS is off or on, not ${env.LAB_PLANS}`);
  const named: Arm[] = [
    ...(env.LAB_PLANS === "off" ? (["off"] as const) : []),
    ...(env.LAB_IMPACT_ONLY === "1" ? (["impact"] as const) : []),
    ...(env.LAB_PLANS === "on" ? (["plans"] as const) : []),
  ];
  if (named.length > 1)
    throw new Error(`${named.length} arms are named (${named.join(", ")}): set one of them`);
  return named[0] ?? "plans";
}

/**
 * What an arm adds to each computer's environment. The plugin switches are the operator's
 * (`PEER_PLANS=off`, `PEER_IMPACT=off`); an arm that keeps a plugin on removes the switch the lab
 * inherited, if any.
 */
export const armEnv = (arm: Arm): Record<string, string | undefined> => ({
  PEER_PLANS: arm === "plans" ? undefined : "off",
  PEER_IMPACT: arm === "off" ? "off" : undefined,
});

// ---- the seeds and the tasks ----

/** The project both agents start from: invoices in dollars. Plain ES modules, so that nothing builds. */
export const SEED: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "invoices", private: true, type: "module" })}\n`,
  "src/invoice.js": [
    "/** An invoice: what a customer owes. */",
    "export class Invoice {",
    "  /**",
    "   * @param {string} id",
    "   * @param {number} dollars what the customer owes, as a decimal number: 12.5 is twelve dollars fifty",
    "   */",
    "  constructor(id, dollars) {",
    "    this.id = id;",
    "    this.dollars = dollars;",
    "  }",
    "",
    "  /** What the customer owes, in dollars, as a decimal number: 12.5 is twelve dollars fifty. */",
    "  amount() {",
    "    return this.dollars;",
    "  }",
    "}",
    "",
  ].join("\n"),
  "src/receipt.js": [
    '/** @typedef {import("./invoice.js").Invoice} Invoice */',
    "",
    "/**",
    " * One receipt line: `#a  $12.50`.",
    " * @param {Invoice} invoice",
    " * @returns {string}",
    " */",
    "export const receiptLine = (invoice) => `#${invoice.id}  $${invoice.amount().toFixed(2)}`;",
    "",
  ].join("\n"),
  "src/summary.js": [
    '/** @typedef {import("./invoice.js").Invoice} Invoice */',
    "",
    "/**",
    " * The invoice that owes the most.",
    " * @param {Invoice[]} invoices",
    " * @returns {Invoice}",
    " */",
    "export const largest = (invoices) =>",
    "  invoices.reduce((top, one) => (one.amount() > top.amount() ? one : top));",
    "",
  ].join("\n"),
};

/** The branch each agent works on names its task, so that Peer knows which. */
export const TASKS = [
  { key: "KRK-1", title: "Invoice amounts in cents", branch: "krk-1-invoice-cents" },
  { key: "KRK-2", title: "Invoice total", branch: "krk-2-invoice-total" },
] as const;

/**
 * LAB_CONTRACT=hard: the same work, with nothing that gives Ana's change away. Peer shows the other
 * agents a task's title and its branch, so neither says anything of cents; and Bob's agent starts
 * with Ana's instead of once hers has begun to change things, so at its start nothing of hers is
 * there to see. What tells Bob of the new contract, if anything does, is then plans or Impact.
 */
export const HARD_TASKS = [
  { key: "KRK-1", title: "Invoice model tidy-up", branch: "krk-1-invoice-tidy" },
  { key: "KRK-2", title: "Invoice total", branch: "krk-2-invoice-total" },
] as const;

/** What each person asks: Ana of the change, Bob of the new code. Neither names the other, and Bob's says nothing of cents or of a method. */
export const ANA_TASK =
  "Invoice amounts move from dollars to cents. `Invoice.amount()` returns a decimal number of dollars (12.5 is twelve dollars fifty). Replace it with `amountCents()`, which returns an integer number of cents (1250), and update everything in src/ that uses it, so that receiptLine prints the same text as before. Keep the change small; do not run tests or builds.";
export const BOB_TASK =
  "Add `invoiceTotalLine(invoices)` in a new file src/total.js. It returns `Total: $` followed by the sum of the invoices' amounts with two decimals, for example `Total: $16.00`. Do not change other files. Keep the change small; do not run tests or builds.";

/** Writes the seeds into a directory. */
export function writeSeed(directory: string) {
  for (const [path, text] of Object.entries(SEED)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(directory, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(directory, path), text);
  }
}

// ---- the checks the agents never saw ----

export type Which = "provider" | "consumer-old" | "consumer-new" | "merged";
export interface Check {
  readonly ok: boolean;
  readonly kind: "pass" | "mismatch" | "missing" | "error";
  readonly detail: string;
}

/** Resolves `./x` to `./x.js`, as an agent that left the extension out expects. */
const REGISTER = [
  'import { registerHooks } from "node:module";',
  "registerHooks({",
  "  resolve(specifier, context, nextResolve) {",
  "    try {",
  "      return nextResolve(specifier, context);",
  "    } catch (error) {",
  '      if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\\.[cm]?js$/.test(specifier))',
  "        return nextResolve(`${specifier}.js`, context);",
  "      throw error;",
  "    }",
  "  },",
  "});",
  "",
].join("\n");

/**
 * What the checks ask of a tree, with invoices that are objects with the method (they do not depend on
 * how Ana's class keeps its value). `provider`: Ana replaced the method and updated its uses (receipts
 * and the largest invoice read cents). `consumer-old`: Bob's total works against the contract as it was,
 * `consumer-new` against the new one. `merged`: the provider's checks still hold and the total works
 * against the new contract.
 */
const CHECKS = [
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
  '    const { receiptLine } = await load("src/receipt.js");',
  '    expect(receiptLine({ id: "a", amountCents: () => 1250 }), "#a  $12.50", "receiptLine prints an invoice in cents");',
  '    expect(receiptLine({ id: "b", amountCents: () => 5 }), "#b  $0.05", "receiptLine keeps two decimals for a few cents");',
  '    const { largest } = await load("src/summary.js");',
  '    expect(largest([{ id: "a", amountCents: () => 100 }, { id: "b", amountCents: () => 250 }]).id, "b", "largest compares cents");',
  "  }",
  '  if (which === "consumer-old") {',
  '    const { invoiceTotalLine } = await load("src/total.js");',
  '    expect(invoiceTotalLine([{ id: "a", amount: () => 12.5 }, { id: "b", amount: () => 3.5 }]), "Total: $16.00", "the total of two invoices in dollars");',
  "  }",
  '  if (which === "consumer-new" || which === "merged") {',
  '    const { invoiceTotalLine } = await load("src/total.js");',
  '    expect(invoiceTotalLine([{ id: "a", amountCents: () => 1250 }, { id: "b", amountCents: () => 350 }]), "Total: $16.00", "the total of two invoices in cents");',
  "  }",
  '  say({ kind: "pass", detail: "passes" });',
  "} catch (error) {",
  '  if ("want" in error)',
  '    say({ kind: "mismatch", detail: `${error.message}: expected ${JSON.stringify(error.want)}, got ${JSON.stringify(error.got)}` });',
  '  say({ kind: error.code === "ERR_MODULE_NOT_FOUND" ? "missing" : "error", detail: String(error.message).split("\\n")[0] });',
  "}",
  "",
].join("\n");

/** Runs one of the checks on a tree; `work` is where the check's own files go, outside the tree. */
export function runCheck(tree: string, which: Which, work: string): Check {
  NodeFS.mkdirSync(work, { recursive: true });
  const register = NodePath.join(work, "register.mjs");
  const checks = NodePath.join(work, "checks.mjs");
  NodeFS.writeFileSync(register, REGISTER);
  NodeFS.writeFileSync(checks, CHECKS);
  const ran = NodeChildProcess.spawnSync(
    process.execPath,
    ["--import", register, checks, tree, which],
    { encoding: "utf8", timeout: 20_000, cwd: work },
  );
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

/** What the lab never counts as an agent's work: tool state in the checkout. */
const TOOL_STATE = [".codegraph/", ".claude/", ".codex/", ".peer/"];

/** The branch a checkout is on now: an agent may have left the one the lab made. */
export const currentBranch = (checkout: string) =>
  git(checkout, "rev-parse", "--abbrev-ref", "HEAD").trim();

/**
 * Keeps the state of tools (a code index, an agent's settings) out of what git shows of a checkout, so
 * that neither Peer's view of what an agent changed nor the lab's commit takes it for the agent's work.
 */
export function excludeToolState(checkout: string) {
  let path: string;
  try {
    path = git(checkout, "rev-parse", "--git-path", "info/exclude").trim();
  } catch {
    return; // not a repository: nothing shows its files
  }
  const exclude = NodePath.resolve(checkout, path);
  const known = NodeFS.existsSync(exclude) ? NodeFS.readFileSync(exclude, "utf8").split("\n") : [];
  NodeFS.mkdirSync(NodePath.dirname(exclude), { recursive: true });
  NodeFS.writeFileSync(
    exclude,
    `${[...known.filter((line) => line !== ""), ...TOOL_STATE.filter((entry) => !known.includes(entry))].join("\n")}\n`,
  );
}

/**
 * Commits what an agent changed or added in its checkout, and says which files its branch holds that
 * the origin's does not: its own commits count, and an agent that changed nothing gives none.
 */
export function commitWork(checkout: string, message: string): ReadonlyArray<string> {
  excludeToolState(checkout);
  git(checkout, "add", "-A");
  const staged = git(checkout, "diff", "--cached", "--name-only")
    .split("\n")
    .filter((file) => file !== "");
  if (staged.length > 0) git(checkout, "commit", "--quiet", "-m", message);
  return git(checkout, "diff", "--name-only", "origin/main", "HEAD")
    .split("\n")
    .filter((file) => file !== "");
}

export interface Work {
  readonly checkout: string;
  readonly branch: string;
}

/** The contract Bob's code is written against: the one his checkout had, the one Ana changes it to, or neither works. */
export type Written = "old" | "new" | "neither";

export interface Integration {
  /** Ana's branch alone: the rename was made and its uses updated. */
  readonly ana: Check;
  /** Bob's branch alone: his total works against a contract (the old one, or the new one he was told of). */
  readonly bob: Check;
  readonly written: Written;
  readonly merge: "clean" | "conflict";
  readonly conflicts: ReadonlyArray<string>;
  /** The merged tree against the new contract; none after a conflict. */
  readonly merged: Check | undefined;
  /** The branches merge without a conflict and the merged tree passes. */
  readonly clean: boolean;
  /** Bob's code names `amountCents`. */
  readonly bobUsesCents: boolean;
}

/**
 * Merges both agents' branches in a scratch clone of the origin and runs the checks: each branch
 * alone, then the merge. The agents' checkouts are only read.
 */
export function integrate(input: {
  readonly origin: string;
  readonly ana: Work;
  readonly bob: Work;
  readonly scratch: string;
}): Integration {
  const clone = NodePath.join(input.scratch, "merge");
  const work = NodePath.join(input.scratch, "checks");
  git(input.scratch, "clone", "--quiet", input.origin, clone);
  git(clone, "fetch", "--quiet", input.ana.checkout, `${input.ana.branch}:ana`);
  git(clone, "fetch", "--quiet", input.bob.checkout, `${input.bob.branch}:bob`);
  const base = git(clone, "merge-base", "ana", "bob").trim();
  git(clone, "checkout", "--quiet", "ana");
  const ana = runCheck(clone, "provider", work);
  git(clone, "checkout", "--quiet", "bob");
  const old = runCheck(clone, "consumer-old", work);
  const now = old.ok ? old : runCheck(clone, "consumer-new", work);
  const written: Written = old.ok ? "old" : now.ok ? "new" : "neither";
  const bob = old.ok
    ? old
    : now.ok
      ? now
      : { ...old, detail: `${old.detail}; and against the new contract: ${now.detail}` };
  const bobsLines = git(clone, "diff", base, "bob")
    .split("\n")
    .filter((line) => line.startsWith("+"));
  git(clone, "checkout", "--quiet", "-b", "merged", "ana");
  let conflicts: string[] = [];
  let merge: Integration["merge"] = "clean";
  try {
    git(clone, "merge", "--quiet", "--no-edit", "bob");
  } catch {
    merge = "conflict";
    conflicts = git(clone, "diff", "--name-only", "--diff-filter=U")
      .split("\n")
      .filter((file) => file !== "");
  }
  const merged = merge === "clean" ? runCheck(clone, "merged", work) : undefined;
  return {
    ana,
    bob,
    written,
    merge,
    conflicts,
    merged,
    clean: merge === "clean" && merged?.ok === true,
    bobUsesCents: bobsLines.some((line) => line.includes("amountCents")),
  };
}

// ---- what Peer said and cost ----

/** What one computer's agent ran of `peer plan`, and what Peer added to its context, from the debug log. */
export interface AgentReport {
  /** `peer plan` commands run, by how they ended. */
  readonly ran: number;
  readonly outcomes: Readonly<Record<string, number>>;
  /** The plan answers and the notices Peer gave, with their sizes in characters. */
  readonly answers: { readonly count: number; readonly chars: number };
  readonly notices: { readonly count: number; readonly chars: number };
  /** How often a session start (or a compaction) carried the line that asks for a plan. */
  readonly nudges: number;
  /** What Impact told the agent. */
  readonly impact: { readonly count: number; readonly chars: number };
  /** What Peer put into the agent's context: its hooks' answers and the commands' output. */
  readonly added: { readonly hooks: number; readonly commands: number; readonly chars: number };
  /** The sessions its computer's Peer met. */
  readonly sessions: number;
}

export function agentReport(events: ReadonlyArray<LabEvent>): AgentReport {
  const plan = events.filter((entry) => entry.event === "cli" && entry.command === "plan");
  const outcomes: Record<string, number> = {};
  for (const entry of plan) {
    const how = String(entry.outcome);
    outcomes[how] = (outcomes[how] ?? 0) + 1;
  }
  const sum = (list: ReadonlyArray<LabEvent>) =>
    list.reduce((chars, entry) => chars + (typeof entry.chars === "number" ? entry.chars : 0), 0);
  const declared = events.filter((entry) => entry.event === "plans.declared");
  const told = events.filter((entry) => entry.event === "plans.told");
  const impact = events.filter((entry) => entry.event === "impact.told");
  return {
    ran: plan.length,
    outcomes,
    answers: { count: declared.length, chars: sum(declared) },
    notices: { count: told.length, chars: sum(told) },
    nudges: events.filter((entry) => entry.event === "plans.nudged").length,
    impact: { count: impact.length, chars: sum(impact) },
    added: peerAdded(events),
    sessions: new Set(
      events
        .filter((entry) => entry.event === "session.started")
        .map((entry) => String(entry.session)),
    ).size,
  };
}

/** What the Hub's Impact view says of the project, one line a pair: what changed, by whom, and who uses it. */
export function impactLines(view: unknown): ReadonlyArray<string> {
  const records =
    typeof view === "object" && view !== null && "records" in view && Array.isArray(view.records)
      ? (view.records as ReadonlyArray<{
          readonly sides?: ReadonlyArray<{ readonly task?: string; readonly label?: string }>;
          readonly items?: ReadonlyArray<{
            readonly name: string;
            readonly path: string;
            readonly change: string;
            readonly from?: ReadonlyArray<{ readonly name: string }>;
          }>;
        }>)
      : [];
  if (records.length === 0) return ["Impact at the Hub: no pair of works"];
  return [
    `Impact at the Hub: ${records.length} pair${records.length === 1 ? "" : "s"} of works`,
    ...records.map(
      (record) =>
        `  ${(record.sides ?? []).map((side) => side.task ?? side.label ?? "?").join(" and ")}: ${(
          record.items ?? []
        )
          .map(
            (item) =>
              `${item.change} ${item.name} (${item.path}), used by ${(item.from ?? []).map((use) => use.name).join(", ") || "nobody listed"}`,
          )
          .join("; ")}`,
    ),
  ];
}

export interface ContractResult {
  readonly arm: Arm;
  readonly dry: boolean;
  readonly integration: Integration;
  readonly ana: AgentReport;
  readonly bob: AgentReport;
}

const yes = (flag: boolean) => (flag ? "yes" : "no");

/** What plans cost an agent's context: the start line, the answers it read and the notices it heard. */
export const plansChars = (report: AgentReport) =>
  report.nudges * START_WORDS.length + report.answers.chars + report.notices.chars;

/** The result as the lab prints it, one fact to a line. */
export function formatResult(result: ContractResult): ReadonlyArray<string> {
  const { arm, integration: one, ana, bob } = result;
  const ran = (report: AgentReport) =>
    report.ran === 0
      ? "no"
      : `yes, ${report.ran} time${report.ran === 1 ? "" : "s"} (${Object.entries(report.outcomes)
          .map(([how, count]) => `${how} ${count}`)
          .join(", ")})`;
  const added = (report: AgentReport) =>
    `${report.added.chars} characters (hooks ${report.added.hooks}, commands ${report.added.commands}). Of them plans: ${plansChars(report)} (start line ${report.nudges * START_WORDS.length}, answers ${report.answers.chars} in ${report.answers.count}, notices ${report.notices.chars} in ${report.notices.count}); Impact: ${report.impact.chars} in ${report.impact.count} notices`;
  return [
    `arm: ${arm} (${ARM_LABELS[arm]})${result.dry ? " · dry run: scripted stand-ins for the model" : ""}`,
    `clean integration: ${yes(one.clean)} (merge ${one.merge}${one.conflicts.length > 0 ? `: ${one.conflicts.join(", ")}` : ""}; merged tree: ${one.merged === undefined ? "not run" : one.merged.ok ? "passes" : one.merged.detail})`,
    `Ana's branch alone: ${one.ana.ok ? "renamed as asked" : `NOT as asked: ${one.ana.detail}`}`,
    `Bob's branch alone: ${one.bob.ok ? `written against the ${one.written} contract (${one.written === "old" ? "amount(), dollars" : "amountCents()"})` : `works against NEITHER contract: ${one.bob.detail}`}`,
    `Bob's code uses amountCents: ${yes(one.bobUsesCents)}`,
    `Ana's agent ran peer plan: ${ran(ana)}`,
    `Bob's agent ran peer plan: ${ran(bob)}`,
    `Peer added to Ana's agent: ${added(ana)}`,
    `Peer added to Bob's agent: ${added(bob)}`,
  ];
}

// ---- the stand-ins for the agents' model, for a dry run ----

/** What the scripted agents need of the lab's simulated agent. */
export interface StubAgent {
  readonly name: string;
  readonly file: (path: string) => string;
  readonly start: () => { readonly told: string | undefined };
  readonly hook: (event: string, extra?: Record<string, unknown>) => HookOut;
  readonly edit: (event: "PreToolUse" | "PostToolUse", path: string) => HookOut;
  readonly peer: (...args: string[]) => string;
}

/** What an agent hears from a hook, as text. */
export const textsOf = (out: HookOut): ReadonlyArray<string> =>
  [
    out?.hookSpecificOutput?.additionalContext,
    out?.hookSpecificOutput?.permissionDecisionReason,
  ].filter((text): text is string => typeof text === "string");

/** Whether Peer asked for a plan: the line every session start carries while plans are on. */
export const asksForPlan = (heard: ReadonlyArray<string>) =>
  heard.some((text) => text.includes("peer plan --change"));

/** The command a plan notice suggests for the contract of what the other work uses, when one does. */
export function suggestedContract(heard: ReadonlyArray<string>) {
  for (const text of heard) {
    const found = /peer plan --amend --provides "([^"\s]+) \(([^)]+)\): <contract>"/.exec(text);
    if (found?.[1] !== undefined && found[2] !== undefined)
      return { symbol: found[1], path: found[2] };
  }
  return undefined;
}

/** Whether what an agent heard names the new contract. */
export const heardNewContract = (heard: ReadonlyArray<string>) =>
  heard.some((text) => text.includes("amountCents"));

/** The plans the scripted agents declare when Peer asks: what each changes, uses and provides. */
export const ANA_PLAN = [
  "plan",
  "--change",
  "src/invoice.js#Invoice.amount",
  "--change",
  "src/receipt.js",
  "--change",
  "src/summary.js",
  "--provides",
  "Invoice.amountCents (src/invoice.js): an integer number of cents, replaces Invoice.amount",
] as const;
export const BOB_PLAN = [
  "plan",
  "--change",
  "src/total.js",
  "--uses",
  "src/invoice.js#Invoice.amount",
] as const;

/**
 * The contract line for what Bob's plan uses, as Ana writes it when a notice says to. It has no `$`:
 * a command with one inside double quotes is not plain (the shell would expand it), so Peer does not
 * let it through without asking.
 */
export const contractFor = (symbol: string) =>
  `${symbol} is now amountCents(), an integer number of cents (1250 is twelve dollars fifty); it was dollars`;

/** The code Ana's scripted agent writes: the replacement of the method, and its uses. */
export const ANA_FILES: Readonly<Record<string, string>> = {
  "src/invoice.js": [
    "/** An invoice: what a customer owes. */",
    "export class Invoice {",
    "  /**",
    "   * @param {string} id",
    "   * @param {number} cents what the customer owes, as an integer: 1250 is twelve dollars fifty",
    "   */",
    "  constructor(id, cents) {",
    "    this.id = id;",
    "    this.cents = cents;",
    "  }",
    "",
    "  /** What the customer owes, in cents, as an integer: 1250 is twelve dollars fifty. */",
    "  amountCents() {",
    "    return this.cents;",
    "  }",
    "}",
    "",
  ].join("\n"),
  "src/receipt.js": [
    '/** @typedef {import("./invoice.js").Invoice} Invoice */',
    "",
    "/**",
    " * One receipt line: `#a  $12.50`.",
    " * @param {Invoice} invoice",
    " * @returns {string}",
    " */",
    "export const receiptLine = (invoice) =>",
    "  `#${invoice.id}  $${(invoice.amountCents() / 100).toFixed(2)}`;",
    "",
  ].join("\n"),
  "src/summary.js": [
    '/** @typedef {import("./invoice.js").Invoice} Invoice */',
    "",
    "/**",
    " * The invoice that owes the most.",
    " * @param {Invoice[]} invoices",
    " * @returns {Invoice}",
    " */",
    "export const largest = (invoices) =>",
    "  invoices.reduce((top, one) => (one.amountCents() > top.amountCents() ? one : top));",
    "",
  ].join("\n"),
};
/**
 * Ana's first edit of the class: the new method beside the old one, which goes in her last edit, once its
 * callers use the new. Impact sees a removal only when it checked the file before the edit that makes it
 * (a rewrite in one edit shows it the new method and no removal), so a careful migration like this is
 * the one it can pair with a use of the old method.
 */
export const ANA_INVOICE_BEFORE_REMOVAL = [
  "/** An invoice: what a customer owes. */",
  "export class Invoice {",
  "  /**",
  "   * @param {string} id",
  "   * @param {number} cents what the customer owes, as an integer: 1250 is twelve dollars fifty",
  "   */",
  "  constructor(id, cents) {",
  "    this.id = id;",
  "    this.cents = cents;",
  "  }",
  "",
  "  /** What the customer owes, in cents, as an integer: 1250 is twelve dollars fifty. */",
  "  amountCents() {",
  "    return this.cents;",
  "  }",
  "",
  "  /** What the customer owes, in dollars: to go once nothing calls it. */",
  "  amount() {",
  "    return this.cents / 100;",
  "  }",
  "}",
  "",
].join("\n");

/** Bob's total, written against the contract he had, and against the one he was told of. */
export const TOTAL_IN_DOLLARS = [
  "/** The total line of some invoices: `Total: $16.00`. */",
  "export const invoiceTotalLine = (invoices) =>",
  "  `Total: $${invoices.reduce((sum, invoice) => sum + invoice.amount(), 0).toFixed(2)}`;",
  "",
].join("\n");
export const TOTAL_IN_CENTS = [
  "/** The total line of some invoices: `Total: $16.00`. */",
  "export const invoiceTotalLine = (invoices) =>",
  "  `Total: $${(invoices.reduce((sum, invoice) => sum + invoice.amountCents(), 0) / 100).toFixed(2)}`;",
  "",
].join("\n");

export interface StubInput {
  readonly ana: StubAgent;
  readonly bob: StubAgent;
  readonly arm: Arm;
  readonly pause: (milliseconds: number) => Promise<void>;
  readonly told: (who: string, text: string | null | undefined) => void;
  /** Run after each file an agent writes: where a code index is kept, it is brought up to date. */
  readonly afterEdit?: () => void;
  /** Run when the agents are done and have not ended their sessions: Impact clears a session's footprint when it ends. */
  readonly beforeEnd?: () => Promise<void>;
  /**
   * Gives Impact the time it needs, and listens: it checks a session five seconds after an edit and a session
   * at most every twenty, and sees a removal only when it checked the file before the edit that makes it. So
   * Ana waits for its first check before she removes the old method, and each agent then takes steps for up
   * to thirty seconds to hear what Impact says of it. They only listen: what Impact told them is in the
   * log, and the agents change nothing for it. The steps they take add to what Peer is counted to have said,
   * so a dry run's sizes are those of the run without this.
   */
  readonly watchImpact?: boolean;
}

/**
 * Ana's and Bob's scripted agents, in the order real ones would act: Ana starts and changes the
 * contract; Bob starts a moment later and writes his total; each takes a step now and then, where
 * Peer may speak. They do what Peer's words say and nothing Peer did not say: declare a plan when
 * asked, amend it as the notice that Bob uses what Ana changes suggests, and write against the
 * contract they have heard (the one they have, otherwise).
 */
export async function runStub(input: StubInput) {
  const { ana, bob, pause, told } = input;
  const heard = { ana: [] as string[], bob: [] as string[] };
  const hear = (who: "ana" | "bob", texts: ReadonlyArray<string> | string | undefined) => {
    heard[who].push(...(typeof texts === "string" ? [texts] : (texts ?? [])));
  };
  const write = (agent: StubAgent, path: string, text: string) => {
    const before = agent.edit("PreToolUse", path);
    if (before?.hookSpecificOutput?.permissionDecision === "deny")
      throw new Error(`${agent.name} was stopped before it edited ${path}`);
    NodeFS.mkdirSync(NodePath.dirname(agent.file(path)), { recursive: true });
    NodeFS.writeFileSync(agent.file(path), text);
    input.afterEdit?.();
    return agent.edit("PostToolUse", path);
  };
  /** Steps (a prompt each) until `done`, for up to `tries` quarter seconds: where the news of the Hub reaches an agent. */
  const stepsUntil = async (
    agent: StubAgent,
    who: "ana" | "bob",
    done: () => boolean,
    tries = 80,
  ) => {
    for (let step = 0; step < tries && !done(); step += 1) {
      hear(who, textsOf(agent.hook("UserPromptSubmit", { prompt: "continue" })));
      if (!done()) await pause(250);
    }
    return done();
  };

  hear("ana", ana.start().told);
  hear("ana", textsOf(ana.hook("UserPromptSubmit", { prompt: ANA_TASK })));
  if (asksForPlan(heard.ana)) {
    const answer = ana.peer(...ANA_PLAN);
    told(`${ana.name} (peer plan)`, answer);
    hear("ana", answer);
  }
  hear("ana", textsOf(write(ana, "src/invoice.js", ANA_INVOICE_BEFORE_REMOVAL)));
  // Bob's person asks a moment later.
  await pause(1500);
  hear("bob", bob.start().told);
  hear("bob", textsOf(bob.hook("UserPromptSubmit", { prompt: BOB_TASK })));
  if (asksForPlan(heard.bob)) {
    const answer = bob.peer(...BOB_PLAN);
    told(`${bob.name} (peer plan)`, answer);
    hear("bob", answer);
  }
  // Each agent takes a step. Where plans are on, Ana waits for the news that Bob uses what she changes
  // and does what it suggests; Bob waits for the contract that follows.
  if (input.arm === "plans") {
    await stepsUntil(ana, "ana", () => suggestedContract(heard.ana) !== undefined);
    const suggestion = suggestedContract(heard.ana);
    if (suggestion !== undefined) {
      const answer = ana.peer(
        "plan",
        "--amend",
        "--provides",
        `${suggestion.symbol} (${suggestion.path}): ${contractFor(suggestion.symbol)}`,
      );
      told(`${ana.name} (peer plan --amend)`, answer);
      hear("ana", answer);
      await stepsUntil(bob, "bob", () => heardNewContract(heard.bob));
    }
  } else {
    hear("ana", textsOf(ana.hook("UserPromptSubmit", { prompt: "continue" })));
    hear("bob", textsOf(bob.hook("UserPromptSubmit", { prompt: "continue" })));
  }
  hear(
    "bob",
    textsOf(
      write(bob, "src/total.js", heardNewContract(heard.bob) ? TOTAL_IN_CENTS : TOTAL_IN_DOLLARS),
    ),
  );
  // Her callers move to the new method, and the old one goes last.
  if (input.watchImpact === true) await pause(8000);
  for (const [path, text] of Object.entries(ANA_FILES))
    if (path !== "src/invoice.js") hear("ana", textsOf(write(ana, path, text)));
  hear("ana", textsOf(write(ana, "src/invoice.js", ANA_FILES["src/invoice.js"]!)));
  if (input.watchImpact === true)
    for (const [agent, who] of [
      [ana, "ana"],
      [bob, "bob"],
    ] as const)
      await stepsUntil(
        agent,
        who,
        () => heard[who].some((text) => text.includes("impact (advice)")),
        120,
      );
  await input.beforeEnd?.();
  for (const agent of [ana, bob]) agent.hook("SessionEnd", { reason: "exit" });
  return heard;
}

// ---- the code index the Impact arm reads ----

/**
 * Indexes a checkout with CodeGraph, which Impact reads and the lab does not otherwise make: `init`
 * then `index`, the lab's own checkout being a throwaway. Says why when it could not. An index that
 * is behind the agents' edits is one Impact will not read, so `syncCheckout` brings it up to date.
 */
export function indexCheckout(
  binary: string,
  root: string,
): { readonly ok: boolean; readonly detail: string } {
  excludeToolState(root);
  for (const args of [
    ["init", root],
    ["index", root],
  ]) {
    const ran = NodeChildProcess.spawnSync(binary, args, {
      encoding: "utf8",
      timeout: 120_000,
      cwd: root,
    });
    if (ran.status !== 0)
      return {
        ok: false,
        detail: `codegraph ${args[0]} ended ${ran.status ?? ran.error?.message ?? "without a status"}: ${`${ran.stderr}${ran.stdout}`.trim().split("\n").at(-1) ?? ""}`,
      };
  }
  return { ok: true, detail: "indexed" };
}

/** Brings a checkout's index up to date with the files its agent changed; false when it could not. */
export function syncCheckout(binary: string, root: string): boolean {
  return (
    NodeChildProcess.spawnSync(binary, ["sync", root], {
      encoding: "utf8",
      timeout: 30_000,
      cwd: root,
    }).status === 0
  );
}
