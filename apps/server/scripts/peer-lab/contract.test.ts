// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab fixture checks on throwaway git repositories; no servers.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { isPlainCliCall } from "../../src/peerHub/core/coordination/edits.ts";
import {
  ANA_FILES,
  ANA_PLAN,
  ANA_TASK,
  BOB_PLAN,
  BOB_TASK,
  SEED,
  TASKS,
  TOTAL_IN_CENTS,
  TOTAL_IN_DOLLARS,
  agentReport,
  armEnv,
  armOf,
  asksForPlan,
  commitWork,
  contractFor,
  currentBranch,
  formatResult,
  heardNewContract,
  impactLines,
  indexCheckout,
  integrate,
  plansChars,
  runCheck,
  runStub,
  suggestedContract,
  syncCheckout,
  type Arm,
  type ContractResult,
  type StubAgent,
  writeSeed,
} from "./contract.ts";
import { START_WORDS } from "./plans.ts";
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
  it("is the plans arm unless the environment names another", () => {
    expect(armOf({})).toBe("plans");
    expect(armOf({ LAB_PLANS: "on" })).toBe("plans");
    expect(armOf({ LAB_PLANS: "off" })).toBe("off");
    expect(armOf({ LAB_IMPACT_ONLY: "1" })).toBe("impact");
    expect(armOf({ LAB_IMPACT_ONLY: "0" })).toBe("plans");
  });

  it("refuses two arms at once and a word it does not know", () => {
    expect(() => armOf({ LAB_PLANS: "off", LAB_IMPACT_ONLY: "1" })).toThrow(/2 arms/);
    expect(() => armOf({ LAB_PLANS: "on", LAB_IMPACT_ONLY: "1" })).toThrow(/2 arms/);
    expect(() => armOf({ LAB_PLANS: "maybe" })).toThrow(/off or on/);
  });

  it("turns the plugins off by the operator's switches, and takes away one the lab inherited", () => {
    expect(armEnv("off")).toEqual({ PEER_PLANS: "off", PEER_IMPACT: "off" });
    expect(armEnv("impact")).toEqual({ PEER_PLANS: "off", PEER_IMPACT: undefined });
    expect(armEnv("plans")).toEqual({ PEER_PLANS: undefined, PEER_IMPACT: undefined });
    // `undefined` drops the variable from a child's environment, even one the operator set.
    const env = { PEER_PLANS: "off", PATH: process.env.PATH, ...armEnv("plans") };
    const child = NodeChildProcess.spawnSync(process.execPath, ["-p", "process.env.PEER_PLANS"], {
      env,
      encoding: "utf8",
    });
    expect(child.stdout.trim()).toBe("undefined");
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
    { event: "cli", session: "a", command: "plan", outcome: "done", out: "x".repeat(300) },
    {
      event: "cli",
      session: "a",
      command: "plan",
      outcome: "refused",
      reason: "no plan to withdraw",
    },
    { event: "cli", session: "a", command: "status", outcome: "done", out: "y".repeat(100) },
    { event: "hook", session: "claude:a", chars: 5000, answer: {} },
    { event: "hook", session: "claude:a", chars: 160, answer: {} },
    { event: "plans.declared", session: "claude:a", chars: 300 },
    { event: "plans.told", session: "claude:a", chars: 213 },
    { event: "plans.nudged", session: "claude:a", where: "start" },
    { event: "impact.told", session: "claude:a", chars: 90 },
    { event: "session.started", session: "claude:a" },
  ];

  it("counts the plan commands by how they ended, and what Peer added to the context", () => {
    const report = agentReport(events);
    expect(report.ran).toBe(2);
    expect(report.outcomes).toEqual({ done: 1, refused: 1 });
    expect(report.answers).toEqual({ count: 1, chars: 300 });
    expect(report.notices).toEqual({ count: 1, chars: 213 });
    expect(report.nudges).toBe(1);
    expect(report.impact).toEqual({ count: 1, chars: 90 });
    expect(report.added).toEqual({
      hooks: 5160,
      commands: 300 + "no plan to withdraw".length + 100,
      chars: 5160 + 419,
    });
    expect(report.sessions).toBe(1);
    expect(plansChars(report)).toBe(START_WORDS.length + 300 + 213);
  });

  it("prints each fact of the design's report on a line of its own", () => {
    const report = agentReport(events);
    const none = agentReport([]);
    const result: ContractResult = {
      arm: "plans",
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
    expect(lines).toHaveLength(9);
    expect(lines[0]).toContain("arm: plans");
    expect(lines[0]).toContain("dry run");
    expect(lines[1]).toBe("clean integration: yes (merge clean; merged tree: passes)");
    expect(lines[4]).toBe("Bob's code uses amountCents: yes");
    expect(lines[5]).toBe("Ana's agent ran peer plan: yes, 2 times (done 1, refused 1)");
    expect(lines[6]).toBe("Bob's agent ran peer plan: no");
    expect(lines[7]).toContain("Peer added to Ana's agent: 5579 characters");
    expect(lines[7]).toContain(`Of them plans: ${START_WORDS.length + 300 + 213}`);
    expect(lines[8]).toContain("Peer added to Bob's agent: 0 characters");
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

describe("what Impact holds at the Hub", () => {
  it("says there is no pair when the Hub holds none, or Impact is not served", () => {
    expect(impactLines({ records: [], provided: [] })).toEqual([
      "Impact at the Hub: no pair of works",
    ]);
    expect(impactLines(undefined)).toEqual(["Impact at the Hub: no pair of works"]);
  });

  it("names each pair, what changed in it and who uses it", () => {
    const view = {
      records: [
        {
          sides: [{ task: "krk-1" }, { task: "krk-2" }],
          items: [
            {
              name: "amount",
              path: "src/invoice.js",
              change: "removed",
              from: [{ name: "invoiceTotalLine" }],
            },
            { name: "amountCents", path: "src/invoice.js", change: "signature", from: [] },
          ],
        },
      ],
      provided: [],
    };
    expect(impactLines(view)).toEqual([
      "Impact at the Hub: 1 pair of works",
      "  krk-1 and krk-2: removed amount (src/invoice.js), used by invoiceTotalLine; signature amountCents (src/invoice.js), used by nobody listed",
    ]);
  });
});

describe("the scripted agents", () => {
  const notice =
    '[Peer] KRK-2 · Bob’s agent plans to use Invoice.amount (src/invoice.js), which your plan changes. If its contract changes, update your contract line: peer plan --amend --provides "Invoice.amount (src/invoice.js): <contract>".';

  it("read Peer's words: the line that asks for a plan, the suggested contract line, the new contract", () => {
    expect(
      asksForPlan([
        "You are Ana's agent here.",
        'Before your first edit run peer plan --change <path[#symbol]> --uses <path#symbol> --provides "<symbol> (<path>): <contract>"; it shows whose work meets yours.',
      ]),
    ).toBe(true);
    expect(asksForPlan(["You are Ana's agent here."])).toBe(false);
    expect(suggestedContract(["nothing", notice])).toEqual({
      symbol: "Invoice.amount",
      path: "src/invoice.js",
    });
    expect(suggestedContract(["nothing"])).toBeUndefined();
    expect(
      heardNewContract([`- Invoice.amount (src/invoice.js): ${contractFor("Invoice.amount")}`]),
    ).toBe(true);
    expect(heardNewContract(["uses-their-change  Invoice.amount (src/invoice.js)"])).toBe(false);
  });

  it("run only commands Peer lets through without asking: no $, backtick or backslash inside quotes", () => {
    const amend = [
      "plan",
      "--amend",
      "--provides",
      `Invoice.amount (src/invoice.js): ${contractFor("Invoice.amount")}`,
    ];
    for (const args of [ANA_PLAN, BOB_PLAN, amend]) {
      const command = `peer ${args.map((arg) => `"${arg}"`).join(" ")}`;
      expect(isPlainCliCall(command, "peer")).toBe(true);
    }
  });

  /** A simulated agent whose steps answer from a script, and which records the commands it ran. */
  const fake = (
    name: string,
    root: string,
    start: string,
    steps: ReadonlyArray<string | undefined>,
  ) => {
    const peers: string[][] = [];
    const hooks: string[] = [];
    const edits: string[] = [];
    let step = 0;
    const agent: StubAgent = {
      name,
      file: (path) => NodePath.join(root, path),
      start: () => ({ told: start }),
      hook: (event) => {
        hooks.push(event);
        if (event !== "UserPromptSubmit") return null;
        const said = steps[step];
        step += 1;
        return said === undefined ? null : { hookSpecificOutput: { additionalContext: said } };
      },
      edit: (event, path) => {
        edits.push(`${event} ${path}`);
        return null;
      },
      peer: (...args) => {
        peers.push(args);
        return `answer ${peers.length}`;
      },
    };
    return { agent, peers, hooks, edits };
  };
  const nudge = "Before your first edit run peer plan --change <path[#symbol]> ...";
  const told = () => {};
  const pause = async () => {};
  const arrange = async (arm: Arm, asked: boolean) => {
    const root = temp();
    const ana = fake("Ana's agent", root, asked ? nudge : "hello", [undefined, undefined, notice]);
    const bob = fake("Bob's agent", root, asked ? nudge : "hello", [
      undefined,
      undefined,
      `[Peer] KRK-1 · Ana’s agent plans to change Invoice.amount (src/invoice.js). Their contract (teammate text):\n- Invoice.amount (src/invoice.js): ${contractFor("Invoice.amount")}`,
    ]);
    const heard = await runStub({ ana: ana.agent, bob: bob.agent, arm, pause, told });
    return {
      root,
      ana,
      bob,
      heard,
      total: () => NodeFS.readFileSync(NodePath.join(root, "src/total.js"), "utf8"),
    };
  };

  it("with plans on, declare when asked, amend as the notice says, and write against the contract they heard", async () => {
    const run = await arrange("plans", true);
    expect(run.ana.peers).toEqual([
      [...ANA_PLAN],
      [
        "plan",
        "--amend",
        "--provides",
        `Invoice.amount (src/invoice.js): ${contractFor("Invoice.amount")}`,
      ],
    ]);
    expect(run.bob.peers).toEqual([[...BOB_PLAN]]);
    expect(run.total()).toBe(TOTAL_IN_CENTS);
    expect(NodeFS.readFileSync(NodePath.join(run.root, "src/receipt.js"), "utf8")).toBe(
      ANA_FILES["src/receipt.js"],
    );
    // The new method goes in first and the old one comes out last, once the callers use the new.
    expect(run.ana.edits.filter((edit) => edit.startsWith("PostToolUse"))).toEqual([
      "PostToolUse src/invoice.js",
      "PostToolUse src/receipt.js",
      "PostToolUse src/summary.js",
      "PostToolUse src/invoice.js",
    ]);
    expect(NodeFS.readFileSync(NodePath.join(run.root, "src/invoice.js"), "utf8")).toBe(
      ANA_FILES["src/invoice.js"],
    );
    expect(run.ana.hooks.at(-1)).toBe("SessionEnd");
    expect(run.bob.hooks.at(-1)).toBe("SessionEnd");
    expect(run.heard.bob.some((text) => text.includes("answer 1"))).toBe(true);
  });

  it("where nothing asks for a plan, run no plan command and write against the contract they had", async () => {
    for (const arm of ["off", "impact"] as const) {
      const run = await arrange(arm, false);
      expect(run.ana.peers).toEqual([]);
      expect(run.bob.peers).toEqual([]);
      expect(run.total()).toBe(TOTAL_IN_DOLLARS);
    }
  });
});

describe("the code index for the Impact arm", () => {
  /** A stand-in `codegraph` that records how it was called and fails the call named in `FAIL`. */
  const stand = (root: string) => {
    const calls = NodePath.join(root, "calls.txt");
    const binary = NodePath.join(root, "codegraph");
    NodeFS.writeFileSync(
      binary,
      `#!/bin/sh\necho "$1 $2" >> "${calls}"\n[ "$1" = "$FAIL" ] && { echo "$1 failed" >&2; exit 3; }\nmkdir -p "$2/.codegraph" && echo index > "$2/.codegraph/codegraph.db"\nexit 0\n`,
      { mode: 0o755 },
    );
    return { binary, calls: () => NodeFS.readFileSync(calls, "utf8").trim().split("\n") };
  };

  it("makes the index of a checkout: init, then index, keeping the index out of what git shows", () => {
    const root = temp();
    git(root, "init", "--quiet");
    const codegraph = stand(root);
    // What the stand-in leaves is its own script and calls file: only the index is the tool's state.
    NodeFS.writeFileSync(NodePath.join(root, ".gitignore"), "calls.txt\ncodegraph\n");
    expect(indexCheckout(codegraph.binary, root)).toEqual({ ok: true, detail: "indexed" });
    expect(codegraph.calls()).toEqual([`init ${root}`, `index ${root}`]);
    expect(NodeFS.existsSync(NodePath.join(root, ".codegraph", "codegraph.db"))).toBe(true);
    expect(git(root, "status", "--short").trim()).toBe("?? .gitignore");
  });

  it("brings an index up to date, and says when it could not", () => {
    const root = temp();
    const codegraph = stand(root);
    expect(syncCheckout(codegraph.binary, root)).toBe(true);
    expect(codegraph.calls()).toEqual([`sync ${root}`]);
    process.env.FAIL = "sync";
    try {
      expect(syncCheckout(codegraph.binary, root)).toBe(false);
    } finally {
      delete process.env.FAIL;
    }
  });

  it("says which step failed and why, and goes no further", () => {
    const root = temp();
    const codegraph = stand(root);
    process.env.FAIL = "init";
    try {
      const failed = indexCheckout(codegraph.binary, root);
      expect(failed.ok).toBe(false);
      expect(failed.detail).toContain("codegraph init ended 3");
      expect(failed.detail).toContain("init failed");
      expect(codegraph.calls()).toEqual([`init ${root}`]);
    } finally {
      delete process.env.FAIL;
    }
  });
});
