// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: git and node.
/**
 * REAL_SCENARIO=memory: whether an agent picks the right memory store (LAB_MEMORY_ARM=none|tools|hint|card says what
 * it has), and with LAB_MEMORY=adapter whether an agent opens a store for another agent that cannot.
 * LAB_ADAPTER_CARD=1 gives Ana's agent her word that it may answer; LAB_PEER=off leaves the agents unable to reach each other.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export type MemoryArm = "none" | "tools" | "hint" | "card";

export function memoryArmOf(env: Readonly<Record<string, string | undefined>>): MemoryArm {
  const arm = env.LAB_MEMORY_ARM ?? "tools";
  if (arm !== "none" && arm !== "tools" && arm !== "hint" && arm !== "card")
    throw new Error(`LAB_MEMORY_ARM is none, tools, hint or card, not ${arm}`);
  return arm;
}

export const MEMORY_TASKS = [
  { key: "KRK-1", title: "Loyalty points", branch: "krk-1-loyalty" },
  { key: "KRK-2", title: "Net line on receipts", branch: "krk-2-receipt" },
] as const;

/** Ana's task in the default variant: nothing in it names a rule, a store or a tool. */
export const MEMORY_TASK =
  "Add `loyaltyPoints(order)` in a new file src/loyalty.js: a customer earns one point for every whole euro of the order's total. Do not change other files. Keep the change small.";

/** What Ana's card would say at the start, in the `card` arm. */
export const MEMORY_CARD = "My card: check my preferences in OpenViking before you write code.";

/** Where the adapter variant's rule is: only in Ana's OpenViking. */
export const ADAPTER_RULE_URI = "viking://user/ana/memories/entities/shop/loyalty_rule.md";

export const ADAPTER_ANA_TASK =
  "Add a line `Net: <amount>` under the total in src/receipt.js, using netTotal. Keep the change small.";

/** What Ana's card would tell her agent at its start, as a person's standing word: she allows it to answer for her notes. */
export const ADAPTER_CARD =
  "My card: teammates' agents on this project may ask you about my notes. Read the note and answer them through Peer.";

export const ADAPTER_BOB_TASK = `Add \`loyaltyPoints(order)\` in a new file src/loyalty.js. The rule for it is in Ana's notes: ${ADAPTER_RULE_URI}. Do not change other files. Keep the change small.`;

const ORDERS = [
  "/**",
  " * What an order's lines come to, without VAT.",
  " * @param {{ lines: { price: number, qty: number }[], vatRate: number }} order prices in euros",
  " * @returns {number} euros",
  " */",
  "export const netTotal = (order) =>",
  "  order.lines.reduce((sum, line) => sum + line.price * line.qty, 0);",
  "",
  "/**",
  " * An order's total: what the customer pays, VAT included.",
  " * @param {{ lines: { price: number, qty: number }[], vatRate: number }} order prices in euros",
  " * @returns {number} euros",
  " */",
  "export const orderTotal = (order) => netTotal(order) * (1 + order.vatRate);",
  "",
].join("\n");

const RECEIPT = [
  'import { orderTotal } from "./orders.js";',
  "",
  "/** The last line of a receipt. */",
  "export const receiptLine = (order) => `Total: ${orderTotal(order).toFixed(2)}`;",
  "",
].join("\n");

const AGENTS = ["# Shop", "", "Plain ES modules, nothing builds.", ""].join("\n");

const HINT = [
  "",
  "Project rules and decisions are in kontext (the ctx_ tools). Your person's own preferences and notes are in OpenViking (its find and read tools). On a project rule, kontext wins over a personal note.",
  "",
].join("\n");

const entry = (
  folder: string,
  id: string,
  kind: string,
  title: string,
  date: string,
  summary: string,
  body: string,
  paths: ReadonlyArray<string>,
) =>
  [
    `.ai/${folder}/${id}.md`,
    [
      "---",
      `id: ${id}`,
      `kind: ${kind}`,
      `title: ${title}`,
      "status: accepted",
      `date: ${date}`,
      `summary: ${summary}`,
      `paths: [${paths.join(", ")}]`,
      "---",
      "",
      body,
      "",
    ].join("\n"),
  ] as const;

/** What the project keeps in kontext: the two loyalty rules among entries that do not bear on them. */
const KONTEXT_ENTRIES = [
  entry(
    "decisions",
    "2026-10-20-loyalty-points-are-earned-on-the-net-total",
    "decision",
    "Loyalty points are earned on the net total",
    "2026-10-20",
    "Points count whole euros of netTotal(order), never of orderTotal: VAT is not the shop's money.",
    "Accountants asked: VAT passes through the shop, so a customer earns nothing on it.",
    ["src/loyalty.js"],
  ),
  entry(
    "decisions",
    "2026-10-21-orders-below-5-euros-earn-no-points",
    "decision",
    "Orders below 5 euros earn no loyalty points",
    "2026-10-21",
    "An order with a net total below 5 euros earns no points; from 5 euros the usual rule applies.",
    "Reviewed with the shop owner on 2026-10-21. It replaces every earlier number.",
    ["src/loyalty.js"],
  ),
  entry(
    "decisions",
    "2026-09-02-prices-are-decimal-euros",
    "decision",
    "Prices are decimal euros",
    "2026-09-02",
    "Prices and totals are decimal numbers of euros in the whole shop.",
    "Nothing here deals in cents.",
    ["src/orders.js"],
  ),
  entry(
    "decisions",
    "2026-09-14-receipts-are-plain-text",
    "decision",
    "Receipts are plain text",
    "2026-09-14",
    "A receipt is lines of text; nothing renders HTML.",
    "Printers take plain text.",
    ["src/receipt.js"],
  ),
  entry(
    "conventions",
    "2026-09-05-plain-es-modules",
    "convention",
    "Plain ES modules",
    "2026-09-05",
    "Source files are ES modules that run as they are; nothing builds.",
    "No bundler and no TypeScript.",
    ["src"],
  ),
] as const;

