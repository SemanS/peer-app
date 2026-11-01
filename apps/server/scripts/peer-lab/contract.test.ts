// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab fixture checks on throwaway git repositories; no servers.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  ANA_FILES,
  ANA_TASK,
  BOB_TASK,
  SEED,
  HARD_TASKS,
  TASKS,
  TOTAL_IN_CENTS,
  TOTAL_IN_DOLLARS,
  agentReport,
  armEnv,
  armOf,
  commitWork,
  currentBranch,
  formatResult,
  integrate,
  runCheck,
  runStub,
  type ContractResult,
  type StubAgent,
  writeSeed,
} from "./contract.ts";
import type { LabEvent } from "./told.ts";

const made: string[] = [];
const temp = () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "contract-lab-"));
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
      GIT_AUTHOR_EMAIL: "t@acme.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@acme.test",
    },
  });

const write = (root: string, files: Readonly<Record<string, string>>) => {
  for (const [path, text] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), text);
  }
};

/** A tree: the seeds, then these files over them. */
const tree = (files: Readonly<Record<string, string>> = {}) => {
  const root = temp();
  writeSeed(root);
  write(root, files);
  return root;
};

describe("the arms", () => {
  it("is Peer as it is unless the environment names another", () => {
    expect(armOf({})).toBe("peer");
    expect(armOf({ LAB_PEER: "off" })).toBe("none");
    expect(armOf({ LAB_KERNEL: "1" })).toBe("kernel");
    expect(armOf({ LAB_KERNEL: "0" })).toBe("peer");
  });

  it("refuses two arms at once and a word it does not know", () => {
    expect(() => armOf({ LAB_PEER: "on" })).toThrow(/LAB_PEER is off/);
    expect(() => armOf({ LAB_KERNEL: "1", LAB_PEER: "off" })).toThrow(/2 arms/);
  });

  it("turns off what an operator can in the kernel arm, and nothing in the others", () => {
    expect(armEnv("none")).toEqual({});
    expect(armEnv("peer")).toEqual({});
    expect(armEnv("kernel")).toEqual({ PEER_JUJUTSU: "off" });
  });
});

describe("the project and the tasks", () => {
  it("starts in dollars, with nothing that says cents", () => {
    expect(Object.keys(SEED).toSorted()).toEqual([
      "package.json",
      "src/invoice.js",
      "src/receipt.js",
      "src/summary.js",
    ]);
    for (const text of Object.values(SEED)) expect(text).not.toMatch(/amountCents|cents/i);
    expect(SEED["src/invoice.js"]).toContain("in dollars");
  });

  it("asks Ana for the rename and Bob for a total that says nothing of it, neither naming the other", () => {
    expect(ANA_TASK).toContain("amountCents");
    expect(BOB_TASK).toContain("invoiceTotalLine");
    expect(BOB_TASK).not.toMatch(/cents|amountCents|renam/i);
    for (const task of [ANA_TASK, BOB_TASK]) {
      expect(task).not.toMatch(/\b(Ana|Bob|another agent|other agent|teammate)\b/);
      expect(task).toContain("do not run tests or builds");
    }
  });

  it("names each task in the branch, so that Peer knows which work an agent is on", () => {
    for (const task of TASKS) expect(task.branch.startsWith(task.key.toLowerCase())).toBe(true);
    // The hard run gives nothing of the change away where Peer shows it: titles and branches.
    for (const task of HARD_TASKS) {
      expect(task.branch.startsWith(task.key.toLowerCase())).toBe(true);
      expect(`${task.title} ${task.branch}`).not.toMatch(/cent|dollar|amount/i);
    }
  });
});

