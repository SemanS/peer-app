import { describe, expect, it } from "vite-plus/test";

import {
  HARNESSES,
  PLAN_GROUPS,
  PLAN_IDS,
  actionNote,
  addPlanEdit,
  alternativeLabel,
  firstBlocked,
  hasPlan,
  harnessShort,
  isHarness,
  isPlanId,
  nextHarness,
  nothingBlockedText,
  personKey,
  planPhrase,
  readPlans,
  removePlanEdit,
  sharedActionLabel,
  sharedChip,
  sharedFigures,
  sharedLeft,
  sharedUse,
  whereYouCanUse,
  type PlanEdit,
  type SharedUsage,
  type UseProject,
  type UseRow,
} from "./aiSubscriptions.logic";
import { draftSets, edit, type DraftState } from "./settingsDraft.logic";

const ME = "ana@acme.dev";

/** Booking as the design draws it: client work that allows commercial plans only, with shared capacity. */
const booking: UseProject = {
  id: "booking",
  name: "Booking",
  client: "Northwind Hotels",
  capacity: {
    personal: "commercial",
    personalHarnesses: ["codex"],
    shared: { allocation: 150, budget: { amount: 600, period: "month" } },
  },
};
const peerHub: UseProject = {
  id: "peer-hub",
  name: "Peer Hub",
  capacity: { personal: "any", personalHarnesses: ["claude", "codex"] },
};
const campBot: UseProject = {
  id: "camp-bot",
  name: "Camp-bot",
  capacity: {
    personal: "none",
    personalHarnesses: [],
    shared: { allocation: 80, budget: { amount: 300, period: "month" } },
  },
};

const plans = [
  { harness: "claude", plan: "max" },
  { harness: "codex", plan: "team" },
];

/** The chips of a project's row as the design words them. */
const words = (row: UseRow | undefined) =>
  row?.chips.map((chip) => `${chip.label} · ${chip.state}`);

describe("the choices", () => {
  it("knows the agents and the plans the Hub takes", () => {
    expect(HARNESSES).toEqual(["claude", "codex", "cursor", "grok", "opencode", "antigravity"]);
    expect(PLAN_IDS).toEqual([
      "pro",
      "max",
      "plus",
      "team",
      "business",
      "enterprise",
      "api",
      "other",
    ]);
    expect(isHarness("codex")).toBe(true);
    expect(isHarness("copilot")).toBe(false);
    expect(isHarness(undefined)).toBe(false);
    expect(isPlanId("api")).toBe(true);
    expect(isPlanId("edu")).toBe(false);
  });

  it("groups the plans as the design does, and every plan is in a group once", () => {
    expect(PLAN_GROUPS.map((group) => [group.label, group.plans])).toEqual([
      ["Consumer", ["pro", "max", "plus"]],
      ["Commercial", ["team", "business", "enterprise", "api"]],
      ["Other", ["other"]],
    ]);
    expect(PLAN_GROUPS.flatMap((group) => group.plans)).toEqual([...PLAN_IDS]);
  });

  it("names an agent short in a chip and a plan as a phrase after your", () => {
    expect(harnessShort("claude")).toBe("Claude");
    expect(harnessShort("codex")).toBe("Codex");
    expect(harnessShort("opencode")).toBe("OpenCode");
    expect(harnessShort("future")).toBe("future");
    expect(planPhrase("max")).toBe("Max plan");
    expect(planPhrase("Team")).toBe("Team plan");
    expect(planPhrase("api")).toBe("API key");
    expect(planPhrase("other")).toBe("other plan");
  });
});

