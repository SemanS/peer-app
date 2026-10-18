// @effect-diagnostics nodeBuiltinImport:off globalDate:off - host-side lab harness: reads the trees two agents leave.
/**
 * REAL_SCENARIO=follow (LAB_VCS=jj): building on a teammate's change that is still being written, the paid
 * measure of `add-jujutsu-team-features` (design D15). Ana's agent changes `orderTotal(order)` in the hidden
 * seed to integer cents. Once that change exists, Bob's agent is started from it (a jj workspace on Ana's
 * bookmark, as "Start from" makes one), and while Bob's agent works Ana's amends the same change: she adds
 * `toEuros(cents)` and uses it in the receipt. Peer keeps Bob's change on Ana's newest version, and tells
 * him once what moved.
 *
 * The run reports whether Bob's final tree is right (the hidden seed's merged checks, and Ana's amend in it),
 * whether any edit made through an agent's tools was lost, how many converges Peer ran, how many moved notices
 * Bob's agent heard, and the characters Peer added to its context. With real agents each run spends the
 * person's subscription, so it runs only after the maintainer agrees; without REAL_AGENTS=1 scripted
 * stand-ins play both agents and nothing is spent.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { Check } from "./contract.ts";
import {
  HIDDEN_ANA_FILES,
  HIDDEN_ANA_TASK,
  LOYALTY_IN_CENTS,
  LOYALTY_IN_EUROS,
  ORDERS_IN_CENTS,
  runHiddenCheck,
} from "./hidden.ts";
import { edit, saying, startSide, toldTo, type JujutsuKit, type Side } from "./jujutsu.ts";
import { peerAdded, toldTexts, type LabEvent } from "./told.ts";

export const FOLLOW_TASKS = [
  { key: "KRK-1", title: "Rounding drift bug" },
  { key: "KRK-2", title: "Loyalty points" },
] as const;

/** Ana's task is the hidden seed's: `orderTotal` returns integer cents. */
export const FOLLOW_ANA_TASK = HIDDEN_ANA_TASK;

/** Bob's: points computed from `orderTotal`, nothing about cents, euros or Ana. He starts on top of her change. */
export const FOLLOW_BOB_TASK =
  "Add `loyaltyPoints(order)` in a new file src/loyalty.js, computed from `orderTotal(order)`: a customer earns one point for every whole euro of the order's total, so an order that comes to 12.50 euros earns 12 points. Do not change other files. Keep the change small; do not run tests or builds.";

/** What Ana is asked next, to amend the change Bob's work sits on. */
export const FOLLOW_AMEND_TASK =
  "One more thing in the same change: add `export const toEuros = (cents) => cents / 100;` to src/orders.js and use it in src/receipt.js instead of dividing by 100 there. Keep the change small; do not run tests or builds.";

/** Ana's amend, as her stand-in writes it. */
export const ORDERS_WITH_TO_EUROS = `${ORDERS_IN_CENTS}\n/** Integer cents as euros. */\nexport const toEuros = (cents) => cents / 100;\n`;
export const RECEIPT_WITH_TO_EUROS = [
  'import { orderTotal, toEuros } from "./orders.js";',
  "",
  "/** The receipt's last line: `Total: €12.50`. */",
  "export const receiptTotal = (order) => `Total: €${toEuros(orderTotal(order)).toFixed(2)}`;",
  "",
].join("\n");

/** Bob's points once he has heard of `toEuros`. */
export const LOYALTY_WITH_TO_EUROS = [
  'import { orderTotal, toEuros } from "./orders.js";',
  "",
  "/** One loyalty point for every whole euro of an order's total. */",
  "export const loyaltyPoints = (order) => Math.floor(toEuros(orderTotal(order)));",
  "",
].join("\n");

/** Whether orders.js exports `toEuros`: Ana's amend reached the tree. */
export const exportsToEuros = (orders: string) =>
  /\bexport\s+(?:const|function)\s+toEuros\b|\bexport\s*\{[^}]*\btoEuros\b/.test(orders);

/**
 * Whether a tree is right: the hidden seed's merged checks (cents, receipt and VAT as before, 12.50 euros
 * earn 12 points), and Ana's amend in it. A tree that is right without the amend followed nothing.
 */
export function checkFollowTree(tree: string, work: string): Check {
  const merged = runHiddenCheck(tree, "merged", work);
  if (!merged.ok) return merged;
  const orders = NodePath.join(tree, "src/orders.js");
  if (!NodeFS.existsSync(orders) || !exportsToEuros(NodeFS.readFileSync(orders, "utf8")))
    return {
      ok: false,
      kind: "missing",
      detail: "Ana's amend (toEuros in src/orders.js) is not in Bob's tree",
    };
  return merged;
}

/** The paths the log says an agent's tools edited, in the order first seen. */
export function editedPaths(events: ReadonlyArray<LabEvent>): ReadonlyArray<string> {
  const paths: Array<string> = [];
  for (const entry of events) {
    if (entry.event !== "intent" || !Array.isArray(entry.verdicts)) continue;
    for (const verdict of entry.verdicts as ReadonlyArray<{ readonly path?: unknown }>)
      if (typeof verdict.path === "string" && !paths.includes(verdict.path))
        paths.push(verdict.path);
  }
  return paths;
}

/** Edited paths that are not in the final tree: an edit made through an agent's tools that is gone. */
export const lostEdits = (edited: ReadonlyArray<string>, present: (path: string) => boolean) =>
  edited.filter((path) => !present(path));

