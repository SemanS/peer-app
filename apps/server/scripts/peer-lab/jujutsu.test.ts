// @effect-diagnostics nodeBuiltinImport:off - the check script runs on trees in a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  POINTS_CHECK,
  SHOP_BASE,
  SHOP_CENTS,
  SHOP_POINTS,
  checkCommand,
  chosenSteps,
  convergedProblems,
  jjHomeEnv,
  logged,
  movedProblems,
  operationsBy,
  parseOperations,
  parseRows,
  protectedProblems,
  pushNoticeProblems,
  runPointsCheck,
  saying,
  stopGeneralProblems,
  stopNamedProblems,
  toldTo,
  undoneProblems,
} from "./jujutsu.ts";

describe("which steps run", () => {
  it("runs all seven unless some are named", () => {
    expect(chosenSteps(undefined)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(chosenSteps("")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(chosenSteps("all")).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the named steps once, in order", () => {
    expect(chosenSteps("6, 2,4,2")).toEqual([2, 4, 6]);
  });

  it("refuses a step that does not exist", () => {
    expect(() => chosenSteps("0")).toThrow(/steps 1 to 7/);
    expect(() => chosenSteps("2,8")).toThrow(/steps 1 to 7/);
    expect(() => chosenSteps("two")).toThrow(/steps 1 to 7/);
  });
});

it("gives jj a home and a config directory inside the lab", () => {
  expect(jjHomeEnv("/tmp/lab/jj-home")).toEqual({
    HOME: "/tmp/lab/jj-home",
    XDG_CONFIG_HOME: "/tmp/lab/jj-home/.config",
  });
});

it("leaves HOME alone for real agents, which sign in there", () => {
  expect(jjHomeEnv("/tmp/lab/jj-home", true)).toEqual({
    XDG_CONFIG_HOME: "/tmp/lab/jj-home/.config",
  });
});

describe("what jj prints", () => {
  it("reads changes with their versions and parents", () => {
    const rows = parseRows(
      ["slvzqzzymtyp\t1111\tfalse\t2222,3333", "mosmpwqylmmo\t4444\ttrue\t", ""].join("\n"),
    );
    expect(rows).toEqual([
      { change: "slvzqzzymtyp", commit: "1111", divergent: false, parents: ["2222", "3333"] },
      { change: "mosmpwqylmmo", commit: "4444", divergent: true, parents: [] },
    ]);
  });

  it("reads operations by who took them, the part of user@host that operation.username sets", () => {
    const operations = parseOperations(
      [
        "a27c3c03aa4e\tbob·codex@inv-1068.local\trestore into commit ac8515ad",
        "f06ed1ef9d4f\tpeer·follow@inv-1068.local\tfetch from git remote(s) origin",
        "d48d41eae37d\thotovo@inv-1068.local\tadd workspace 'wb'",
      ].join("\n"),
    );
    expect(operations.map((operation) => operation.who)).toEqual([
      "bob·codex",
      "peer·follow",
      "hotovo",
    ]);
    expect(operationsBy(operations, "peer·follow")).toEqual([
      {
        id: "f06ed1ef9d4f",
        who: "peer·follow",
        description: "fetch from git remote(s) origin",
      },
    ]);
  });
});

describe("what Peer told a session", () => {
  const answer = (session: string, text: string) => ({
    event: "hook",
    session,
    answer: { hookSpecificOutput: { additionalContext: text } },
  });
  const events = [
    answer("claude:jj-b", "ORD-11 moved under you."),
    answer("claude:jj-a", "something for A"),
    { event: "jujutsu.converged", session: "claude:jj-b", outcome: "done" },
  ];

  it("reads the texts of one session, whichever hook carried them", () => {
    expect(toldTo(events, "jj-b")).toEqual(["ORD-11 moved under you."]);
    expect(toldTo(events, "jj-a")).toEqual(["something for A"]);
  });

  it("counts a phrase and finds a session's log lines", () => {
    expect(saying(["a moved b", "nothing", "moved again"], "moved")).toBe(2);
    expect(logged(events, "jujutsu.converged", "jj-b")).toHaveLength(1);
    expect(logged(events, "jujutsu.converged", "jj-a")).toHaveLength(0);
  });
});

describe("the texts of the design", () => {
  const moved = [
    "ORD-11 moved under you. Ana's agent changed lrorvllt. jj moved your change onto the new version and updated your files. No conflict with your change.",
    "order.js +1: export const toEuros = (c) => c / 100;",
    "Full diff: jj interdiff --from d04206d3 --to lrorvllt",
  ].join("\n");
  const input = {
    task: "ORD-11",
    file: "order.js",
    added: "export const toEuros = (c) => c / 100;",
  };

  it("accepts the moved notice of the spec", () => {
    expect(movedProblems(moved, input)).toEqual([]);
  });

  it("names what a moved notice lacks, and its length", () => {
    expect(movedProblems(moved.replace("No conflict with your change.", ""), input)).toEqual([
      'lacks "No conflict with your change."',
    ]);
    expect(movedProblems(moved.replace("jj interdiff", "jj diff"), input)).toHaveLength(1);
    expect(movedProblems(`${moved}\n${"x".repeat(200)}`, input)).toEqual([
      expect.stringContaining("over 400"),
    ]);
  });

  it("accepts the protection notice and the two stops", () => {
    const notice = [
      `lrorvllt is Ana's change for ORD-11, so jj keeps it read-only in your workspace.`,
      `Keep the edit in your own change, or ask: peer ask ORD-11 "…"`,
    ].join("\n");
    const who = { change: "lrorvllt", person: "Ana", task: "ORD-11" };
    expect(protectedProblems(notice, who)).toEqual([]);
    expect(protectedProblems(notice.replace("read-only", "locked"), who)).toHaveLength(1);
    const stop = [
      "Peer stopped this command before it ran.",
      "--ignore-immutable would rewrite lrorvllt, Ana's change for ORD-11.",
      'Ask its agent: peer ask ORD-11 "…".',
      "A person can run it in a terminal.",
    ].join("\n");
    expect(stopNamedProblems(stop, who)).toEqual([]);
    expect(stopNamedProblems(stop.replace("ORD-11.", "ORD-12."), who)).toHaveLength(1);
    expect(stopGeneralProblems(stop)).toEqual([
      'lacks "--ignore-immutable can rewrite a teammate\'s change or landed history."',
    ]);
  });

  it("accepts the converge, push and undo notices", () => {
    expect(
      convergedProblems(
        "Peer merged two versions of your change slvz: another agent rewrote it. Re-read the files you edit before you change them again.",
      ),
    ).toEqual([]);
    expect(convergedProblems("Peer merged two versions of your change slvz")).toHaveLength(1);
    const push =
      "ORD-12 builds on lrorvllt (ORD-11), which has not landed, so the push carries both. Open its pull request with --base feature/ORD-11-cents. When ORD-11's pull request merges and its branch is deleted, GitHub moves this one onto main. Run the push again to go ahead.";
    const pushInput = { task: "ORD-12", otherTask: "ORD-11", base: "feature/ORD-11-cents" };
    expect(pushNoticeProblems(push, pushInput)).toEqual([]);
    expect(pushNoticeProblems(push, { ...pushInput, base: "main" })).toHaveLength(1);
    const undone =
      "Bob undid your step restore into commit ac8515ad (jj op revert). loyalty.js is back in your change. Re-read the files you edit.";
    expect(undoneProblems(undone, { person: "Bob", step: "restore into commit ac8515ad" })).toEqual(
      [],
    );
    expect(
      undoneProblems(undone, { person: "Ana", step: "restore into commit ac8515ad" }),
    ).toHaveLength(1);
  });
});

describe("the hidden-dependency check", () => {
  let directory = "";
  beforeAll(() => {
    directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-lab-jj-test-"));
    NodeFS.writeFileSync(NodePath.join(directory, "check.mjs"), POINTS_CHECK);
  });
  afterAll(() => NodeFS.rmSync(directory, { recursive: true, force: true }));

  const tree = (name: string, ...layers: ReadonlyArray<Readonly<Record<string, string>>>) => {
    const root = NodePath.join(directory, name);
    for (const layer of layers)
      for (const [path, text] of Object.entries(layer)) {
        NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
        NodeFS.writeFileSync(NodePath.join(root, path), text);
      }
    NodeFS.mkdirSync(root, { recursive: true });
    return root;
  };
  const script = () => NodePath.join(directory, "check.mjs");

  it("passes on Bob's points against euros", () => {
    expect(runPointsCheck(script(), tree("euros", SHOP_BASE, SHOP_POINTS))).toEqual({
      ok: true,
      output: "✔ loyalty points: 12.50 € gives 12 points",
    });
  });

  it("fails on the merge of both, with 1250 points", () => {
    expect(runPointsCheck(script(), tree("merged", SHOP_BASE, SHOP_CENTS, SHOP_POINTS))).toEqual({
      ok: false,
      output: "✖ loyalty points: 12.50 € gives 1250 points, expected 12",
    });
  });

  it("fails closed when there is nothing to check", () => {
    const empty = runPointsCheck(script(), tree("empty"));
    expect(empty.ok).toBe(false);
    expect(empty.output).toMatch(/^✖ /);
  });

  it("is a command a computer can keep, within the forecast's 200 characters", () => {
    expect(checkCommand("/tmp/lab/points-check.mjs")).toBe("node /tmp/lab/points-check.mjs");
    expect(
      checkCommand(`/var/folders/xl/${"x".repeat(60)}/T/peer-lab-AbCdEf/points-check.mjs`).length,
    ).toBeLessThan(200);
  });
});