describe("the plans a person declared", () => {
  it("reads them in order with the terms each is under", () => {
    expect(
      readPlans({
        name: "Ana",
        personal: [
          { harness: "claude", plan: "max" },
          { harness: "codex", plan: "team" },
          { harness: "cursor", plan: "other" },
        ],
      }),
    ).toEqual([
      { index: 0, harness: "claude", plan: "max", kind: "consumer" },
      { index: 1, harness: "codex", plan: "team", kind: "commercial" },
      { index: 2, harness: "cursor", plan: "other", kind: "other" },
    ]);
  });

  it("reads no entry, no list and a list that is not one as no plans", () => {
    expect(readPlans(undefined)).toEqual([]);
    expect(readPlans({ name: "Ana" })).toEqual([]);
    expect(readPlans({ personal: "max" })).toEqual([]);
  });

  it("skips what is not a harness and a plan, and keeps the places of the rest", () => {
    expect(
      readPlans({
        personal: [{ harness: "claude" }, 7, { harness: "codex", plan: "team" }, null],
      }).map((row) => [row.index, row.harness]),
    ).toEqual([[2, "codex"]]);
  });

  it("finds the key a person has, whatever its case, else the address they sign in with", () => {
    expect(personKey({ people: { "Ana@Acme.dev": {} } }, ME)).toBe("Ana@Acme.dev");
    expect(personKey({ people: { "bob@acme.dev": {} } }, ME)).toBe(ME);
    expect(personKey({}, ME)).toBe(ME);
    expect(personKey(undefined, ME)).toBe(ME);
  });

  it("knows a plan is there already, whatever its case", () => {
    expect(hasPlan(plans, "codex", "Team")).toBe(true);
    expect(hasPlan(plans, "claude", "team")).toBe(false);
    expect(hasPlan([], "claude", "max")).toBe(false);
  });

  it("starts the add row on the first agent without a plan", () => {
    expect(nextHarness([])).toBe("claude");
    expect(nextHarness(plans)).toBe("cursor");
    expect(nextHarness([{ harness: "Claude" }, { harness: "cursor" }])).toBe("codex");
    expect(nextHarness(HARNESSES.map((harness) => ({ harness })))).toBe("claude");
  });
});

describe("editing the plans", () => {
  const entry = {
    name: "Ana",
    personal: [
      { harness: "claude", plan: "max", seat: "personal" },
      { harness: "codex", plan: "team" },
    ],
  };

  it("adds a plan after the others and leaves them exactly as they are", () => {
    expect(addPlanEdit(entry, "cursor", "pro")).toEqual({
      path: ["personal"],
      value: [...entry.personal, { harness: "cursor", plan: "pro" }],
    });
  });

  it("starts the list of a person who has none", () => {
    expect(addPlanEdit(undefined, "claude", "max")).toEqual({
      path: ["personal"],
      value: [{ harness: "claude", plan: "max" }],
    });
    expect(addPlanEdit({ name: "Ana" }, "claude", "max")).toEqual({
      path: ["personal"],
      value: [{ harness: "claude", plan: "max" }],
    });
  });

  it("does not add a plan twice, but takes the same agent on another plan", () => {
    expect(addPlanEdit(entry, "codex", "Team")).toBeNull();
    expect(addPlanEdit(entry, "codex", "pro")).not.toBeNull();
  });

  it("removes the plan at an index and keeps the others as they are", () => {
    expect(removePlanEdit(entry, 0)).toEqual({
      path: ["personal"],
      value: [{ harness: "codex", plan: "team" }],
    });
    expect(removePlanEdit(entry, 1)).toEqual({ path: ["personal"], value: [entry.personal[0]] });
  });

  it("removes nothing that is not there", () => {
    expect(removePlanEdit(entry, 2)).toBeNull();
    expect(removePlanEdit(entry, -1)).toBeNull();
    expect(removePlanEdit(entry, 0.5)).toBeNull();
    expect(removePlanEdit(undefined, 0)).toBeNull();
  });

  it("takes the list away with the last plan, and the whole entry when only plans were in it", () => {
    expect(removePlanEdit({ name: "Ana", personal: [plans[0]] }, 0)).toEqual({
      path: ["personal"],
      value: undefined,
    });
    expect(removePlanEdit({ personal: [plans[0]] }, 0)).toEqual({ path: [], value: undefined });
  });

  /** What a draft of the person's entry sends after the edits, as the page applies them. */
  const send = (document: Record<string, unknown>, edits: ReadonlyArray<PlanEdit | null>) => {
    const slice = ["people", ME];
    const live = { revision: 4, document };
    let state: DraftState | null = null;
    for (const planEdit of edits) {
      if (planEdit === null) continue;
      state = edit(state, "plans", live, slice, planEdit.path, planEdit.value);
    }
    return state === null ? [] : draftSets(state.base, state.document, slice);
  };

  it("sends the whole list for a person who has an entry", () => {
    const document = { people: { [ME]: entry } };
    expect(send(document, [addPlanEdit(entry, "cursor", "pro")])).toEqual([
      {
        path: ["people", ME, "personal"],
        value: [...entry.personal, { harness: "cursor", plan: "pro" }],
      },
    ]);
  });

  it("sends the whole entry for a person who has none", () => {
    expect(send({ people: {} }, [addPlanEdit(undefined, "claude", "max")])).toEqual([
      { path: ["people", ME], value: { personal: [{ harness: "claude", plan: "max" }] } },
    ]);
    expect(send({}, [addPlanEdit(undefined, "claude", "max")])).toEqual([
      { path: ["people", ME], value: { personal: [{ harness: "claude", plan: "max" }] } },
    ]);
  });

  it("sends the removal of an entry that held only plans", () => {
    const only = { personal: [plans[0]] };
    expect(send({ people: { [ME]: only } }, [removePlanEdit(only, 0)])).toEqual([
      { path: ["people", ME], value: null },
    ]);
  });

  it("sends nothing for a plan added and taken away again", () => {
    const added = addPlanEdit(undefined, "claude", "max");
    expect(send({ people: {} }, [added])).toHaveLength(1);
    const after = { personal: [{ harness: "claude", plan: "max" }] };
    expect(send({ people: {} }, [added, removePlanEdit(after, 0)])).toEqual([]);
    const withName = { name: "Ana", personal: [plans[0]] };
    const document = { people: { [ME]: withName } };
    const cleared = removePlanEdit(withName, 0);
    expect(send(document, [cleared])).toEqual([{ path: ["people", ME, "personal"], value: null }]);
  });
});

