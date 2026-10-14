// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: git and node on throwaway checkouts.
/**
 * REAL_SCENARIO=team: four people, two agents each, one product. Ana owns the database, Bob the API, Cyril
 * the app and Dana marketing, which reads the database directly. Their release is an OpenSpec change whose
 * tasks.md the lab turns into the project's eight tasks, each in its person's area; every person runs a
 * Claude Code and a Codex agent on their two tasks, each agent in a worktree of its own. The tasks lean on
 * each other the way a team's do: the name split changes what the API and marketing read, the consent
 * column what marketing and the account page need, and each person's two agents share files. No prompt
 * names another task.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { StubAgent } from "./contract.ts";

export const TEAM_DOMAIN = "acme.test";

/** The four people, their areas and the paths those areas are. */
export const TEAM_PEOPLE = [
  { name: "Ana", email: `ana@${TEAM_DOMAIN}`, area: "Database", paths: ["db/**"] },
  { name: "Bob", email: `bob@${TEAM_DOMAIN}`, area: "API", paths: ["api/**"] },
  { name: "Cyril", email: `cyril@${TEAM_DOMAIN}`, area: "App", paths: ["app/**"] },
  { name: "Dana", email: `dana@${TEAM_DOMAIN}`, area: "Marketing", paths: ["marketing/**"] },
] as const;
export type TeamPerson = (typeof TEAM_PEOPLE)[number]["name"];

/** The project's areas, in the order its people see them. */
export const TEAM_AREAS = TEAM_PEOPLE.map((person) => person.area);

/** Who owns each area and its paths (the ownership plugin's map); nobody's path waits on its owner. */
export const teamOwnerMap = () => ({
  areas: Object.fromEntries(TEAM_PEOPLE.map((person) => [person.area, person.email])),
  paths: Object.fromEntries(
    TEAM_PEOPLE.flatMap((person) => person.paths.map((path) => [path, person.email])),
  ),
  decide: [] as string[],
});

export const TEAM_CHANGE = "personal-newsletter";
export const TEAM_TASKS_FILE = `openspec/changes/${TEAM_CHANGE}/tasks.md`;

/** A task of the release as tasks.md lists it, under its area's heading. */
export interface TeamTask {
  readonly key: string;
  readonly title: string;
  readonly area: string;
  readonly person: TeamPerson;
}

/** The release's tasks from tasks.md: `## N. Area (Person)` headings over `- [ ] N.M KEY Title` lines. */
export function parseTeamTasks(markdown: string): ReadonlyArray<TeamTask> {
  const tasks: TeamTask[] = [];
  let area = "";
  let person = "";
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+\d+\.\s+(.+?)\s+\((\w+)\)\s*$/.exec(line);
    if (heading) {
      area = heading[1]!;
      person = heading[2]!;
      continue;
    }
    const item = /^- \[ \]\s+\d+\.\d+\s+([A-Z][A-Z0-9]*-\d+)\s+(.+?)\s*$/.exec(line);
    if (item && area !== "") {
      if (!TEAM_PEOPLE.some((one) => one.name === person))
        throw new Error(`tasks.md names ${person}, who is not on the team`);
      tasks.push({ key: item[1]!, title: item[2]!, area, person: person as TeamPerson });
    }
  }
  return tasks;
}

/** One agent of the release: whose it is, which harness, its branch and its whole prompt. */
export interface TeamAgent {
  readonly key: string;
  readonly person: TeamPerson;
  readonly kind: "claude" | "codex";
  readonly branch: string;
  readonly prompt: string;
}

const SMALL = "Keep the change small; do not run tests or builds.";