describe("the checks the agents never saw", () => {
  it("find the project as it started a consumer of the old contract, and not yet a provider", () => {
    const start = tree({ "src/total.js": TOTAL_IN_DOLLARS });
    expect(runCheck(start, "consumer-old", temp())).toMatchObject({ ok: true, kind: "pass" });
    expect(runCheck(start, "provider", temp()).ok).toBe(false);
  });

  it("find Ana's rename complete, and Bob's total in cents right against the merged contract", () => {
    const merged = tree({ ...ANA_FILES, "src/total.js": TOTAL_IN_CENTS });
    for (const which of ["provider", "consumer-new", "merged"] as const)
      expect(runCheck(merged, which, temp())).toMatchObject({ ok: true, kind: "pass" });
    // The old contract's invoices have no such method: a consumer of the new one crashes on them.
    const stale = runCheck(merged, "consumer-old", temp());
    expect(stale.kind).toBe("error");
    expect(stale.detail).toContain("invoice.amountCents is not a function");
  });

  it("find a total written against dollars broken once the method is replaced", () => {
    const merged = tree({ ...ANA_FILES, "src/total.js": TOTAL_IN_DOLLARS });
    const found = runCheck(merged, "merged", temp());
    expect(found.ok).toBe(false);
    expect(found.kind).toBe("error");
    expect(found.detail).toBe("invoice.amount is not a function");
  });

  it("find a total that reads cents as if they were dollars", () => {
    const asDollars = TOTAL_IN_CENTS.replace(" / 100", "");
    const found = runCheck(tree({ ...ANA_FILES, "src/total.js": asDollars }), "merged", temp());
    expect(found.detail).toContain('got "Total: $1600.00"');
  });

  it("find Ana's rename incomplete when a use was left on the old field", () => {
    const left = { ...ANA_FILES, "src/summary.js": SEED["src/summary.js"]! };
    expect(runCheck(tree(left), "provider", temp()).ok).toBe(false);
  });

  it("say a file or module that is not there is missing, not wrong", () => {
    expect(runCheck(tree(), "consumer-old", temp()).kind).toBe("missing");
    const lost = tree({ "src/total.js": 'import "./nowhere.js";\n' });
    expect(runCheck(lost, "consumer-old", temp()).kind).toBe("missing");
  });

  it("take an import an agent wrote without its extension", () => {
    const bare = tree({
      ...ANA_FILES,
      "src/total.js": `import "./invoice";\n${TOTAL_IN_CENTS}`,
    });
    expect(runCheck(bare, "merged", temp())).toMatchObject({ ok: true });
  });
});

/** An origin and the two checkouts of it, with each agent's files written and committed as the lab does. */
const world = (ana: Readonly<Record<string, string>>, bob: Readonly<Record<string, string>>) => {
  const root = temp();
  const seed = NodePath.join(root, "seed");
  writeSeed(seed);
  git(root, "init", "--quiet", "--initial-branch", "main", seed);
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "invoices");
  const origin = NodePath.join(root, "origin.git");
  git(root, "clone", "--quiet", "--bare", seed, origin);
  const checkouts = TASKS.map((task, at) => {
    const checkout = NodePath.join(root, at === 0 ? "ana" : "bob");
    git(root, "clone", "--quiet", origin, checkout);
    git(checkout, "checkout", "--quiet", "-b", task.branch);
    write(checkout, at === 0 ? ana : bob);
    return checkout;
  });
  const [anaCheckout, bobCheckout] = checkouts as [string, string];
  const committed = checkouts.map((checkout) => commitWork(checkout, "agent"));
  return {
    root,
    anaCheckout,
    bobCheckout,
    committed,
    run: () => {
      const scratch = NodePath.join(root, "scratch");
      NodeFS.mkdirSync(scratch);
      return integrate({
        origin,
        ana: { checkout: anaCheckout, branch: currentBranch(anaCheckout) },
        bob: { checkout: bobCheckout, branch: currentBranch(bobCheckout) },
        scratch,
      });
    },
  };
};

describe("merging what the agents did", () => {
  it("integrates cleanly when Bob wrote against the contract Ana changes it to", () => {
    const made = world(ANA_FILES, { "src/total.js": TOTAL_IN_CENTS });
    const result = made.run();
    expect(result).toMatchObject({
      merge: "clean",
      clean: true,
      written: "new",
      bobUsesCents: true,
      conflicts: [],
    });
    expect(result.ana.ok && result.bob.ok && result.merged?.ok).toBe(true);
  });

  it("does not integrate when Bob wrote against the contract he had", () => {
    const made = world(ANA_FILES, { "src/total.js": TOTAL_IN_DOLLARS });
    const result = made.run();
    expect(result).toMatchObject({
      merge: "clean",
      clean: false,
      written: "old",
      bobUsesCents: false,
    });
    expect(result.bob.ok).toBe(true);
    expect(result.merged?.detail).toBe("invoice.amount is not a function");
  });

  it("says when neither contract works for Bob's code, and when Ana did not make her change", () => {
    const made = world({}, { "src/total.js": TOTAL_IN_CENTS.replace(" / 100", "") });
    const result = made.run();
    expect(result.written).toBe("neither");
    expect(result.bob.ok).toBe(false);
    expect(result.bob.detail).toContain("and against the new contract");
    expect(result.ana.ok).toBe(false);
    expect(result.clean).toBe(false);
  });

  it("reports a conflict, and the files, when both agents changed one", () => {
    const made = world(ANA_FILES, {
      "src/total.js": TOTAL_IN_DOLLARS,
      "src/receipt.js": SEED["src/receipt.js"]!.replace(
        "invoice.amount().toFixed(2)",
        "Number(invoice.amount()).toFixed(2)",
      ),
    });
    const result = made.run();
    expect(result).toMatchObject({ merge: "conflict", clean: false, merged: undefined });
    expect(result.conflicts).toEqual(["src/receipt.js"]);
  });

  it("commits what an agent changed or added, never the state of a tool, and nothing when it did nothing", () => {
    const made = world(
      { ...ANA_FILES, ".codegraph/index.db": "binary", ".claude/settings.json": "{}" },
      {},
    );
    expect(made.committed[0]?.toSorted()).toEqual(Object.keys(ANA_FILES).toSorted());
    expect(made.committed[1]).toEqual([]);
    const before = git(made.bobCheckout, "rev-parse", "HEAD");
    expect(commitWork(made.bobCheckout, "again")).toEqual([]);
    expect(git(made.bobCheckout, "rev-parse", "HEAD")).toBe(before);
    expect(git(made.anaCheckout, "status", "--short")).toBe("");
  });

  it("counts what an agent committed itself as its change", () => {
    const made = world({}, {});
    write(made.bobCheckout, { "src/total.js": TOTAL_IN_DOLLARS });
    git(made.bobCheckout, "add", ".");
    git(made.bobCheckout, "commit", "--quiet", "-m", "the agent's own commit");
    expect(commitWork(made.bobCheckout, "the lab's")).toEqual(["src/total.js"]);
    expect(git(made.bobCheckout, "log", "--format=%s").trim().split("\n")).toEqual([
      "the agent's own commit",
      "invoices",
    ]);
  });
});

