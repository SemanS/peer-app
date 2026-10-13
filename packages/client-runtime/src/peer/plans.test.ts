import { describe, expect, it } from "vite-plus/test";
import type {
  PeerPlan,
  PeerPlanRelation,
  PeerPlanSide,
  PeerPlansStatus,
  PeerPlansView,
} from "@t3tools/contracts";
import {
  livePlansForTask,
  planItemLabel,
  planItemWhat,
  planKindLabel,
  planProvidesLine,
  planRelationMark,
  planRelationsForTask,
  plansBadgeText,
  plansPlanCount,
  plansRelationCount,
} from "./plans.ts";

const side = (
  session: string,
  task: string | undefined,
  email = "ana@acme.test",
): PeerPlanSide => ({
  session,
  email,
  environment: "mac",
  label: `Work ${session}`,
  ...(task === undefined ? {} : { task }),
});
const relation = (id: string, over: Partial<PeerPlanRelation> = {}): PeerPlanRelation => ({
  id,
  kind: "use",
  project: "pay",
  a: side("claude:b", "ord-9", "bob@acme.test"),
  b: side("codex:a", "ord-11"),
  item: { path: "src/tax.ts", name: "applyTax" },
  certain: true,
  observed: false,
  ...over,
});
const plan = (
  session: string,
  task: string | undefined,
  over: Partial<PeerPlan> = {},
): PeerPlan => ({
  project: "pay",
  session,
  email: "bob@acme.test",
  environment: "mac",
  ...(task === undefined ? {} : { task }),
  label: `Work ${session}`,
  seq: 1,
  version: 1,
  changes: [],
  maybes: [],
  uses: [],
  provides: [],
  declaredAt: "2026-10-12T20:00:00Z",
  updatedAt: "2026-10-12T20:00:00Z",
  live: true,
  ...over,
});
const view = (relations: ReadonlyArray<PeerPlanRelation>, plans: ReadonlyArray<PeerPlan> = []) =>
  ({ plans, relations, omitted: 0, at: "2026-10-12T20:13:00Z" }) satisfies PeerPlansView;

describe("relations seen from one task's side", () => {
  it("tells a use to its user as uses-their-change and to its changer as changes-their-use", () => {
    const shown = view([relation("u1", { contract: "takes cents, returns cents" })]);
    const user = planRelationsForTask(shown, { task: "ord-9" });
    expect(user).toHaveLength(1);
    expect(user[0]).toMatchObject({
      kind: "uses-their-change",
      own: { task: "ord-9" },
      other: { task: "ord-11" },
      item: { path: "src/tax.ts", name: "applyTax" },
      contract: "takes cents, returns cents",
    });
    const changer = planRelationsForTask(shown, { task: "ord-11" });
    expect(changer[0]).toMatchObject({
      kind: "changes-their-use",
      own: { task: "ord-11" },
      other: { task: "ord-9" },
    });
  });

  it("tells a same-change to both sides, naming the other work", () => {
    const shown = view([relation("s1", { kind: "same-change", certain: false })]);
    expect(planRelationsForTask(shown, { task: "ord-9" })[0]).toMatchObject({
      kind: "same-change",
      certain: false,
      other: { task: "ord-11" },
    });
    expect(planRelationsForTask(shown, { task: "ord-11" })[0]).toMatchObject({
      kind: "same-change",
      other: { task: "ord-9" },
    });
  });

  it("leaves out other tasks, other projects and sessions on no task", () => {
    const shown = view([
      relation("a"),
      relation("b", { project: "other" }),
      relation("c", { a: side("claude:x", undefined), b: side("codex:y", undefined) }),
    ]);
    expect(planRelationsForTask(shown, { task: "ord-9" }).map((row) => row.id)).toEqual(["a", "b"]);
    expect(planRelationsForTask(shown, { task: "ord-9", project: "pay" }).map((r) => r.id)).toEqual(
      ["a"],
    );
    expect(planRelationsForTask(shown, { task: "ord-1" })).toEqual([]);
    expect(planRelationsForTask(undefined, { task: "ord-9" })).toEqual([]);
  });

  it("orders uses before changes before same-change, certain and declared first", () => {
    const shown = view([
      relation("same", { kind: "same-change" }),
      relation("observed", { observed: true }),
      relation("maybe", { certain: false }),
      relation("certain", { item: { path: "src/b.ts" } }),
      relation("theirs", { a: side("codex:a", "ord-11"), b: side("claude:b", "ord-9") }),
    ]);
    expect(planRelationsForTask(shown, { task: "ord-9" }).map((row) => [row.id, row.kind])).toEqual(
      [
        ["certain", "uses-their-change"],
        ["observed", "uses-their-change"],
        ["maybe", "uses-their-change"],
        ["theirs", "changes-their-use"],
        ["same", "same-change"],
      ],
    );
  });
});