/** Every person's Claude Code takes their first task and Codex their second. */
export const TEAM_AGENTS: ReadonlyArray<TeamAgent> = [
  {
    key: "SHOP-1",
    person: "Ana",
    kind: "claude",
    branch: "shop-1-split-customer-name",
    prompt: `SHOP-1: Store the customer's name as first_name and last_name instead of name. Add the migration db/migrations/002_split_customer_name.sql, update db/schema.sql and the rows in db/rows.js, and make db/customers.js return firstName and lastName instead of name. ${SMALL}`,
  },
  {
    key: "SHOP-2",
    person: "Ana",
    kind: "codex",
    branch: "shop-2-marketing-consent",
    prompt: `SHOP-2: Record each customer's consent to marketing: marketing_consent (false by default) and consent_at. Add the migration db/migrations/003_marketing_consent.sql, update db/schema.sql and db/rows.js (Eva has consented, the others have not), and in db/customers.js return the consent with each customer and add setConsent(id, value). ${SMALL}`,
  },
  {
    key: "SHOP-3",
    person: "Bob",
    kind: "claude",
    branch: "shop-3-customer-names-endpoint",
    prompt: `SHOP-3: GET /customers/:id should return firstName and lastName instead of name. Change customerResponse in api/customers.js. ${SMALL}`,
  },
  {
    key: "SHOP-4",
    person: "Bob",
    kind: "codex",
    branch: "shop-4-consent-endpoint",
    prompt: `SHOP-4: Add the endpoint PUT /customers/:id/consent, which changes a customer's consent to marketing: consentResponse(id, value) in a new file api/consent.js stores it and returns the customer's consent. ${SMALL}`,
  },
  {
    key: "SHOP-5",
    person: "Cyril",
    kind: "claude",
    branch: "shop-5-greet-by-first-name",
    prompt: `SHOP-5: The account page should greet the customer by first name ("Hello, Eva"). Change accountPage in app/account.js. ${SMALL}`,
  },
  {
    key: "SHOP-6",
    person: "Cyril",
    kind: "codex",
    branch: "shop-6-newsletter-switch",
    prompt: `SHOP-6: Add a newsletter switch to the account page: it shows whether the customer gets the newsletter and changes that through the consent endpoint. Change app/account.js. ${SMALL}`,
  },
  {
    key: "SHOP-7",
    person: "Dana",
    kind: "claude",
    branch: "shop-7-newsletter-to-consenting",
    prompt: `SHOP-7: The newsletter must go only to customers who agreed to marketing, and greet them by first name ("Dear Eva"). Change marketing/segments.sql and newsletterList in marketing/newsletter.js. ${SMALL}`,
  },
  {
    key: "SHOP-8",
    person: "Dana",
    kind: "codex",
    branch: "shop-8-revenue-per-customer",
    prompt: `SHOP-8: Add a monthly revenue report per customer, with the customer's full name and the amount in euros: revenueByCustomer() in marketing/report.js. ${SMALL}`,
  },
];

const join = (...lines: string[]) => `${lines.join("\n")}\n`;