describe("what the report says", () => {
  const events: LabEvent[] = [
    { event: "cli", session: "a", command: "status", outcome: "done", out: "x".repeat(300) },
    {
      event: "cli",
      session: "a",
      command: "note",
      outcome: "refused",
      reason: "no one to note to",
    },
    { event: "hook", session: "claude:a", chars: 5000, answer: {} },
    { event: "hook", session: "claude:a", chars: 160, answer: {} },
    { event: "session.started", session: "claude:a" },
  ];

  it("counts what Peer added to the context, and the sessions", () => {
    const report = agentReport(events);
    expect(report.added).toEqual({
      hooks: 5160,
      commands: 300 + "no one to note to".length,
      chars: 5160 + 300 + "no one to note to".length,
    });
    expect(report.sessions).toBe(1);
  });

  it("prints each fact of the design's report on a line of its own", () => {
    const report = agentReport(events);
    const none = agentReport([]);
    const result: ContractResult = {
      arm: "peer",
      dry: true,
      integration: {
        ana: { ok: true, kind: "pass", detail: "passes" },
        bob: { ok: true, kind: "pass", detail: "passes" },
        written: "new",
        merge: "clean",
        conflicts: [],
        merged: { ok: true, kind: "pass", detail: "passes" },
        clean: true,
        bobUsesCents: true,
      },
      ana: report,
      bob: none,
    };
    const lines = formatResult(result);
    expect(lines[0]).toContain("arm: peer");
    expect(lines[0]).toContain("dry run");
    expect(lines[1]).toBe("clean integration: yes (merge clean; merged tree: passes)");
    expect(lines[4]).toBe("Bob's code uses amountCents: yes");
    expect(lines[5]).toContain(`Peer added to Ana's agent: ${report.added.chars} characters`);
    expect(lines[6]).toContain("Peer added to Bob's agent: 0 characters");
    expect(lines).toHaveLength(7);
    const failed = formatResult({
      ...result,
      integration: {
        ...result.integration,
        merge: "conflict",
        conflicts: ["src/receipt.js"],
        merged: undefined,
        clean: false,
        written: "neither",
        bob: { ok: false, kind: "mismatch", detail: "no" },
      },
    });
    expect(failed[1]).toBe(
      "clean integration: no (merge conflict: src/receipt.js; merged tree: not run)",
    );
    expect(failed[3]).toContain("works against NEITHER contract");
  });
});

describe("the scripted agents", () => {
  const fake = (name: string, root: string) => {
    const hooks: string[] = [];
    const edits: string[] = [];
    const agent: StubAgent = {
      name,
      file: (path) => NodePath.join(root, path),
      start: () => ({ told: "" }),
      hook: (event) => {
        hooks.push(event);
        return null;
      },
      edit: (event, path) => {
        edits.push(`${event} ${path}`);
        return null;
      },
      peer: () => "",
    };
    return { agent, hooks, edits };
  };

  it("write against the contract they had, and end their sessions", async () => {
    const root = temp();
    writeSeed(root);
    const ana = fake("Ana's agent", root);
    const bob = fake("Bob's agent", root);
    await runStub({ ana: ana.agent, bob: bob.agent, pause: async () => {} });
    expect(NodeFS.readFileSync(NodePath.join(root, "src/total.js"), "utf8")).toBe(TOTAL_IN_DOLLARS);
    expect(ana.edits).toContain("PreToolUse src/invoice.js");
    expect(bob.edits).toEqual(["PreToolUse src/total.js", "PostToolUse src/total.js"]);
    expect(ana.hooks.at(-1)).toBe("SessionEnd");
    expect(bob.hooks.at(-1)).toBe("SessionEnd");
  });
});
