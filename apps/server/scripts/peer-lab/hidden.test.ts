// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab fixture checks on throwaway git repositories; no servers.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { commitWork, currentBranch } from "./contract.ts";
import {
  HIDDEN_ANA_FILES,
  HIDDEN_ANA_TASK,
  HIDDEN_BOB_TASK,
  HIDDEN_TASKS,
  LOYALTY_IN_EUROS,
  formatHidden,
  integrateHidden,
  runHiddenCheck,
  writeHiddenSeed,
} from "./hidden.ts";

const made: string[] = [];
const temp = () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hidden-lab-"));
  made.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of made.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.test",
    },
  });

const write = (root: string, files: Readonly<Record<string, string>>) => {
  for (const [path, text] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), text);
  }
};

/** Bob's points when he knows that orderTotal returns cents. */
const LOYALTY_IN_CENTS = [
  'import { orderTotal } from "./orders.js";',
  "",
  "/** One loyalty point for every whole euro; orderTotal returns integer cents. */",
  "export const loyaltyPoints = (order) => Math.floor(orderTotal(order) / 100);",
  "",
].join("\n");

describe("the hidden dependency's tasks", () => {
  it("name nothing of the other's work where Peer shows them, and say nothing of a unit to Bob", () => {
    const [ana, bob] = HIDDEN_TASKS;
    expect(`${ana.title} ${ana.branch}`).not.toMatch(/order|total|cent|point|loyal/i);
    expect(`${bob.title} ${bob.branch}`).not.toMatch(/order|round|cent|float/i);
    for (const task of HIDDEN_TASKS)
      expect(task.branch.startsWith(task.key.toLowerCase())).toBe(true);
    expect(HIDDEN_BOB_TASK).not.toMatch(/orderTotal|cents|Ana|teammate/);
    expect(HIDDEN_ANA_TASK).not.toMatch(/loyalty|points|Bob|teammate/);
  });
});

describe("the checks the agents never saw", () => {
  it("say the seed is Bob's world: orderTotal in euros, and his points right against it", () => {
    const tree = temp();
    writeHiddenSeed(tree);
    write(tree, { "src/loyalty.js": LOYALTY_IN_EUROS });
    expect(runHiddenCheck(tree, "consumer", temp())).toMatchObject({ ok: true });
    expect(runHiddenCheck(tree, "provider", temp())).toMatchObject({ ok: false, kind: "mismatch" });
  });

  it("say Ana's change keeps the receipt and VAT as they were", () => {
    const tree = temp();
    writeHiddenSeed(tree);
    write(tree, HIDDEN_ANA_FILES);
    expect(runHiddenCheck(tree, "provider", temp())).toMatchObject({ ok: true });
  });
});

/** An origin and the two checkouts of it, with each agent's files written and committed as the lab does. */
const world = (bob: Readonly<Record<string, string>>) => {
  const root = temp();
  const seed = NodePath.join(root, "seed");
  writeHiddenSeed(seed);
  git(root, "init", "--quiet", "--initial-branch", "main", seed);
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "shop");
  const origin = NodePath.join(root, "origin.git");
  git(root, "clone", "--quiet", "--bare", seed, origin);
  const [anaCheckout, bobCheckout] = HIDDEN_TASKS.map((task, at) => {
    const checkout = NodePath.join(root, at === 0 ? "ana" : "bob");
    git(root, "clone", "--quiet", origin, checkout);
    git(checkout, "checkout", "--quiet", "-b", task.branch);
    write(checkout, at === 0 ? HIDDEN_ANA_FILES : bob);
    commitWork(checkout, "agent");
    return checkout;
  }) as [string, string];
  const scratch = NodePath.join(root, "scratch");
  NodeFS.mkdirSync(scratch);
  return integrateHidden({
    origin,
    ana: { checkout: anaCheckout, branch: currentBranch(anaCheckout) },
    bob: { checkout: bobCheckout, branch: currentBranch(bobCheckout) },
    scratch,
  });
};

describe("merging what the agents did", () => {
  it("catches the hundredfold points when Bob wrote for the orderTotal he had", () => {
    const result = world({ "src/loyalty.js": LOYALTY_IN_EUROS });
    expect(result).toMatchObject({
      merge: "clean",
      clean: false,
      written: "euros",
      bobUsesCents: false,
    });
    expect(result.ana.ok && result.bob.ok).toBe(true);
    expect(result.merged?.detail).toBe("12.50 euros earn 12 points: expected 12, got 1250");
  });

  it("integrates cleanly when Bob knew orderTotal returns cents", () => {
    const result = world({ "src/loyalty.js": LOYALTY_IN_CENTS });
    expect(result).toMatchObject({
      merge: "clean",
      clean: true,
      written: "cents",
      bobUsesCents: true,
    });
    const lines = formatHidden({
      arm: "plans",
      dry: false,
      integration: result,
      ana: emptyReport,
      bob: emptyReport,
    });
    expect(lines[1]).toBe("clean integration: yes (merge clean; merged tree: passes)");
    expect(lines[3]).toBe(
      "Bob's branch alone: written for orderTotal() in cents, as Ana changes it",
    );
    expect(lines[4]).toBe("Bob's code allows for cents: yes");
  });
});

const emptyReport = {
  ran: 0,
  outcomes: {},
  answers: { count: 0, chars: 0 },
  notices: { count: 0, chars: 0 },
  nudges: 0,
  impact: { count: 0, chars: 0 },
  added: { hooks: 0, commands: 0, chars: 0 },
  sessions: 0,
};
