// @effect-diagnostics nodeBuiltinImport:off - the checks run on trees in a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  FOLLOW_AMEND_TASK,
  FOLLOW_BOB_TASK,
  LOYALTY_WITH_TO_EUROS,
  ORDERS_WITH_TO_EUROS,
  RECEIPT_WITH_TO_EUROS,
  checkFollowTree,
  convergesOf,
  editedPaths,
  exportsToEuros,
  followResult,
  formatFollow,
  lostEdits,
} from "./follow.ts";
import { HIDDEN_ANA_FILES, HIDDEN_SEED, LOYALTY_IN_EUROS } from "./hidden.ts";

const intent = (...paths: string[]) => ({
  event: "intent",
  verdicts: paths.map((path) => ({ path, verdict: "clear" })),
});
const hook = (text: string) => ({
  event: "hook",
  chars: text.length,
  answer: { hookSpecificOutput: { additionalContext: text } },
});

describe("what the log says was edited and what is gone", () => {
  it("lists each edited path once, in the order first seen, ignoring other events", () => {
    expect(
      editedPaths([
        intent("src/orders.js"),
        { event: "hook" },
        intent("src/receipt.js", "src/orders.js"),
        { event: "intent", verdicts: "none" },
      ]),
    ).toEqual(["src/orders.js", "src/receipt.js"]);
  });

  it("finds the edits whose files are no longer in the tree", () => {
    const present = new Set(["src/orders.js"]);
    expect(lostEdits(["src/orders.js", "src/loyalty.js"], (path) => present.has(path))).toEqual([
      "src/loyalty.js",
    ]);
    expect(lostEdits([], () => false)).toEqual([]);
  });

  it("counts converges by how they ended", () => {
    expect(
      convergesOf([
        { event: "jujutsu.converged", outcome: "done" },
        { event: "jujutsu.converged", outcome: "refused" },
        { event: "jujutsu.converged", outcome: "done" },
        { event: "jujutsu.snapshot" },
      ]),
    ).toEqual({ count: 3, done: 2, refused: 1 });
    expect(convergesOf([])).toEqual({ count: 0, done: 0, refused: 0 });
  });
});

it("recognises an orders.js that exports toEuros", () => {
  expect(exportsToEuros(ORDERS_WITH_TO_EUROS)).toBe(true);
  expect(exportsToEuros("export { orderTotal, toEuros };")).toBe(true);
  expect(exportsToEuros("const toEuros = (c) => c / 100;\nexport const orderTotal = 1;")).toBe(
    false,
  );
  expect(exportsToEuros("export const toEurosRounded = 1;")).toBe(false);
});

it("asks Bob for nothing that names cents, euros or Ana, and Ana for the helper", () => {
  expect(FOLLOW_BOB_TASK).not.toMatch(/cents|Ana|follow/i);
  expect(FOLLOW_AMEND_TASK).toContain("toEuros");
});

describe("whether Bob's final tree is right", () => {
  let directory = "";
  beforeAll(() => {
    directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-lab-follow-test-"));
  });
  afterAll(() => NodeFS.rmSync(directory, { recursive: true, force: true }));

  const tree = (name: string, files: Readonly<Record<string, string>>) => {
    const root = NodePath.join(directory, name);
    for (const [path, text] of Object.entries({ ...HIDDEN_SEED, ...files })) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, path), text);
    }
    return root;
  };
  const amended = {
    ...HIDDEN_ANA_FILES,
    "src/orders.js": ORDERS_WITH_TO_EUROS,
    "src/receipt.js": RECEIPT_WITH_TO_EUROS,
  };
  const work = () => NodePath.join(directory, "work");

  it("is right with Ana's amend and points that follow it", () => {
    const right = tree("right", { ...amended, "src/loyalty.js": LOYALTY_WITH_TO_EUROS });
    expect(checkFollowTree(right, work())).toMatchObject({ ok: true, kind: "pass" });
  });

  it("is not right when Bob's points are written for euros", () => {
    const wrong = tree("euros", { ...amended, "src/loyalty.js": LOYALTY_IN_EUROS });
    const check = checkFollowTree(wrong, work());
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("12.50 euros earn 12 points");
  });

  it("is not right without Ana's amend, even when everything else passes", () => {
    const stale = tree("stale", {
      ...HIDDEN_ANA_FILES,
      "src/loyalty.js":
        "import { orderTotal } from './orders.js';\nexport const loyaltyPoints = (o) => Math.floor(orderTotal(o) / 100);\n",
    });
    expect(checkFollowTree(stale, work())).toMatchObject({
      ok: false,
      kind: "missing",
      detail: expect.stringContaining("Ana's amend"),
    });
  });
});

it("reports a run: the tree, lost edits, converges, moved notices and what Peer added", () => {
  const moved = "KRK-1 moved under you. Ana's agent changed lrorvllt.";
  const result = followResult({
    dry: false,
    tree: { ok: true, kind: "pass", detail: "passes" },
    present: (path) => path !== "src/gone.js",
    ana: [intent("src/orders.js"), { event: "jujutsu.converged", outcome: "done" }],
    bob: [
      intent("src/loyalty.js", "src/gone.js"),
      hook(moved),
      hook("something else"),
      { event: "jujutsu.converged", outcome: "refused" },
    ],
    twoVersions: 1,
  });
  expect(result).toMatchObject({
    lost: ["src/gone.js"],
    converges: { count: 2, done: 1, refused: 1 },
    moved: 1,
    twoVersions: 1,
    added: { hooks: moved.length + "something else".length },
  });
  expect(formatFollow(result)).toEqual([
    "real agents",
    "Bob's final tree: right (cents, receipt and VAT as before, 12.50 euros earn 12 points, and Ana's amend is in it)",
    "edits lost: 1 (src/gone.js)",
    "converges Peer ran: 2 (done 1, refused 1); changes left with two versions: 1",
    "moved notices Bob's agent heard: 1",
    `Peer added to Bob's agent: ${moved.length + "something else".length} characters (hooks ${moved.length + "something else".length}, commands 0)`,
  ]);
});

it("says plainly when the tree is wrong and nothing was lost", () => {
  const lines = formatFollow(
    followResult({
      dry: true,
      tree: {
        ok: false,
        kind: "mismatch",
        detail: "12.50 euros earn 12 points: expected 12, got 1250",
      },
      present: () => true,
      ana: [],
      bob: [],
      twoVersions: 0,
    }),
  );
  expect(lines[0]).toBe("dry run: scripted stand-ins for both agents");
  expect(lines[1]).toBe(
    "Bob's final tree: NOT right: 12.50 euros earn 12 points: expected 12, got 1250",
  );
  expect(lines[2]).toBe("edits lost: none");
});
