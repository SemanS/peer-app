import type { PeerHubStatus, PeerPlansStatus, PeerPlansView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  NOW,
  PAY,
  TASKS,
  anaCodex,
  bobClaude,
  bobCodex,
  bobOther,
  bobsPlan,
  challenge,
  everyone,
  meetings,
  plan,
  relation,
  session,
  side,
  status,
  task,
  view,
} from "../testing/peerPlans.ts";
import {
  NO_PLAN_LINE,
  planChallengesForTask,
  plansBadge,
  plansSectionEmpty,
  plansSectionModel,
} from "./plansView.ts";

const model = (
  sessions: ReadonlyArray<object>,
  shown: PeerPlansView | undefined,
  taskId = "ord-9",
  tasks: ReadonlyArray<object> = TASKS,
) =>
  plansSectionModel({
    status: status(sessions, tasks),
    ...PAY,
    task: taskId,
    view: shown,
    now: NOW,
  });

describe("a task's plans", () => {
  it("lists a live plan with its items, its contract lines and what it meets, as the design shows it", () => {
    const { cards, loose } = model(everyone, view([bobsPlan], meetings));
    const card = cards[0];
    expect(card).toMatchObject({
      kind: "plan",
      agent: "Bob’s Claude",
      initial: "B",
      mine: true,
      heading: "Plan v2 · declared 12 min ago",
      changes: [
        { text: "src/payments/fees.ts#Fee.refundCents", maybe: false },
        { text: "src/payments/", maybe: true },
      ],
      uses: ["src/tax.ts#applyTax"],
      provides: ["Fee.refundCents (src/payments/fees.ts): integer cents, never negative"],
    });
    expect(card?.relations.map((line) => [line.kindLabel, line.item, line.who, line.mark])).toEqual(
      [
        [
          "Uses their change",
          "applyTax (src/tax.ts)",
          "ORD-11 · Ana’s agent plans to change it",
          "Certain",
        ],
        [
          "Uses their change",
          "src/payments/totals.ts",
          "ORD-11 · Ana’s session already changed it",
          "Observed: reported by the session, not declared in a plan",
        ],
        [
          "Same change",
          "src/payments/refunds.ts",
          "ORD-15 · Bob’s other work also plans to change it",
          "Uncertain: a plan names the file as maybe",
        ],
      ],
    );
    expect(loose).toEqual([]);
  });

  it("carries the other side's contract line only for a use of what its plan provides", () => {
    const [contract, observed, maybe] = model(everyone, view([bobsPlan], meetings)).cards[0]!
      .relations;
    expect(contract?.contract).toBe("applyTax (src/tax.ts): takes cents, returns cents");
    expect(observed?.contract).toBeNull();
    expect(maybe?.contract).toBeNull();
  });

  it("lets the person open the other task, when the project lists it", () => {
    const [contract, observed, maybe] = model(everyone, view([bobsPlan], meetings)).cards[0]!
      .relations;
    expect(contract?.open).toEqual({ task: "ord-11", label: "ORD-11" });
    expect(observed?.open).toEqual({ task: "ord-11", label: "ORD-11" });
    expect(maybe?.open).toEqual({ task: "ord-15", label: "ORD-15" });
    const unknown = relation("r-gone", { b: { ...side(anaCodex), task: "ord-404" } });
    expect(model(everyone, view([bobsPlan], [unknown])).cards[0]?.relations[0]?.open).toBeNull();
  });

  it("tells the changer's side of a use: its task changes what another uses", () => {
    const anasPlan = plan(anaCodex, {
      changes: [{ path: "src/tax.ts", name: "applyTax" }],
      provides: [{ name: "applyTax", path: "src/tax.ts", contract: "takes cents, returns cents" }],
    });
    const shown = view([anasPlan], [meetings[0]!, meetings[2]!]);
    const { cards } = model(everyone, shown, "ord-11");
    expect(cards[0]).toMatchObject({ agent: "Ana’s Codex", initial: "A", mine: false });
    expect(
      cards[0]?.relations.map((line) => [line.kindLabel, line.who, line.contract, line.mark]),
    ).toEqual([
      ["Changes their use", "ORD-9 · Bob’s agent plans to use it", null, "Certain"],
      [
        "Changes their use",
        "ORD-9 · Bob’s agent plans to use it; this session already changed it",
        null,
        "Observed: reported by the session, not declared in a plan",
      ],
    ]);
  });
});