/** The OpenSpec change the release was planned in (made with the OpenSpec CLI 1.14.1, validated). */
export const TEAM_OPENSPEC: Record<string, string> = {
  "openspec/config.yaml": join("schema: spec-driven"),
  [`openspec/changes/${TEAM_CHANGE}/.openspec.yaml`]: join(
    "schema: spec-driven",
    "created: 2026-10-14",
  ),
  [`openspec/changes/${TEAM_CHANGE}/proposal.md`]: join(
    "## Why",
    "",
    "Every customer gets the same newsletter today, addressed by full name, whether they agreed to marketing or not. This release records consent, greets customers by first name, and makes sure marketing writes only to people who opted in.",
    "",
    "## What Changes",
    "",
    "- A customer's name is stored as a first and a last name instead of one `name` column.",
    "- Each customer's consent to marketing is recorded, with the time it was given.",
    "- The customer API returns `firstName` and `lastName`, and a new endpoint changes consent.",
    "- The account page greets customers by first name and has a newsletter switch.",
    "- The newsletter goes only to consenting customers and greets them by first name; marketing gets a monthly revenue report per customer.",
    "",
    "## Capabilities",
    "",
    "### New Capabilities",
    "",
    "- `customer-profile`: how a customer's name is stored and returned.",
    "- `marketing-consent`: recording and changing a customer's consent to marketing.",
    "- `newsletter`: who receives the newsletter, how it greets them, and the revenue report.",
    "",
    "### Modified Capabilities",
    "",
    "None.",
    "",
    "## Impact",
    "",
    "`db/` (schema, migrations, data access), `api/`, `app/` and `marketing/`. Marketing reads the database directly, so the column changes reach it as well as the API.",
  ),
  [`openspec/changes/${TEAM_CHANGE}/specs/customer-profile/spec.md`]: join(
    "## ADDED Requirements",
    "",
    "### Requirement: Names are stored as first and last name",
    "",
    "The database SHALL store a customer's name as `first_name` and `last_name`, and the data access SHALL return them as `firstName` and `lastName`.",
    "",
    "#### Scenario: A customer is read",
    "",
    "- **WHEN** the shop reads customer 1, stored as Eva Novak",
    '- **THEN** it gets `firstName` "Eva" and `lastName` "Novak", and no `name`',
    "",
    "### Requirement: The customer endpoint returns both names",
    "",
    "`GET /customers/:id` SHALL return `firstName` and `lastName` instead of `name`.",
    "",
    "#### Scenario: The account page asks for a customer",
    "",
    "- **WHEN** the app requests customer 1",
    '- **THEN** the response body has `firstName` "Eva" and `lastName` "Novak"',
  ),
  [`openspec/changes/${TEAM_CHANGE}/specs/marketing-consent/spec.md`]: join(
    "## ADDED Requirements",
    "",
    "### Requirement: Consent is recorded per customer",
    "",
    "The database SHALL record `marketing_consent` (false by default) and `consent_at` for every customer.",
    "",
    "#### Scenario: A new customer",
    "",
    "- **WHEN** a customer has never answered",
    "- **THEN** their `marketing_consent` is false and `consent_at` is empty",
    "",
    "### Requirement: Consent can be changed",
    "",
    "The API SHALL let a customer change their consent, and the account page SHALL offer a newsletter switch that shows and changes it.",
    "",
    "#### Scenario: A customer opts in",
    "",
    "- **WHEN** customer 2 turns the newsletter switch on",
    "- **THEN** their `marketing_consent` becomes true and `consent_at` records when",
  ),
  [`openspec/changes/${TEAM_CHANGE}/specs/newsletter/spec.md`]: join(
    "## ADDED Requirements",
    "",
    "### Requirement: Only consenting customers receive the newsletter",
    "",
    "The newsletter's mailing list SHALL contain only customers whose `marketing_consent` is true, each greeted by first name.",
    "",
    "#### Scenario: Mixed consent",
    "",
    "- **WHEN** Eva has consented and Tomas has not",
    '- **THEN** the list has Eva, greeted "Dear Eva", and not Tomas',
    "",
    "### Requirement: Monthly revenue per customer",
    "",
    "Marketing SHALL have a report of each customer's revenue per month, with the customer's full name and amounts in euros from integer cents.",
    "",
    "#### Scenario: Two orders in September",
    "",
    "- **WHEN** Eva Novak ordered for 1250 and 899 cents in September 2026",
    "- **THEN** the report shows Eva Novak, 2026-09, €21.49",
  ),
  [TEAM_TASKS_FILE]: join(
    "# Tasks",
    "",
    "## 1. Database (Ana)",
    "",
    "- [ ] 1.1 SHOP-1 Split the customer's name into first_name and last_name",
    "- [ ] 1.2 SHOP-2 Record each customer's marketing consent",
    "",
    "## 2. API (Bob)",
    "",
    "- [ ] 2.1 SHOP-3 Customer endpoint returns firstName and lastName",
    "- [ ] 2.2 SHOP-4 Endpoint that changes a customer's marketing consent",
    "",
    "## 3. App (Cyril)",
    "",
    "- [ ] 3.1 SHOP-5 Account page greets the customer by first name",
    "- [ ] 3.2 SHOP-6 Newsletter switch on the account page",
    "",
    "## 4. Marketing (Dana)",
    "",
    "- [ ] 4.1 SHOP-7 Newsletter only to consenting customers, by first name",
    "- [ ] 4.2 SHOP-8 Monthly revenue report per customer",
  ),
};

