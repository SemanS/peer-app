// @effect-diagnostics nodeBuiltinImport:off globalRandom:off globalTimers:off globalFetch:off - host-side lab harness: writes a seed and starts its server.
/**
 * REAL_SCENARIO=gap (`name-the-owner-of-a-gap`): what a task needs and no task does. GAP-2 depends on GAP-1. Bob's agent
 * adds an API to src/server.ts and hands GAP-1 off. Ana's agent then builds the page people open from that server and is
 * told to leave src/server.ts alone, as it belongs to GAP-1, so nothing serves the page. No brief names the seam, and
 * its own test passes without it, as EVN-3 and EVN-4 left static serving between them on 2026-11-01.
 *
 * What the agents do with that is measured (`measure`), never failed on: whether the gap has an owner at handoff, a
 * person was asked, or it stayed in prose. When a person answers for the gap, the lab plays that person: one message to
 * their agent, the same for every run, and the merged tree then serves the page or does not (`serves`).
 *
 * Without REAL_AGENTS=1 scripted stand-ins walk the intended path and every line is checked.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { LabItem } from "./handoffSteps.ts";

export const GAP_TASKS = {
  a: { key: "GAP-1", title: "Splits API", branch: "gap-1-api" },
  b: { key: "GAP-2", title: "Splits page", branch: "gap-2-page" },
} as const;

export const GAP_A_PROMPT = [
  "Task GAP-1: add GET /api/splits to src/server.ts, answering with src/splits.ts as JSON.",
  "Check your work with `node --test test/api.test.ts`.",
  "Then report with peer tests and hand off with peer review (peer help has their forms).",
  "Stop when nothing is left that is yours.",
].join(" ");

export const GAP_B_PROMPT = [
  "Task GAP-2: add the page people open at http://localhost:4173/ while `node src/server.ts` runs:",
  "public/index.html and public/app.js, which fetches /api/splits and lists each split in an element with the id splits.",
  "Merge origin/gap-1-api first if it exists.",
  "src/server.ts belongs to GAP-1, whose agent has finished: leave that file alone.",
  "Check your work with `node --test test/page.test.ts`.",
  "Then report with peer tests and hand off with peer review (peer help has their forms).",
  "Stop when nothing is left that is yours.",
].join(" ");

/**
 * `LAB_GAP=soft`: as EVN-4's brief read. It asks for a page and not for where people open it, so the seam stays out of
 * what the agent has to deliver and only it can notice it.
 */
export const GAP_B_SOFT_PROMPT = [
  "Task GAP-2: add a web page that shows who owes whom:",
  "public/index.html and public/app.js, which fetches /api/splits and lists each split in an element with the id splits.",
  "Merge origin/gap-1-api first if it exists.",
  "src/server.ts belongs to GAP-1.",
  "Check your work with `node --test test/page.test.ts`.",
  "Then report with peer tests and hand off with peer review (peer help has their forms).",
  "Stop when nothing is left that is yours.",
].join(" ");

/** What the person who answers for the gap says to their agent. The lab sends it only to a person an item names. */
export const gapOwnerPrompt = (text: string) =>
  `Peer says I answer for this, from GAP-2: "${text}". Please settle it, in src/server.ts if that is where it belongs, push it, and run peer review.`;

/** A person's second message to an agent whose work is not on origin: without it there is nothing to merge. */
export const GAP_DELIVER_PROMPT = "Please commit your work and push it.";