describe("a task's agents without a plan", () => {
  it("names each agent on the task that declared none, yours first", () => {
    const anaClaude = session("claude:a2", "ana@acme.test", "ord-9");
    const sessions = [anaClaude, bobCodex, bobClaude, bobOther];
    const { cards } = model(sessions, view([bobsPlan], meetings));
    expect(cards.map((card) => [card.kind, card.agent, card.mine])).toEqual([
      ["plan", "Bob’s Claude", true],
      ["no-plan", "Bob’s Codex", true],
      ["no-plan", "Ana’s Claude", false],
    ]);
    expect(cards[1]).toMatchObject({ line: NO_PLAN_LINE, relations: [] });
    expect(NO_PLAN_LINE).toBe(
      "has not declared a plan. Its reported changes still count for other works’ relations.",
    );
  });

  it("lists what another work's plan meets in an agent's reported changes under that agent", () => {
    // Ana's session declared nothing, yet its reported change of src/payments/totals.ts counts.
    const observed = relation("r-reported", {
      a: side(bobClaude),
      b: side(anaCodex),
      item: { path: "src/payments/totals.ts" },
      observed: true,
    });
    const { cards, loose } = model(everyone, view([bobsPlan], [observed]), "ord-11");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "no-plan", agent: "Ana’s Codex" });
    expect(cards[0]?.relations[0]).toMatchObject({
      kindLabel: "Changes their use",
      who: "ORD-9 · Bob’s agent plans to use it; this session already changed it",
    });
    expect(loose).toEqual([]);
  });

  it("leaves out agents on other tasks, other projects and sessions of no task", () => {
    const elsewhere = session("claude:z1", "ana@acme.test", "ord-11");
    const otherProject = session("claude:z2", "ana@acme.test", "ord-9", { project: "web" });
    const unplaced = session("claude:z3", "ana@acme.test", undefined);
    const { cards } = model([bobCodex, elsewhere, otherProject, unplaced], view([], []));
    expect(cards.map((card) => card.agent)).toEqual(["Bob’s Codex"]);
  });

  it("does not count a plan that is no longer live", () => {
    const ended = plan(bobClaude, { live: false, changes: [{ path: "src/a.ts" }] });
    const { cards } = model([bobClaude], view([ended], []));
    expect(cards.map((card) => card.kind)).toEqual(["no-plan"]);
  });
});

describe("what the section keeps true", () => {
  it("lists a relation no listed agent owns, so the count on the task's page matches", () => {
    // The status has not heard of Bob's Claude yet: the view names it first.
    const { cards, loose } = model([], view([], [meetings[0]!]));
    expect(cards).toEqual([]);
    expect(loose.map((line) => line.who)).toEqual(["ORD-11 · Ana’s agent plans to change it"]);
    expect(plansSectionEmpty({ cards, loose })).toBe(false);
  });

  it("has nothing to say for a task with no plan, no agent and no relation", () => {
    const empty = model([], view([], []));
    expect(empty).toEqual({ cards: [], loose: [] });
    expect(plansSectionEmpty(empty)).toBe(true);
    expect(plansSectionEmpty(model([], undefined))).toBe(true);
  });

  it("falls back to a title where a task has no key, and to the label where a work has no task", () => {
    const shown = view(
      [bobsPlan],
      [
        relation("r-untracked", {
          b: { ...side(anaCodex), task: undefined, label: "Spike: refunds" },
          item: { path: "src/a.ts" },
        }),
        relation("r-title", {
          b: { ...side(anaCodex), task: "ord-12" },
          item: { path: "src/b.ts" },
        }),
      ],
    );
    const untitled = { ...task("ord-12", "", "Menu photos"), key: undefined };
    const lines = model(everyone, shown, "ord-9", [...TASKS, untitled]).cards[0]!.relations;
    expect(lines.map((line) => [line.item, line.who, line.open])).toEqual([
      ["src/a.ts", "Spike: refunds · Ana’s agent plans to change it", null],
      [
        "src/b.ts",
        "Menu photos · Ana’s agent plans to change it",
        { task: "ord-12", label: "Menu photos" },
      ],
    ]);
  });

  it("names a session whose harness is unknown by the person alone", () => {
    const unnamed = session("mcp:q1", "bob@acme.test", "ord-9", { agent: undefined });
    const { cards } = model([unnamed], view([], []));
    expect(cards[0]).toMatchObject({ agent: "Bob’s agent", mine: true });
  });
});