/** What the project's people already agreed, in its kontext store: reviewed with the code. */
export const TEAM_KNOWLEDGE: Record<string, string> = {
  ".ai/kontext.toml": join(
    "# kontext: the shop's own knowledge (committed, reviewed like code).",
    "",
    "[project]",
    'name = "shop"',
    'description = "An online shop: its database, API, app and marketing."',
    "",
    "[store]",
    'dir = ".ai"',
  ),
  ".ai/README.md": join(
    "# Shop knowledge",
    "",
    "Shared, reviewed knowledge for the people and coding agents working on the shop: decisions, conventions and learnings.",
  ),
  ".ai/decisions/2026-10-13-money-is-integer-cents.md": join(
    "---",
    "id: 2026-10-13-money-is-integer-cents",
    "kind: decision",
    "title: Money is integer cents everywhere",
    "status: accepted",
    "date: 2026-10-13",
    "summary: Amounts are stored, computed and passed as integer cents (orders.total_cents, totalCents in the API); only what a person reads turns them into euros, with formatCents from app/money.js.",
    "tags: [money]",
    "paths: [db/**, api/**, app/**, marketing/**]",
    "---",
    "",
    "## Context",
    "",
    "Sums of prices drifted in floating point, and loyalty points were once computed from cents as if they were euros.",
    "",
    "## Decision",
    "",
    "- Store and pass integer cents: `orders.total_cents`, `totalCents` in the API.",
    '- Turn cents into euros only where a person reads them, with `formatCents` from app/money.js (1250 → "€12.50").',
  ),
  ".ai/conventions/2026-10-02-contracts-other-areas-read-are-marked-for-the-project.md": join(
    "---",
    "id: 2026-10-02-contracts-other-areas-read-are-marked-for-the-project",
    "kind: convention",
    "title: Contracts other areas read are marked for the project",
    "date: 2026-10-02",
    "summary: When a task changes a column, a field or an endpoint that another area reads, its agent writes the new contract in the task's shared context as a line starting with [project], so the team can keep it as project knowledge.",
    "tags: [coordination]",
    "paths: [db/**, api/**, app/**, marketing/**]",
    "---",
    "",
    "Marketing reads the database directly and the app reads the API, so a contract one area changes is the other areas' input.",
  ),
  ".ai/conventions/2026-10-01-database-changes-go-through-migrations.md": join(
    "---",
    "id: 2026-10-01-database-changes-go-through-migrations",
    "kind: convention",
    "title: Database changes go through numbered migrations",
    "date: 2026-10-01",
    "summary: Every change to db/schema.sql comes with the next numbered migration in db/migrations. Marketing's SQL reads the same tables as the API, so a column change concerns everyone who reads that table.",
    "tags: [database]",
    "paths: [db/**, marketing/**]",
    "---",
    "",
    "Marketing runs its own queries (marketing/*.sql) against the shop's database.",
  ),
};