describe("where the plans may be used, as hubPolicy.ts decides", () => {
  // The rule per project, and which plan each lets a person's own login run: `any` every plan,
  // `commercial` Team, Business, Enterprise and API ones, `none` no personal plan at all.
  const allowed: ReadonlyArray<[string, string, boolean]> = [
    ["any", "pro", true],
    ["any", "max", true],
    ["any", "plus", true],
    ["any", "team", true],
    ["any", "business", true],
    ["any", "enterprise", true],
    ["any", "api", true],
    ["any", "other", true],
    ["commercial", "pro", false],
    ["commercial", "max", false],
    ["commercial", "plus", false],
    ["commercial", "team", true],
    ["commercial", "business", true],
    ["commercial", "enterprise", true],
    ["commercial", "api", true],
    ["commercial", "other", false],
  ];

  it.each(allowed)("in a project that allows %s, a %s plan is allowed: %s", (rule, plan, ok) => {
    for (const shared of [undefined, booking.capacity.shared]) {
      const [row] = whereYouCanUse(
        [{ ...booking, capacity: { ...booking.capacity, personal: rule, shared } }],
        [{ harness: "codex", plan }],
      );
      expect(row?.chips).toHaveLength(1);
      expect(row?.chips[0]).toMatchObject({ tone: ok ? "allowed" : "blocked", plan: { plan } });
      // Shared capacity is a chip of its own, and never changes what a personal plan may do.
      expect(row?.shared !== null).toBe(shared !== undefined);
    }
  });

  it.each(PLAN_IDS)(
    "in a project with shared capacity only, a %s plan is blocked as every plan is",
    (plan) => {
      for (const shared of [undefined, campBot.capacity.shared]) {
        const [row] = whereYouCanUse(
          [{ ...campBot, capacity: { ...campBot.capacity, shared } }],
          [{ harness: "codex", plan }],
        );
        expect(words(row)).toEqual(["Personal plans · blocked here"]);
        expect(row?.chips[0]).toMatchObject({
          tone: "blocked",
          reason: "Camp-bot runs on shared capacity only.",
        });
      }
    },
  );

  it("words the three projects of the design", () => {
    const rows = whereYouCanUse([booking, peerHub, campBot], plans);
    expect(rows.map((row) => [row.name, row.ruleText, words(row)])).toEqual([
      ["Booking", "Commercial plans only", ["Claude Max · blocked here", "Codex Team · allowed"]],
      ["Peer Hub", "Any plan", ["Claude Max · allowed", "Codex Team · allowed"]],
      ["Camp-bot", "Shared capacity only", ["Personal plans · blocked here"]],
    ]);
    expect(rows.map((row) => row.shared !== null)).toEqual([true, false, true]);
  });

  it("gives the reason a plan is blocked in the Hub's words", () => {
    const [row] = whereYouCanUse([booking], plans);
    expect(row?.chips[0]?.reason).toBe(
      "Booking is client work for Northwind Hotels and allows commercial plans only. Max is a consumer plan.",
    );
    expect(row?.chips[1]?.reason).toBeUndefined();
  });

  it("keeps the manifest's order, a numeric id too, and a plan twice in the list apart", () => {
    const rows = whereYouCanUse(
      [
        { ...peerHub, id: "20", name: "Twenty" },
        { ...peerHub, id: "3", name: "Three" },
      ],
      [
        { harness: "claude", plan: "max" },
        { harness: "claude", plan: "max" },
      ],
    );
    expect(rows.map((row) => row.name)).toEqual(["Twenty", "Three"]);
    expect(new Set(rows[0]?.chips.map((chip) => chip.key)).size).toBe(2);
  });

  it("reads a rule it does not know as any plan, as the Hub does", () => {
    const [row] = whereYouCanUse(
      [{ ...peerHub, capacity: { ...peerHub.capacity, personal: "someday" } }],
      plans,
    );
    expect(row).toMatchObject({ rule: "any", ruleText: "Any plan" });
  });

  it("says what would give a row a chip when the person has declared no plan", () => {
    const rows = whereYouCanUse([booking, peerHub, campBot], []);
    // Shared capacity is a chip, once the page adds it.
    expect(rows.map((row) => [row.chips.length, row.emptyText])).toEqual([
      [0, null],
      [0, "Add a plan to see where it works."],
      [1, null],
    ]);
    const [commercial] = whereYouCanUse(
      [{ ...booking, capacity: { ...booking.capacity, shared: undefined } }],
      [],
    );
    expect(commercial?.emptyText).toBe(
      "Add a Team, Business, Enterprise or API plan to use your own login here.",
    );
  });

  describe("without the plans, from what the manifest knows", () => {
    it("allows any plan where the project does, and no personal plan where it takes none", () => {
      const rows = whereYouCanUse([peerHub, campBot], null);
      expect(words(rows[0])).toEqual(["Your own plans · allowed"]);
      expect(words(rows[1])).toEqual(["Personal plans · blocked here"]);
      expect(rows[1]?.chips[0]?.reason).toBe("Camp-bot runs on shared capacity only.");
    });

    it("allows the agents the person has a commercial seat for where only commercial ones count", () => {
      const rows = whereYouCanUse(
        [
          {
            ...booking,
            capacity: { ...booking.capacity, personalHarnesses: ["codex", "claude"] },
          },
        ],
        null,
      );
      expect(words(rows[0])).toEqual(["Codex · allowed", "Claude · allowed"]);
    });

    it("blocks the person's own logins where only commercial ones count and they have no such seat", () => {
      const [row] = whereYouCanUse(
        [{ ...booking, capacity: { ...booking.capacity, personalHarnesses: [] } }],
        null,
      );
      expect(words(row)).toEqual(["Your own plans · blocked here"]);
      expect(row?.chips[0]?.reason).toBe(
        "Booking is client work for Northwind Hotels and allows commercial plans only.",
      );
      expect(firstBlocked(whereYouCanUse([booking], null))).toBeNull();
    });
  });
});