describe("the challenges that meet a task", () => {
  const provided = challenge("c-provided", {
    by: side(bobClaude),
    item: { path: "src/money.ts", name: "formatPrice" },
    reason: "formatPrice does not take cents",
    meets: [
      { side: side(anaCodex), role: "provides", contract: "formatPrice(cents: number): string" },
      { side: side(bobOther), role: "maybe" },
    ],
  });

  it("lists one on the task whose plan it meets, with who challenged it, why and what each work does", () => {
    const { challenges, openChallenges } = model(everyone, view([], [], [provided]), "ord-11");
    expect(openChallenges).toBe(1);
    expect(challenges).toEqual([
      {
        key: "c-provided",
        state: "open",
        stateLabel: "Open",
        item: "formatPrice (src/money.ts)",
        by: "Challenged by ORD-9 · Bob’s agent · 5 min ago",
        reason: "formatPrice does not take cents",
        closed: null,
        note: null,
        meets: [
          {
            key: "ana@acme.test:ana-laptop:codex:a1:provides",
            who: "ORD-11 · Ana’s agent provides it",
            contract: "formatPrice(cents: number): string",
          },
          {
            key: "bob@acme.test:mac:claude:b3:maybe",
            who: "ORD-15 · Bob’s agent may change it",
            contract: null,
          },
        ],
      },
    ]);
  });

  it("lists it on the challenger's task too, and on no task it does not meet", () => {
    const shown = view([], [], [provided]);
    expect(model(everyone, shown, "ord-9").challenges?.map((line) => line.key)).toEqual([
      "c-provided",
    ]);
    expect(model(everyone, shown, "ord-15").challenges?.map((line) => line.key)).toEqual([
      "c-provided",
    ]);
    expect(model(everyone, shown, "ord-12").challenges).toEqual([]);
    expect(
      planChallengesForTask(view([], [], [{ ...provided, project: "web" }]), {
        task: "ord-11",
        project: "pay",
      }),
    ).toEqual([]);
  });

  it("says who closed one and their note, lists it after the open ones and does not count it", () => {
    const closed = challenge("c-closed", {
      state: "closed",
      updatedAt: "2026-10-12T20:12:00Z",
      closed: {
        by: side(bobClaude),
        note: "checked: it takes cents",
        at: "2026-10-12T20:12:00Z",
      },
    });
    const open = challenge("c-open", { reason: "rounds half up, not to even" });
    const { challenges, openChallenges } = model(everyone, view([], [], [closed, open]));
    expect(openChallenges).toBe(1);
    expect(
      challenges?.map((line) => [line.key, line.stateLabel, line.closed, line.note, line.reason]),
    ).toEqual([
      ["c-open", "Open", null, null, "rounds half up, not to even"],
      [
        "c-closed",
        "Closed",
        "Closed by ORD-9 · Bob’s agent · 1 min ago",
        "checked: it takes cents",
        "applyTax takes cents, not euros",
      ],
    ]);
  });

  it("says when no live plan meets the item any more", () => {
    const alone = challenge("c-alone", { meets: [] });
    expect(model(everyone, view([], [], [alone]), "ord-11").challenges?.[0]?.meets).toEqual([]);
  });

  it("keeps the section to read when only a challenge meets the task", () => {
    const shown = model([], view([], [], [challenge("c-1")]));
    expect(shown.cards).toEqual([]);
    expect(plansSectionEmpty(shown)).toBe(false);
  });

  it("says nothing of challenges when the Hub serves none (plans revision 1)", () => {
    const older = model(everyone, view([bobsPlan], meetings));
    expect(older).not.toHaveProperty("challenges");
    expect(older).not.toHaveProperty("openChallenges");
    expect(planChallengesForTask(view([], []), { task: "ord-9" })).toBeUndefined();
    const none = model(everyone, view([bobsPlan], meetings, []));
    expect(none).toMatchObject({ challenges: [], openChallenges: 0 });
  });
});

describe("the count on a task's page", () => {
  const counted: PeerPlansStatus = {
    enabled: true,
    forcedOff: false,
    hubSupport: "supported",
    revision: 4,
    counts: [
      { ...PAY, task: "ord-9", plans: 1, relations: 3 },
      { ...PAY, task: "ord-11", plans: 1, relations: 1 },
    ],
  };
  const active = { plugins: status([]).plugins, plans: counted };

  it("words the relations that name the task, and nothing while none does", () => {
    expect(plansBadge(active, { ...PAY, task: "ord-9" })).toBe("Plans · 3 relations");
    expect(plansBadge(active, { ...PAY, task: "ord-11" })).toBe("Plans · 1 relation");
    expect(plansBadge(active, { ...PAY, task: "ord-15" })).toBeNull();
  });

  it("adds the task's open challenges to the same badge", () => {
    const challenged: PeerPlansStatus = {
      ...counted,
      counts: [
        { ...PAY, task: "ord-9", plans: 1, relations: 3, challenges: 1 },
        { ...PAY, task: "ord-11", plans: 1, relations: 0, challenges: 2 },
        { ...PAY, task: "ord-15", plans: 0, relations: 0, challenges: 0 },
      ],
    };
    const place = { plugins: active.plugins, plans: challenged };
    expect(plansBadge(place, { ...PAY, task: "ord-9" })).toBe(
      "Plans · 3 relations · 1 open challenge",
    );
    expect(plansBadge(place, { ...PAY, task: "ord-11" })).toBe("Plans · 2 open challenges");
    expect(plansBadge(place, { ...PAY, task: "ord-15" })).toBeNull();
  });

  it("is absent where Plans is off, older or has no project to count in", () => {
    const inactive = (reason: string): Pick<PeerHubStatus, "plans" | "plugins"> => ({
      plugins: [{ id: "plans", title: "Plans", enabled: false, active: false, reason }],
    });
    expect(plansBadge(inactive("off"), { ...PAY, task: "ord-9" })).toBeNull();
    expect(plansBadge({ plugins: active.plugins }, { ...PAY, task: "ord-9" })).toBeNull();
    expect(plansBadge(active, { workspace: "acme", project: undefined, task: "ord-9" })).toBeNull();
    expect(plansBadge({ plans: counted }, { ...PAY, task: "ord-9" })).toBeNull();
  });
});