/** The shop as the release finds it: one `name` column, no consent, money in cents. */
export const TEAM_CODE: Record<string, string> = {
  "package.json": join("{", '  "name": "shop",', '  "private": true,', '  "type": "module"', "}"),
  "README.md": join(
    "# Shop",
    "",
    "- `db/`: the database (schema, migrations, data access). Owner: Ana.",
    "- `api/`: the HTTP API the app calls. Owner: Bob.",
    "- `app/`: the customer-facing pages. Owner: Cyril.",
    "- `marketing/`: newsletter and reports; reads the database directly. Owner: Dana.",
    "",
    "The rows in db/rows.js stand in for the database in this repository.",
  ),
  "db/schema.sql": join(
    "-- The shop's database. Change it only with a new migration in db/migrations.",
    "CREATE TABLE customers (",
    "  id INTEGER PRIMARY KEY,",
    "  name TEXT NOT NULL,",
    "  email TEXT NOT NULL UNIQUE,",
    "  created_at DATE NOT NULL",
    ");",
    "",
    "CREATE TABLE orders (",
    "  id INTEGER PRIMARY KEY,",
    "  customer_id INTEGER NOT NULL REFERENCES customers (id),",
    "  total_cents INTEGER NOT NULL,",
    "  created_at DATE NOT NULL",
    ");",
  ),
  "db/migrations/001_init.sql": join(
    "CREATE TABLE customers (",
    "  id INTEGER PRIMARY KEY,",
    "  name TEXT NOT NULL,",
    "  email TEXT NOT NULL UNIQUE,",
    "  created_at DATE NOT NULL",
    ");",
    "",
    "CREATE TABLE orders (",
    "  id INTEGER PRIMARY KEY,",
    "  customer_id INTEGER NOT NULL REFERENCES customers (id),",
    "  total_cents INTEGER NOT NULL,",
    "  created_at DATE NOT NULL",
    ");",
  ),
  "db/rows.js": join(
    "/** The shop's rows: they stand in for its database in this repository. */",
    "export const rows = {",
    "  customers: [",
    '    { id: 1, name: "Eva Novak", email: "eva@example.com", created_at: "2026-09-01" },',
    '    { id: 2, name: "Tomas Kral", email: "tomas@example.com", created_at: "2026-09-12" },',
    '    { id: 3, name: "Lucia Horvat", email: "lucia@example.com", created_at: "2026-10-02" },',
    "  ],",
    "  orders: [",
    '    { id: 1, customer_id: 1, total_cents: 1250, created_at: "2026-09-03" },',
    '    { id: 2, customer_id: 2, total_cents: 4990, created_at: "2026-09-15" },',
    '    { id: 3, customer_id: 1, total_cents: 899, created_at: "2026-09-28" },',
    '    { id: 4, customer_id: 3, total_cents: 2300, created_at: "2026-10-05" },',
    "  ],",
    "};",
  ),
  "db/customers.js": join(
    'import { rows } from "./rows.js";',
    "",
    "/** A customer as the rest of the shop reads it. */",
    "const toCustomer = (row) => ({ id: row.id, name: row.name, email: row.email });",
    "",
    "export const getCustomer = (id) => {",
    "  const row = rows.customers.find((one) => one.id === id);",
    "  return row === undefined ? undefined : toCustomer(row);",
    "};",
    "",
    "export const listCustomers = () => rows.customers.map(toCustomer);",
  ),
  "db/orders.js": join(
    'import { rows } from "./rows.js";',
    "",
    "export const ordersOf = (customerId) => rows.orders.filter((order) => order.customer_id === customerId);",
    "",
    '/** Revenue per month ("2026-09"), in integer cents. */',
    "export const revenueByMonth = () => {",
    "  const months = {};",
    "  for (const order of rows.orders) {",
    "    const month = order.created_at.slice(0, 7);",
    "    months[month] = (months[month] ?? 0) + order.total_cents;",
    "  }",
    "  return months;",
    "};",
  ),
  "api/customers.js": join(
    'import { getCustomer } from "../db/customers.js";',
    "",
    "/** GET /customers/:id */",
    "export const customerResponse = (id) => {",
    "  const customer = getCustomer(id);",
    "  if (customer === undefined) return { status: 404 };",
    "  return { status: 200, body: { id: customer.id, name: customer.name, email: customer.email } };",
    "};",
  ),
  "api/orders.js": join(
    'import { ordersOf } from "../db/orders.js";',
    "",
    "/** GET /customers/:id/orders: amounts in integer cents, as everywhere in the shop. */",
    "export const ordersResponse = (customerId) => ({",
    "  status: 200,",
    "  body: ordersOf(customerId).map((order) => ({",
    "    id: order.id,",
    "    totalCents: order.total_cents,",
    "    date: order.created_at,",
    "  })),",
    "});",
  ),
  "app/money.js": join(
    '/** Integer cents as a person reads them: 1250 → "€12.50". */',
    "export const formatCents = (cents) => `€${(cents / 100).toFixed(2)}`;",
  ),
  "app/account.js": join(
    'import { customerResponse } from "../api/customers.js";',
    "",
    "/** The customer's account page. */",
    "export const accountPage = (id) => {",
    "  const { body } = customerResponse(id);",
    '  return [`<h1>Hello, ${body.name}</h1>`, `<p>${body.email}</p>`].join("\\n");',
    "};",
  ),
  "app/checkout.js": join(
    'import { formatCents } from "./money.js";',
    "",
    "/** The checkout's order summary. */",
    "export const orderSummary = (totalCents) => `Total: ${formatCents(totalCents)}`;",
  ),
  "marketing/segments.sql": join(
    "-- Who gets the monthly newsletter. Marketing reads the shop's database directly.",
    "SELECT name, email",
    "FROM customers",
    "ORDER BY created_at DESC;",
  ),
  "marketing/newsletter.js": join(
    'import { listCustomers } from "../db/customers.js";',
    "",
    "/** The monthly newsletter's mailing list (marketing/segments.sql says who is on it). */",
    "export const newsletterList = () =>",
    "  listCustomers().map((customer) => ({ to: customer.email, greeting: `Dear ${customer.name}` }));",
  ),
  "marketing/report.js": join(
    'import { revenueByMonth } from "../db/orders.js";',
    "",
    "/** Revenue per month for the marketing dashboard, in integer cents. */",
    "export const monthlyRevenue = () => revenueByMonth();",
  ),
};