describe("a task's live plans", () => {
  it("lists those of the task that are live, the newest first", () => {
    const plans = [
      plan("a", "ord-9", { updatedAt: "2026-10-12T20:01:00Z" }),
      plan("b", "ord-9", { updatedAt: "2026-10-12T20:05:00Z" }),
      plan("c", "ord-9", { live: false }),
      plan("d", "ord-11"),
      plan("e", "ord-9", { project: "other" }),
    ];
    expect(livePlansForTask(view([], plans), { task: "ord-9" }).map((p) => p.session)).toEqual([
      "b",
      "a",
      "e",
    ]);
    expect(
      livePlansForTask(view([], plans), { task: "ord-9", project: "pay" }).map((p) => p.session),
    ).toEqual(["b", "a"]);
    expect(livePlansForTask(undefined, { task: "ord-9" })).toEqual([]);
  });
});

describe("the words", () => {
  it("names the kinds and marks what a relation rests on", () => {
    expect(planKindLabel("uses-their-change")).toBe("Uses their change");
    expect(planKindLabel("changes-their-use")).toBe("Changes their use");
    expect(planKindLabel("same-change")).toBe("Same change");
    const item = { path: "src/tax.ts", name: "applyTax" };
    expect(planRelationMark({ certain: true, observed: false, item })).toBe("Certain");
    expect(planRelationMark({ certain: true, observed: true, item })).toBe(
      "Observed: reported by the session, not declared in a plan",
    );
    expect(
      planRelationMark({ certain: false, observed: false, item: { path: "src/payments/" } }),
    ).toBe("Uncertain: a plan names the directory as maybe");
    expect(planRelationMark({ certain: false, observed: false, item })).toBe(
      "Uncertain: a plan names the symbol as maybe",
    );
    expect(planRelationMark({ certain: false, observed: false, item: { path: "src/a.ts" } })).toBe(
      "Uncertain: a plan names the file as maybe",
    );
    expect(planRelationMark({ certain: false, observed: true, item })).toContain("Observed");
  });

  it("writes items and contract lines as agents and people read them", () => {
    expect(planItemLabel({ path: "src/tax.ts", name: "applyTax" })).toBe("src/tax.ts#applyTax");
    expect(planItemLabel({ path: "src/payments/" })).toBe("src/payments/");
    expect(planItemWhat({ path: "src/tax.ts", name: "applyTax" })).toBe("applyTax (src/tax.ts)");
    expect(planItemWhat({ path: "src/payments/totals.ts" })).toBe("src/payments/totals.ts");
    expect(
      planProvidesLine({
        name: "Fee.refundCents",
        path: "src/payments/fees.ts",
        contract: "integer cents, never negative",
      }),
    ).toBe("Fee.refundCents (src/payments/fees.ts): integer cents, never negative");
  });
});

describe("counts from the status field", () => {
  const status: PeerPlansStatus = {
    enabled: true,
    forcedOff: false,
    hubSupport: "supported",
    revision: 3,
    counts: [
      { workspace: "acme", project: "pay", task: "ord-9", plans: 1, relations: 3 },
      { workspace: "acme", project: "pay", task: "ord-11", plans: 1, relations: 1 },
      { workspace: "acme", project: "web", task: "ord-9", plans: 2, relations: 4 },
      { workspace: "other", project: "pay", task: "ord-9", plans: 9, relations: 9 },
    ],
  };

  it("sums a task, a project or a workspace, and nothing without a status", () => {
    expect(plansRelationCount(status, { workspace: "acme", project: "pay", task: "ord-9" })).toBe(
      3,
    );
    expect(plansRelationCount(status, { workspace: "acme", project: "pay" })).toBe(4);
    expect(plansRelationCount(status, { workspace: "acme" })).toBe(8);
    expect(plansPlanCount(status, { workspace: "acme", task: "ord-9" })).toBe(3);
    expect(plansRelationCount(status, { workspace: "acme", task: "unknown" })).toBe(0);
    expect(plansRelationCount(undefined, { workspace: "acme" })).toBe(0);
    expect(plansPlanCount(undefined, { workspace: "acme" })).toBe(0);
  });

  it("words the count on a task's page, and says nothing for none", () => {
    expect(plansBadgeText(1)).toBe("Plans · 1 relation");
    expect(plansBadgeText(3)).toBe("Plans · 3 relations");
    expect(plansBadgeText(0)).toBeNull();
  });
});
