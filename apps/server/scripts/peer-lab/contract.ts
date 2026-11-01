// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: git and node on throwaway checkouts.
/**
 * REAL_SCENARIO=contract (design D15). Ana's task renames the
 * method `Invoice.amount()` (dollars, a decimal number) to `amountCents()` (an integer number of
 * cents) and updates its uses; Bob's task adds an invoice total in a new file. Bob's checkout has
 * the contract as it was, so his code is right in his checkout and wrong once both branches are
 * merged, unless he knows what Ana changes before he writes it. The arms run on the same seeds:
 *
 *   LAB_PEER=off       No Peer: coordination is off for the agents.
 *   LAB_KERNEL=1       Only the kernel: every Hub feature and plugin outside presence, messages,
 *                      rooms and the agents' adapters is off (KERNEL_FEATURES_OFF, KERNEL_PLUGINS_OFF).
 *   (none of them)     Peer as it is.
 *
 * LAB_CONTRACT=hard removes what the default run gives away (see HARD_TASKS): the task titles and
 * branches say nothing of cents, and both agents start together.
 *
 * After both agents finish, the lab commits what each changed, merges both branches in a scratch
 * clone and runs checks the agents never saw: Ana's branch alone (the rename was made), Bob's
 * branch alone (his total works against the old contract, or against the new one if he was told of
 * it), and the merged tree (the total works against the new contract). It reports clean
 * integration, whether Bob's code uses `amountCents`, and the characters Peer added to each agent's
 * context.
 *
 * Without REAL_AGENTS=1 it is a dry run: scripted stand-ins for the agents' model write against the
 * contract they have. That checks the machinery (arms, merge, checks, report) and spends nothing;
 * only a run with real agents measures what they do.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { peerAdded, type HookOut, type LabEvent } from "./told.ts";

export type Arm = "none" | "peer" | "kernel";

export const ARM_LABELS: Readonly<Record<Arm, string>> = {
  none: "no Peer: coordination turned off for both agents (LAB_PEER=off)",
  peer: "Peer as it is",
  kernel: "kernel only: presence, messages, rooms and the agents' adapters (LAB_KERNEL=1)",
};

/** The Hub features outside the kernel: `LAB_KERNEL=1` starts the lab's Hub without them. */
export const KERNEL_FEATURES_OFF = ["changes", "github"] as const;

/** The plugins outside the kernel that need no Hub feature and have no operator's switch: turned off at each computer. */
export const KERNEL_PLUGINS_OFF = ["changes", "github"] as const;

/** The arm the environment names: `LAB_PEER=off`, `LAB_KERNEL=1`, or none. */
export function armOf(env: Readonly<Record<string, string | undefined>>): Arm {
  if (env.LAB_PEER !== undefined && env.LAB_PEER !== "off")
    throw new Error(`LAB_PEER is off, not ${env.LAB_PEER}`);
  const named: Arm[] = [
    ...(env.LAB_PEER === "off" ? (["none"] as const) : []),
    ...(env.LAB_KERNEL === "1" ? (["kernel"] as const) : []),
  ];
  if (named.length > 1)
    throw new Error(`${named.length} arms are named (${named.join(", ")}): set one of them`);
  return named[0] ?? "peer";
}

/** What an arm adds to each computer's environment: the kernel arm turns off what an operator can. */
export const armEnv = (arm: Arm): Record<string, string | undefined> =>
  arm === "kernel" ? { PEER_JUJUTSU: "off" } : {};

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
 * there to see. What tells Bob of the new contract, if anything does, is then Peer's own word.
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

/** What Peer added to one computer's agent's context, from the debug log. */
export interface AgentReport {
  /** What Peer put into the agent's context: its hooks' answers and the commands' output. */
  readonly added: { readonly hooks: number; readonly commands: number; readonly chars: number };
  /** The sessions its computer's Peer met. */
  readonly sessions: number;
}

export function agentReport(events: ReadonlyArray<LabEvent>): AgentReport {
  return {
    added: peerAdded(events),
    sessions: new Set(
      events
        .filter((entry) => entry.event === "session.started")
        .map((entry) => String(entry.session)),
    ).size,
  };
}

export interface ContractResult {
  readonly arm: Arm;
  readonly dry: boolean;
  readonly integration: Integration;
  readonly ana: AgentReport;
  readonly bob: AgentReport;
}

const yes = (flag: boolean) => (flag ? "yes" : "no");

/** The result as the lab prints it, one fact to a line. */
export function formatResult(result: ContractResult): ReadonlyArray<string> {
  const { arm, integration: one, ana, bob } = result;
  const added = (report: AgentReport) =>
    `${report.added.chars} characters (hooks ${report.added.hooks}, commands ${report.added.commands}).`;
  return [
    `arm: ${arm} (${ARM_LABELS[arm]})${result.dry ? " · dry run: scripted stand-ins for the model" : ""}`,
    `clean integration: ${yes(one.clean)} (merge ${one.merge}${one.conflicts.length > 0 ? `: ${one.conflicts.join(", ")}` : ""}; merged tree: ${one.merged === undefined ? "not run" : one.merged.ok ? "passes" : one.merged.detail})`,
    `Ana's branch alone: ${one.ana.ok ? "renamed as asked" : `NOT as asked: ${one.ana.detail}`}`,
    `Bob's branch alone: ${one.bob.ok ? `written against the ${one.written} contract (${one.written === "old" ? "amount(), dollars" : "amountCents()"})` : `works against NEITHER contract: ${one.bob.detail}`}`,
    `Bob's code uses amountCents: ${yes(one.bobUsesCents)}`,
    `Peer added to Ana's agent: ${added(ana)}`,
    `Peer added to Bob's agent: ${added(bob)}`,
  ];
}

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
 * callers use the new.
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
  readonly pause: (milliseconds: number) => Promise<void>;
}

/**
 * Ana's and Bob's scripted agents, in the order real ones would act: Ana starts and changes the
 * contract; Bob starts a moment later and writes his total against the contract he has.
 */
export async function runStub(input: StubInput) {
  const { ana, bob, pause } = input;
  const write = (agent: StubAgent, path: string, text: string) => {
    const before = agent.edit("PreToolUse", path);
    if (before?.hookSpecificOutput?.permissionDecision === "deny")
      throw new Error(`${agent.name} was stopped before it edited ${path}`);
    NodeFS.mkdirSync(NodePath.dirname(agent.file(path)), { recursive: true });
    NodeFS.writeFileSync(agent.file(path), text);
    agent.edit("PostToolUse", path);
  };

  ana.start();
  ana.hook("UserPromptSubmit", { prompt: ANA_TASK });
  write(ana, "src/invoice.js", ANA_INVOICE_BEFORE_REMOVAL);
  // Bob's person asks a moment later.
  await pause(1500);
  bob.start();
  bob.hook("UserPromptSubmit", { prompt: BOB_TASK });
  ana.hook("UserPromptSubmit", { prompt: "continue" });
  bob.hook("UserPromptSubmit", { prompt: "continue" });
  write(bob, "src/total.js", TOTAL_IN_DOLLARS);
  // Her callers move to the new method, and the old one goes last.
  for (const [path, text] of Object.entries(ANA_FILES))
    if (path !== "src/invoice.js") write(ana, path, text);
  write(ana, "src/invoice.js", ANA_FILES["src/invoice.js"]!);
  for (const agent of [ana, bob]) agent.hook("SessionEnd", { reason: "exit" });
}