describe("the shared capacity", () => {
  const usage: SharedUsage = {
    budget: 600,
    period: "month",
    spent: 188.5,
    members: [
      { id: "ana@acme.dev", name: "Ana", allocation: 150, spent: 62 },
      { id: "bob@acme.dev", name: "Bob", allocation: null, spent: 40.5 },
    ],
  };
  const figures = sharedFigures(booking)!;

  it("has figures only where the project has shared capacity", () => {
    expect(figures).toEqual({ cap: 150, budget: 600, period: "month" });
    expect(sharedFigures(peerHub)).toBeNull();
    expect(
      sharedFigures({
        ...booking,
        capacity: { ...booking.capacity, shared: { budget: { amount: 90, period: "week" } } },
      }),
    ).toEqual({ cap: undefined, budget: 90, period: "week" });
  });

  it("says what is left of the person's own allocation, as the design does", () => {
    const use = sharedUse(figures, usage, ME);
    expect(use).toEqual({ cap: 150, budget: 600, period: "month", spent: 62, teamSpent: 188.5 });
    expect(sharedLeft(use)).toEqual({ left: 88, of: 150, own: true });
    expect(sharedChip(use, "EUR")).toMatchObject({
      label: "Shared",
      state: "€88 of €150 left",
      tone: "shared",
    });
    expect(sharedChip(use, "USD").state).toBe("$88 of $150 left");
  });

  it("goes by the gateway's word for the allocation, and finds the person whatever the case", () => {
    const changed: SharedUsage = {
      ...usage,
      members: [{ id: "Ana@Acme.dev", name: "Ana", allocation: 100, spent: 40.25 }],
    };
    const use = sharedUse(figures, changed, "ana@acme.dev");
    expect(sharedLeft(use)).toEqual({ left: 59.75, of: 100, own: true });
    expect(sharedChip(use, "EUR").state).toBe("€59.75 of €100 left");
  });

  it("never says less than nothing is left", () => {
    const over: SharedUsage = {
      ...usage,
      members: [{ id: ME, name: "Ana", allocation: 150, spent: 170 }],
    };
    expect(sharedLeft(sharedUse(figures, over, ME))?.left).toBe(0);
  });

  it("falls back to the project's budget where the person has no allocation of their own", () => {
    const noCap = sharedFigures({
      ...booking,
      capacity: { ...booking.capacity, shared: { budget: { amount: 600, period: "month" } } },
    })!;
    const use = sharedUse(noCap, usage, "bob@acme.dev");
    expect(use).toMatchObject({ cap: undefined, spent: 40.5, teamSpent: 188.5 });
    expect(sharedLeft(use)).toEqual({ left: 411.5, of: 600, own: false });
    expect(sharedChip(use, "EUR").state).toBe("€411.50 of €600 left in the project budget");
  });

  it("says what the person is given until the gateway answers", () => {
    const own = sharedUse(figures, null, ME);
    expect(own).toEqual({ ...figures, spent: undefined, teamSpent: undefined });
    expect(sharedLeft(own)).toBeUndefined();
    expect(sharedChip(own, "EUR").state).toBe("€150 allocated");
    const noCap = sharedUse({ cap: undefined, budget: 600, period: "month" }, null, ME);
    expect(sharedChip(noCap, "EUR").state).toBe("€600 per month");
    // A person the gateway does not list has no figure of their own to subtract from.
    const unlisted = sharedUse(figures, usage, "eva@acme.dev");
    expect(sharedLeft(unlisted)).toBeUndefined();
    expect(sharedChip(unlisted, "EUR").state).toBe("€150 allocated");
  });

  it("does not know who is signed in without an address", () => {
    expect(sharedUse(figures, usage, null).spent).toBeUndefined();
  });
});