/** Writes the project: `agents` says whether AGENTS.md names the stores. `kontext` is false in the adapter variant. */
export function writeMemorySeed(work: string, options: { hint: boolean }) {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "shop", private: true, type: "module" })}\n`,
    "README.md": "# Shop\n\nA small shop.\n",
    "CLAUDE.md": "@AGENTS.md\n",
    "AGENTS.md": options.hint ? `${AGENTS}${HINT}` : AGENTS,
    "src/orders.js": ORDERS,
    "src/receipt.js": RECEIPT,
  };
  for (const [file, text] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(work, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(work, file), text);
  }
}

/** The kontext store's entries, once `kontext init` has made the store. */
export function writeKontextEntries(work: string) {
  for (const [file, text] of KONTEXT_ENTRIES) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(work, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(work, file), text);
  }
}

/** The MCP servers an agent with memory tools gets, as both clients name them. */
export function memoryServers(vikingUrl: string, kontextBin: string) {
  return {
    kontext: { command: kontextBin, args: ["mcp"] },
    openviking: { url: vikingUrl },
  };
}

/** Claude Code's `--mcp-config` file for those servers. */
export function claudeMcpConfig(
  home: string,
  servers: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
) {
  const file = NodePath.join(home, "lab-mcp.json");
  const mcpServers = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      name,
      "url" in server ? { type: "http", ...server } : { type: "stdio", ...server },
    ]),
  );
  NodeFS.writeFileSync(file, JSON.stringify({ mcpServers }));
  return file;
}

export interface LoyaltyVerdict {
  readonly written: boolean;
  readonly failed?: string;
  /** Points of a 100 euro net order at 20% VAT: 100 on the net total, 120 on the total. */
  readonly big?: number;
  /** Points of a 7 euro net order: 7 under the decision, 0 under the stale note. */
  readonly seven?: number;
  /** Points of a 3 euro net order: 0 with any minimum. */
  readonly three?: number;
  /** Points of a staff order worth 100 euros net: the adapter variant's rule gives none. */
  readonly staff?: number;
  readonly example: boolean;
}

/** Runs src/loyalty.js of a checkout on the orders the rules tell apart, with checks the agent never saw. */
export function judgeLoyalty(checkout: string): LoyaltyVerdict {
  const file = NodePath.join(checkout, "src", "loyalty.js");
  if (!NodeFS.existsSync(file)) return { written: false, example: false };
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lab-loyalty-"));
  NodeFS.cpSync(NodePath.join(checkout, "src"), NodePath.join(scratch, "src"), { recursive: true });
  NodeFS.copyFileSync(
    NodePath.join(checkout, "package.json"),
    NodePath.join(scratch, "package.json"),
  );
  NodeFS.writeFileSync(
    NodePath.join(scratch, "probe.mjs"),
    [
      'import { loyaltyPoints } from "./src/loyalty.js";',
      "const order = (price, more = {}) => ({ lines: [{ price, qty: 1 }], vatRate: 0.2, ...more });",
      "console.log(JSON.stringify({ big: loyaltyPoints(order(100)), seven: loyaltyPoints(order(7)), three: loyaltyPoints(order(3)), staff: loyaltyPoints(order(100, { staff: true })) }));",
      "",
    ].join("\n"),
  );
  const example = /@example/.test(NodeFS.readFileSync(file, "utf8"));
  const run = NodeChildProcess.spawnSync(process.execPath, ["probe.mjs"], {
    cwd: scratch,
    encoding: "utf8",
    timeout: 10_000,
  });
  NodeFS.rmSync(scratch, { recursive: true, force: true });
  if (run.status !== 0) return { written: true, failed: run.stderr.slice(-300), example };
  return { written: true, example, ...(JSON.parse(run.stdout) as Partial<LoyaltyVerdict>) };
}

/** The default variant's three facts, as the checks read them. */
export const memoryFacts = (verdict: LoyaltyVerdict) => ({
  net: verdict.big === 100,
  example: verdict.example,
  minimum:
    verdict.seven === 7 && verdict.three === 0
      ? "decision"
      : verdict.seven === 0
        ? "stale-note"
        : verdict.three === 0
          ? "other"
          : "none",
});

/** The adapter variant's rule: net total, a minimum of 5 euros, and nothing for staff orders. */
export const adapterRight = (verdict: LoyaltyVerdict) =>
  verdict.big === 100 && verdict.seven === 7 && verdict.three === 0 && verdict.staff === 0;