/** Everything the lab commits before the release starts. */
export const TEAM_SEED: Record<string, string> = {
  ...TEAM_CODE,
  ...TEAM_KNOWLEDGE,
  ...TEAM_OPENSPEC,
};

/** Writes the seed into a fresh repository's working tree. */
export function writeTeamSeed(dir: string) {
  for (const [file, text] of Object.entries(TEAM_SEED)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(dir, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, file), text);
  }
}

/** Where a person's task worktree lives on their computer: beside the checkout, as Peer's own launcher puts it. */
export const teamWorktree = (workspaceRoot: string, branch: string) =>
  NodePath.join(workspaceRoot, ".worktrees", "acme", "lab", "app", branch);

/** What the merged release does, checked from outside: each line is a check and whether it held. */
export interface TeamCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const CHECK_SCRIPT = `
const results = [];
const check = async (name, run) => {
  try {
    const detail = await run();
    results.push({ name, ok: detail === true || (typeof detail === "string" && !detail.startsWith("✗")), detail: String(detail) });
  } catch (error) {
    results.push({ name, ok: false, detail: "✗ " + String(error && error.message ? error.message : error).slice(0, 200) });
  }
};
const root = process.cwd();
const load = (file) => import(root + "/" + file + "?t=" + Date.now());
await check("db returns firstName and lastName", async () => {
  const { getCustomer } = await load("db/customers.js");
  const eva = getCustomer(1);
  return eva.firstName === "Eva" && eva.lastName === "Novak" && !("name" in eva) ? true : "✗ " + JSON.stringify(eva);
});
await check("db returns marketing consent", async () => {
  const { getCustomer } = await load("db/customers.js");
  const eva = getCustomer(1);
  const consent = eva.marketingConsent ?? eva.consent ?? eva.marketing_consent;
  return consent === true || (consent && consent.given === true) ? true : "✗ " + JSON.stringify(eva);
});
await check("API returns firstName and lastName", async () => {
  const { customerResponse } = await load("api/customers.js");
  const { body } = customerResponse(1);
  return body.firstName === "Eva" && body.lastName === "Novak" ? true : "✗ " + JSON.stringify(body);
});
await check("account page greets by first name", async () => {
  const { accountPage } = await load("app/account.js");
  const page = String(await accountPage(1));
  return page.includes("Hello, Eva") && !page.includes("undefined") ? true : "✗ " + page.slice(0, 160);
});
await check("newsletter only to consenting customers, by first name", async () => {
  const { newsletterList } = await load("marketing/newsletter.js");
  const list = await newsletterList();
  const to = list.map((one) => one.to ?? one.email);
  const greetings = list.map((one) => one.greeting ?? "");
  return to.includes("eva@example.com") && !to.includes("tomas@example.com") && greetings.some((g) => g.includes("Eva")) && !greetings.some((g) => g.includes("Novak") || g.includes("undefined"))
    ? true
    : "✗ " + JSON.stringify(list).slice(0, 200);
});
await check("segments.sql reads consent and first name", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(root + "/marketing/segments.sql", "utf8");
  return /marketing_consent/.test(sql) && /first_name/.test(sql) ? true : "✗ " + sql.replace(/\\s+/g, " ").slice(0, 160);
});
await check("revenue per customer in euros", async () => {
  const { revenueByCustomer } = await load("marketing/report.js");
  const text = JSON.stringify(await revenueByCustomer());
  return text.includes("Eva Novak") && text.includes("21.49") ? true : "✗ " + text.slice(0, 200);
});
console.log(JSON.stringify(results));
`;