/** What Peer's converges did, from the logs of the computers the agents ran on. */
export function convergesOf(events: ReadonlyArray<LabEvent>) {
  const ran = events.filter((entry) => entry.event === "jujutsu.converged");
  return {
    count: ran.length,
    done: ran.filter((entry) => entry.outcome === "done").length,
    refused: ran.filter((entry) => entry.outcome === "refused").length,
  };
}

export interface FollowResult {
  readonly dry: boolean;
  /** Bob's final tree is right, with Ana's amend in it. */
  readonly tree: Check;
  /** Edited paths that are missing from it. */
  readonly lost: ReadonlyArray<string>;
  readonly converges: { readonly count: number; readonly done: number; readonly refused: number };
  /** Moved notices Bob's agent heard. */
  readonly moved: number;
  /** Changes that still have two versions at the end. */
  readonly twoVersions: number;
  /** What Peer added to Bob's agent's context. */
  readonly added: { readonly hooks: number; readonly commands: number; readonly chars: number };
}

export function followResult(input: {
  readonly dry: boolean;
  readonly tree: Check;
  readonly present: (path: string) => boolean;
  /** Ana's and Bob's debug logs. */
  readonly ana: ReadonlyArray<LabEvent>;
  readonly bob: ReadonlyArray<LabEvent>;
  /** Changes with two versions in Bob's repository at the end. */
  readonly twoVersions: number;
}): FollowResult {
  return {
    dry: input.dry,
    tree: input.tree,
    lost: lostEdits(
      [...new Set([...editedPaths(input.ana), ...editedPaths(input.bob)])],
      input.present,
    ),
    converges: convergesOf([...input.ana, ...input.bob]),
    moved: toldTexts(input.bob).filter((text) => text.includes("moved under you")).length,
    twoVersions: input.twoVersions,
    added: peerAdded(input.bob),
  };
}

/** The result as the lab prints it, one fact to a line. */
export function formatFollow(result: FollowResult): ReadonlyArray<string> {
  const { tree, lost, converges: ran, added } = result;
  return [
    `${result.dry ? "dry run: scripted stand-ins for both agents" : "real agents"}`,
    `Bob's final tree: ${tree.ok ? "right (cents, receipt and VAT as before, 12.50 euros earn 12 points, and Ana's amend is in it)" : `NOT right: ${tree.detail}`}`,
    `edits lost: ${lost.length === 0 ? "none" : `${lost.length} (${lost.join(", ")})`}`,
    `converges Peer ran: ${ran.count} (done ${ran.done}, refused ${ran.refused}); changes left with two versions: ${result.twoVersions}`,
    `moved notices Bob's agent heard: ${result.moved}`,
    `Peer added to Bob's agent: ${added.chars} characters (hooks ${added.hooks}, commands ${added.commands})`,
  ];
}

/** Ana's bookmark on origin as the person's own `jj git push` leaves it; the lab does it for her. */
export function pushAnas(
  kit: JujutsuKit,
  ana: Pick<Side, "cwd" | "branch" | "key">,
  title: string,
) {
  if (kit.jj(ana.cwd, "log", "--no-graph", "-r", "@", "-T", "description").trim() === "")
    kit.jj(ana.cwd, "describe", "-m", `${ana.key}: ${title}`);
  kit.jj(ana.cwd, "git", "push", "--bookmark", ana.branch);
}

/** Peer fetches what a session builds on at most every thirty seconds. */
const FETCH_GAP_MS = 30_000;

/**
 * The dry run: Ana's scripted agent changes `orderTotal` and its uses, Bob's is started from her change and
 * writes his points for the `orderTotal` it finds there, Ana amends, and Bob's next step after the fetch hears
 * what moved and puts his points to the new helper. It checks the machinery (workspaces, hooks, the fetch,
 * the report) and spends nothing.
 */
export async function runFollowStub(kit: JujutsuKit): Promise<{ ana: Side; bob: Side }> {
  for (const task of FOLLOW_TASKS) await kit.addTask(task.title, task.key);
  const [anaTask, bobTask] = FOLLOW_TASKS;
  const ana = await startSide(kit, kit.ana, { key: anaTask.key, title: anaTask.title });
  for (const [path, text] of Object.entries(HIDDEN_ANA_FILES)) edit(ana, path, text);
  pushAnas(kit, ana, anaTask.title);

  const bob = await startSide(kit, kit.bob, {
    key: bobTask.key,
    title: bobTask.title,
    base: ana.branch,
  });
  const orders = NodeFS.readFileSync(bob.agent.file("src/orders.js"), "utf8");
  const startedAt = Date.now();
  edit(
    bob,
    "src/loyalty.js",
    orders.includes("integer cents") ? LOYALTY_IN_CENTS : LOYALTY_IN_EUROS,
  );

  edit(ana, "src/orders.js", ORDERS_WITH_TO_EUROS);
  edit(ana, "src/receipt.js", RECEIPT_WITH_TO_EUROS);
  kit.jj(ana.cwd, "git", "push", "--bookmark", ana.branch);

  await kit.sleep(Math.max(0, startedAt + FETCH_GAP_MS + 1_500 - Date.now()));
  const heard = edit(bob, "src/loyalty.js", LOYALTY_IN_CENTS);
  kit.told(`${bob.agent.name} (its next step)`, heard.texts.join("\n\n"));
  const moved = saying(heard.texts, "moved under you") > 0;
  // A scripted agent puts its points to the helper only when it was told the helper exists.
  const mentions = heard.texts.some((text) => text.includes("toEuros"));
  if (moved && mentions) edit(bob, "src/loyalty.js", LOYALTY_WITH_TO_EUROS);
  const session = toldTo(kit.events(kit.bob), bob.session);
  kit.say("Bob's stand-in", `heard ${saying(session, "moved under you")} moved notice(s)`);
  return { ana, bob };
}