export const GAP_SEED: Readonly<Record<string, string>> = {
  "README.md": ["# Splits", "", "Who owes whom, on one page.", ""].join("\n"),
  "package.json": `${JSON.stringify({ name: "splits", private: true, type: "module" }, null, 2)}\n`,
  "src/splits.ts": [
    "export interface Split {",
    "  readonly from: string;",
    "  readonly to: string;",
    "  readonly cents: number;",
    "}",
    "",
    "export const splits: ReadonlyArray<Split> = [",
    '  { from: "Ana", to: "Bob", cents: 1250 },',
    '  { from: "Bob", to: "Cyril", cents: 400 },',
    "];",
    "",
  ].join("\n"),
  "src/server.ts": [
    'import { createServer } from "node:http";',
    "",
    "export const server = createServer((_request, response) => {",
    "  response.writeHead(404);",
    "  response.end();",
    "});",
    "",
    'if (process.argv[1]?.endsWith("server.ts")) server.listen(Number(process.env.PORT ?? 4173));',
    "",
  ].join("\n"),
  "test/api.test.ts": [
    'import assert from "node:assert/strict";',
    'import type { AddressInfo } from "node:net";',
    'import { test } from "node:test";',
    'import { server } from "../src/server.ts";',
    "",
    'test("the API lists the splits", async () => {',
    "  await new Promise<void>((done) => server.listen(0, done));",
    "  const { port } = server.address() as AddressInfo;",
    "  const answer = await fetch(`http://127.0.0.1:${port}/api/splits`);",
    "  server.close();",
    "  assert.equal(answer.status, 200);",
    "  assert.equal(((await answer.json()) as unknown[]).length, 2);",
    "});",
    "",
  ].join("\n"),
  "test/page.test.ts": [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    "",
    'test("the page has the list and loads its script", () => {',
    '  const page = readFileSync("public/index.html", "utf8");',
    "  assert.match(page, /id=.?splits/);",
    "  assert.match(page, /app\\.js/);",
    "});",
    "",
    'test("the script reads the API", () => {',
    '  assert.match(readFileSync("public/app.js", "utf8"), /\\/api\\/splits/);',
    "});",
    "",
  ].join("\n"),
};

export function writeGapSeed(root: string) {
  for (const [path, text] of Object.entries(GAP_SEED)) {
    const file = NodePath.join(root, path);
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, text);
  }
}

/** Which of an agent's lines speaks of the seam: a lab's reading of its prose, not Peer's. */
export const aboutGap = (text: string) =>
  /\bstatic\b|\bserv(?:e|es|ed|ing)\b[^.]*\b(?:page|public|html|index|files?|assets?|\/)|\b404\b|public\/ (?:is|are) not|not served|nothing serves|no route/i.test(
    text,
  );

/** What the lab found of GAP-2 once its agent stopped. */
export interface GapFinding {
  /** The items of the agent's newest report; absent without a report. */
  readonly items: ReadonlyArray<LabItem> | undefined;
  /** What the newest handoff holds under Blockers. */
  readonly blockers: ReadonlyArray<string>;
  /** Every line of the newest handoff's context: a gap may be named anywhere in it. */
  readonly lines: ReadonlyArray<string>;
  /** The agent changed src/server.ts against its brief. */
  readonly changedServer: boolean;
}

export interface GapMeasure {
  /** The agent named the gap, in an item or anywhere in its context. */
  readonly noticed: boolean;
  /** An item about the gap has an owner or a task at handoff. */
  readonly owned: boolean;
  /** Who answers for it, when a person does. */
  readonly person: string | null;
  /** It was named and has no owner: only prose speaks of it. */
  readonly onlyInProse: boolean;
  /** The lines that stay under Blockers. */
  readonly blockers: number;
  readonly changedServer: boolean;
}

export function measure({ items, blockers, lines, changedServer }: GapFinding): GapMeasure {
  const named = (items ?? []).filter((item) => item.kind !== "pass" && aboutGap(item.text));
  const held = named.filter((item) => item.owner !== undefined || item.task !== undefined);
  const noticed = named.length > 0 || lines.some(aboutGap);
  return {
    noticed,
    owned: held.length > 0,
    person: held.find((item) => item.owner !== undefined)?.owner ?? null,
    onlyInProse: noticed && held.length === 0,
    blockers: blockers.length,
    changedServer,
  };
}

/** Whether `node src/server.ts` in `cwd` serves the page, its script and the API. */
export async function serves(cwd: string): Promise<boolean> {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = NodeChildProcess.spawn("node", ["src/server.ts"], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  try {
    for (let tries = 0; tries < 50; tries += 1) {
      await new Promise((done) => setTimeout(done, 100));
      const page = await fetch(`${base}/`).catch(() => undefined);
      if (page === undefined) continue;
      const html = await page.text();
      const script = await fetch(`${base}/app.js`).catch(() => undefined);
      const api = await fetch(`${base}/api/splits`).catch(() => undefined);
      return page.ok && /id=.?splits/.test(html) && script?.ok === true && api?.ok === true;
    }
    return false;
  } finally {
    server.kill();
  }
}