/** Runs the release's checks in a merged checkout. */
export function checkTeam(dir: string): ReadonlyArray<TeamCheck> {
  const script = NodePath.join(dir, ".team-check.mjs");
  NodeFS.writeFileSync(script, CHECK_SCRIPT);
  try {
    const out = NodeChildProcess.execFileSync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30_000,
    });
    return JSON.parse(out.trim().split("\n").at(-1) ?? "[]") as TeamCheck[];
  } catch (error) {
    return [{ name: "the checks ran", ok: false, detail: String(error).slice(0, 200) }];
  } finally {
    NodeFS.rmSync(script, { force: true });
  }
}

/** The scripted agents of the dry run: each starts, edits its task's files, and stops; one asks the other area. */
export async function runTeamStub(input: {
  readonly agents: ReadonlyArray<{ readonly key: string; readonly agent: StubAgent }>;
  readonly pause: (milliseconds: number) => Promise<void>;
}) {
  const of = (key: string) => input.agents.find((one) => one.key === key)!.agent;
  const touch = async (key: string, path: string, line: string) => {
    const agent = of(key);
    agent.edit("PreToolUse", path);
    NodeFS.mkdirSync(NodePath.dirname(agent.file(path)), { recursive: true });
    const before = NodeFS.existsSync(agent.file(path))
      ? NodeFS.readFileSync(agent.file(path), "utf8")
      : "";
    NodeFS.writeFileSync(agent.file(path), `${before}${line}\n`);
    agent.edit("PostToolUse", path);
    await input.pause(400);
  };
  for (const { agent } of input.agents) agent.start();
  await input.pause(1500);
  await touch("SHOP-1", "db/migrations/002_split_customer_name.sql", "-- split name");
  await touch("SHOP-3", "api/customers.js", "// firstName and lastName");
  await touch("SHOP-5", "app/account.js", "// greet by first name");
  await touch("SHOP-7", "marketing/segments.sql", "-- consenting customers");
  await touch("SHOP-1", "db/customers.js", "// firstName, lastName");
  await touch("SHOP-2", "db/customers.js", "// marketing consent");
  await touch("SHOP-6", "app/account.js", "// newsletter switch");
  await touch("SHOP-4", "api/consent.js", "// PUT /customers/:id/consent");
  await touch("SHOP-8", "marketing/report.js", "// revenue per customer");
  of("SHOP-7").peer(
    "ask",
    "SHOP-1",
    "What are the new name columns called, and when does SHOP-1 land?",
  );
  await input.pause(1500);
  for (const { agent } of input.agents) agent.hook("Stop");
}