describe("when an agent cannot start on a plan", () => {
  it("explains the first blocked plan, as the design does", () => {
    const rows = whereYouCanUse([booking, peerHub, campBot], plans);
    expect(firstBlocked(rows)).toEqual({
      project: "booking",
      projectName: "Booking",
      title: "Claude Code can’t use your Max plan in Booking",
      reason:
        "Booking is client work for Northwind Hotels and allows commercial plans only. Max is a consumer plan.",
      alternative: { harness: "codex", plan: "team" },
      shared: { cap: 150, budget: 600, period: "month" },
    });
  });

  it("explains a project that takes no personal plan of them all, with no other plan to offer", () => {
    expect(firstBlocked(whereYouCanUse([peerHub, campBot], plans))).toEqual({
      project: "camp-bot",
      projectName: "Camp-bot",
      title: "Your own plans can’t be used in Camp-bot",
      reason: "Camp-bot runs on shared capacity only.",
      alternative: null,
      shared: { cap: 80, budget: 300, period: "month" },
    });
  });

  it("goes by the order of the projects, and skips one where nothing is blocked", () => {
    expect(firstBlocked(whereYouCanUse([peerHub, campBot, booking], plans))?.project).toBe(
      "camp-bot",
    );
    expect(firstBlocked(whereYouCanUse([peerHub], plans))).toBeNull();
    expect(firstBlocked([])).toBeNull();
  });

  it("offers no other plan where none is allowed, and says a project has no shared capacity", () => {
    const [row] = whereYouCanUse(
      [{ ...booking, capacity: { ...booking.capacity, shared: undefined } }],
      [{ harness: "cursor", plan: "pro" }],
    );
    expect(firstBlocked([row!])).toMatchObject({
      title: "Cursor can’t use your Pro plan in Booking",
      alternative: null,
      shared: null,
    });
  });

  it("offers another plan of the same agent too, and names a key and another plan plainly", () => {
    const rows = whereYouCanUse(
      [booking],
      [
        { harness: "cursor", plan: "other" },
        { harness: "cursor", plan: "api" },
      ],
    );
    expect(firstBlocked(rows)).toMatchObject({
      title: "Cursor can’t use your other plan in Booking",
      alternative: { harness: "cursor", plan: "api" },
    });
    expect(alternativeLabel({ harness: "cursor", plan: "api" })).toBe("Use Cursor on your API key");
  });

  it("words the two actions of the design", () => {
    expect(alternativeLabel({ harness: "codex", plan: "team" })).toBe(
      "Use Codex on your Team plan",
    );
    const use = sharedUse(sharedFigures(booking)!, null, ME);
    expect(sharedActionLabel("Booking", use, "EUR")).toBe("Use Booking’s shared budget");
    const known = sharedUse(
      sharedFigures(booking)!,
      {
        budget: 600,
        period: "month",
        spent: 62,
        members: [{ id: ME, name: "Ana", allocation: 150, spent: 62 }],
      },
      ME,
    );
    expect(sharedActionLabel("Booking", known, "EUR")).toBe(
      "Use Booking’s shared budget · €88 left",
    );
  });

  it("says where each action leads, since an agent is not started from here", () => {
    expect(actionNote({ kind: "alternative", project: "Booking", harness: "codex" })).toBe(
      "Opens a new thread in Booking. Pick Codex in its model picker.",
    );
    expect(actionNote({ kind: "shared", project: "Booking", sharedOnHere: true })).toBe(
      "Opens a new thread in Booking. Pick its shared capacity in the model picker.",
    );
    expect(actionNote({ kind: "shared", project: "Booking", sharedOnHere: false })).toBe(
      "Opens Booking’s Capacity page, where you turn its shared capacity on for this computer.",
    );
  });

  it("says why there is nothing to explain", () => {
    expect(nothingBlockedText({ projects: 0, plans: 2 })).toBe("You’re not on a project here yet.");
    expect(nothingBlockedText({ projects: 3, plans: null })).toBe(
      "Nothing is blocked in your projects.",
    );
    expect(nothingBlockedText({ projects: 3, plans: 0 })).toBe(
      "Add a plan above to see where an agent can start on it.",
    );
    expect(nothingBlockedText({ projects: 3, plans: 2 })).toBe(
      "Nothing is blocked: your plans work in every project you’re on.",
    );
  });
});
