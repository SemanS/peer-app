import { describe, expect, it } from "vite-plus/test";

import { draftSets, edit, type DraftState } from "./settingsDraft.logic";
import {
  allocationEdit,
  allocationTable,
  budgetEdits,
  budgetFormFor,
  capacityFromManifest,
  checkBudgetForm,
  consumerOnlyNames,
  defaultAllocationEdit,
  hasGateway,
  joinNames,
  makeCustomEdit,
  modelsOf,
  overBudgetText,
  parseAmount,
  personalEdit,
  personalNote,
  planOptions,
  poolLabel,
  projectMembers,
  readCapacity,
  readPools,
  removeSharedEdit,
  summarize,
  usageBar,
  usageRows,
  usedLine,
  type Edit,
  type PoolOption,
  type SharedSettings,
} from "./projectCapacity.logic";

const people = [
  { email: "slavo@acme.dev", name: "Slavo" },
  { email: "eva@acme.dev", name: "Eva" },
  { email: "bob@acme.dev", name: "Bob" },
  { email: "ana@acme.dev", name: "Ana" },
  { email: "vir@acme.dev", name: "Vir" },
];

/** Booking as the design draws it: €630 of allocations against a €600 budget. */
const shared: SharedSettings = {
  pool: "standard",
  amount: 600,
  period: "month",
  models: undefined,
  allocations: { "slavo@acme.dev": 150, "eva@acme.dev": 150, "bob@acme.dev": 170 },
  defaultAllocation: 80,
};

const pools: ReadonlyArray<PoolOption> = [
  { id: "standard", name: "Standard", models: ["claude-sonnet-5-5", "claude-haiku-5-5"] },
  { id: "advanced", name: "Advanced", models: ["a", "b", "c"] },
];

describe("amounts", () => {
  it.each<[string, number | null]>([
    ["600", 600],
    [" 150 ", 150],
    ["12.5", 12.5],
    ["12,50", 12.5],
    ["0", 0],
    ["150.", 150],
    ["", null],
    ["-5", null],
    ["1e3", null],
    ["12.345", null],
    ["abc", null],
    ["€80", null],
  ])("reads %j as %j", (text, expected) => {
    const read = parseAmount(text);
    expect(read.ok ? read.value : null).toBe(expected);
  });

  it("says what was used in the period the gateway is in", () => {
    expect(usedLine(315, "month", "EUR")).toBe("€315 used this month");
    expect(usedLine(12.5, "week", "USD")).toBe("$12.50 used this week");
    expect(usedLine(0, "day", "EUR")).toBe("€0 used today");
  });
});

describe("reading the document", () => {
  it("reads a project's capacity: the rule, and the budget with who may spend what", () => {
    expect(
      readCapacity({
        personal: "commercial",
        shared: {
          pool: "standard",
          budget: { amount: 600, period: "week" },
          allocations: { "eva@acme.dev": 150, "bad@acme.dev": "lots" },
          defaultAllocation: 80,
          models: ["claude-sonnet-5-5"],
          use: ["on-demand"],
        },
      }),
    ).toEqual({
      personal: "commercial",
      shared: {
        pool: "standard",
        amount: 600,
        period: "week",
        models: ["claude-sonnet-5-5"],
        allocations: { "eva@acme.dev": 150 },
        defaultAllocation: 80,
      },
    });
  });

  it("reads what the Hub leaves out as its defaults", () => {
    expect(readCapacity(undefined)).toEqual({ personal: "any", shared: undefined });
    expect(readCapacity({ personal: "whatever" }).personal).toBe("any");
    expect(readCapacity({ shared: { pool: "p", budget: { amount: 0 } } }).shared).toEqual({
      pool: "p",
      amount: 0,
      period: "month",
      models: undefined,
      allocations: {},
      defaultAllocation: undefined,
    });
    // A budget without a pool or an amount is not one.
    expect(readCapacity({ shared: { budget: { amount: 5 } } }).shared).toBeUndefined();
    expect(readCapacity({ shared: { pool: "p", budget: {} } }).shared).toBeUndefined();
  });

  it("reads the manifest's capacity when there are no settings to read", () => {
    expect(
      capacityFromManifest({
        personal: "none",
        personalHarnesses: [],
        shared: {
          pool: "standard",
          gatewayUrl: "https://llm.acme.dev",
          models: [{ id: "claude-sonnet-5-5", harness: ["claude"] }],
          budget: { amount: 600, period: "month", currency: "EUR" },
          allocation: 150,
          use: ["on-demand"],
        },
      }),
    ).toEqual({
      personal: "none",
      shared: {
        pool: "standard",
        amount: 600,
        period: "month",
        models: ["claude-sonnet-5-5"],
        allocations: {},
        defaultAllocation: undefined,
      },
    });
  });

  it("lists the catalog's pools with their models, and names a pool for its models", () => {
    const document = {
      capacity: {
        standard: {
          name: "Standard",
          models: [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }, { nope: true }],
        },
        unnamed: { models: [] },
        broken: "text",
      },
    };
    expect(readPools(document)).toEqual([
      { id: "standard", name: "Standard", models: ["claude-sonnet-5-5", "claude-haiku-5-5"] },
      { id: "unnamed", name: "unnamed", models: [] },
    ]);
    expect(readPools({})).toEqual([]);
    expect(poolLabel(pools[0]!)).toBe("Standard · 2 models");
    expect(poolLabel({ id: "x", name: "Solo", models: ["m"] })).toBe("Solo · 1 model");
    expect(modelsOf({ pool: "standard", models: undefined }, pools)).toEqual([
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    expect(modelsOf({ pool: "standard", models: ["only-this"] }, pools)).toEqual(["only-this"]);
    expect(modelsOf({ pool: "gone", models: undefined }, pools)).toEqual([]);
  });

  it("knows whether the workspace has a gateway", () => {
    expect(hasGateway({ gateway: { url: "https://llm.acme.dev" } })).toBe(true);
    expect(hasGateway({ gateway: {} })).toBe(true);
    expect(hasGateway({})).toBe(false);
    expect(hasGateway({ gateway: null })).toBe(false);
  });

  it("lists a project's members: named people, or everyone for the whole workspace", () => {
    expect(projectMembers({ members: ["*"] }, people).map((member) => member.name)).toEqual([
      "Slavo",
      "Eva",
      "Bob",
      "Ana",
      "Vir",
    ]);
    expect(
      projectMembers({ members: ["eva@acme.dev", "EVA@acme.dev", "zed@acme.dev"] }, people),
    ).toEqual([
      { email: "eva@acme.dev", name: "Eva" },
      { email: "zed@acme.dev", name: "zed" },
    ]);
    // The Hub's default for a project that names none is everyone.
    expect(projectMembers({}, people)).toHaveLength(5);
  });
});

describe("the budget editor", () => {
  it("starts from the budget, or for a project without one from a month and the first pool", () => {
    expect(budgetFormFor(shared, pools)).toEqual({
      amount: "600",
      period: "month",
      pool: "standard",
    });
    expect(budgetFormFor(undefined, pools)).toEqual({
      amount: "",
      period: "month",
      pool: "standard",
    });
    expect(budgetFormFor(undefined, [])).toEqual({ amount: "", period: "month", pool: "" });
  });

  it("can be done with an amount of zero or more and a pool of the catalog", () => {
    expect(checkBudgetForm({ amount: "700", period: "week", pool: "advanced" }, pools)).toEqual({
      ok: true,
      amount: 700,
      period: "week",
      pool: "advanced",
    });
    expect(checkBudgetForm({ amount: "0", period: "day", pool: "standard" }, pools).ok).toBe(true);
  });

  it("says nothing while the amount is empty, and what is wrong once it is", () => {
    expect(checkBudgetForm({ amount: "", period: "month", pool: "standard" }, pools)).toEqual({
      ok: false,
      problem: null,
    });
    expect(checkBudgetForm({ amount: "lots", period: "month", pool: "standard" }, pools)).toEqual({
      ok: false,
      problem: "The amount is a number, zero or more, like 600 or 12.50.",
    });
    expect(checkBudgetForm({ amount: "600", period: "month", pool: "gone" }, pools)).toEqual({
      ok: false,
      problem: "Pick a model pool.",
    });
    expect(checkBudgetForm({ amount: "600", period: "month", pool: "" }, [])).toEqual({
      ok: false,
      problem: "Pick a model pool.",
    });
  });

  const valid = (amount: number, period: "day" | "week" | "month", pool: string) => ({
    ok: true as const,
    amount,
    period,
    pool,
  });

  it("creates the budget whole for a project that had none", () => {
    expect(budgetEdits(undefined, valid(600, "month", "standard"))).toEqual([
      {
        path: ["shared"],
        value: { pool: "standard", budget: { amount: 600, period: "month" } },
      },
    ]);
  });

  it("writes only what differs, so a review lists each change", () => {
    expect(budgetEdits(shared, valid(600, "month", "standard"))).toEqual([]);
    expect(budgetEdits(shared, valid(700, "month", "standard"))).toEqual([
      { path: ["shared", "budget", "amount"], value: 700 },
    ]);
    expect(budgetEdits(shared, valid(700, "week", "standard"))).toEqual([
      { path: ["shared", "budget", "amount"], value: 700 },
      { path: ["shared", "budget", "period"], value: "week" },
    ]);
  });

  it("drops a subset of models when the pool changes, since the new pool does not have them", () => {
    expect(budgetEdits(shared, valid(600, "month", "advanced"))).toEqual([
      { path: ["shared", "pool"], value: "advanced" },
    ]);
    expect(
      budgetEdits({ ...shared, models: ["claude-haiku-5-5"] }, valid(600, "month", "advanced")),
    ).toEqual([
      { path: ["shared", "pool"], value: "advanced" },
      { path: ["shared", "models"], value: undefined },
    ]);
  });
});

describe("allocations", () => {
  const savedCustom = new Set(["slavo@acme.dev", "eva@acme.dev", "bob@acme.dev"]);

  it("draws the design's table: custom allocations first, then the project default", () => {
    const table = allocationTable({ shared, members: people, savedCustom, spent: undefined });
    expect(table.rows.map((row) => [row.name, row.source, row.value])).toEqual([
      ["Slavo", "custom", 150],
      ["Eva", "custom", 150],
      ["Bob", "custom", 170],
      ["Ana", "project default", 80],
      ["Vir", "project default", 80],
    ]);
    expect(table.everyone).toEqual({ value: 80, appliesTo: "Ana and Vir" });
  });

  it("keeps the order of what is saved while a row is being edited", () => {
    // Ana is given an allocation of her own in the draft, but was not custom when saved.
    const edited: SharedSettings = {
      ...shared,
      allocations: { ...shared.allocations, "ana@acme.dev": 90 },
    };
    const table = allocationTable({
      shared: edited,
      members: people,
      savedCustom,
      spent: undefined,
    });
    expect(table.rows.map((row) => row.name)).toEqual(["Slavo", "Eva", "Bob", "Ana", "Vir"]);
    expect(table.rows[3]).toMatchObject({ name: "Ana", source: "custom", value: 90 });
    expect(table.everyone.appliesTo).toBe("Vir");
    // Saved, the person with a custom allocation moves up with the others.
    const saved = allocationTable({
      shared: edited,
      members: people,
      savedCustom: new Set([...savedCustom, "ana@acme.dev"]),
      spent: undefined,
    });
    expect(saved.rows.map((row) => row.name)).toEqual(["Slavo", "Eva", "Bob", "Ana", "Vir"]);
    const reversed = allocationTable({
      shared,
      members: people.toReversed(),
      savedCustom,
      spent: undefined,
    });
    expect(reversed.rows.map((row) => row.name)).toEqual(["Bob", "Eva", "Slavo", "Vir", "Ana"]);
  });

  it("shows what each person used against their cap, amber from 85%", () => {
    const spent = new Map([
      ["slavo@acme.dev", 62],
      ["eva@acme.dev", 131],
      ["bob@acme.dev", 40],
      ["ana@acme.dev", 12],
      ["vir@acme.dev", 70],
    ]);
    const table = allocationTable({ shared, members: people, savedCustom, spent });
    expect(table.rows.map((row) => [row.name, row.used, row.bar])).toEqual([
      ["Slavo", 62, { percent: 41, warn: false }],
      ["Eva", 131, { percent: 87, warn: true }],
      ["Bob", 40, { percent: 24, warn: false }],
      ["Ana", 12, { percent: 15, warn: false }],
      ["Vir", 70, { percent: 88, warn: true }],
    ]);
  });

  it("has no usage while it is not known, and none for a member the gateway lists no use for", () => {
    const unknown = allocationTable({ shared, members: people, savedCustom, spent: undefined });
    expect(unknown.rows.every((row) => row.used === undefined && row.bar === undefined)).toBe(true);
    const none = allocationTable({ shared, members: people, savedCustom, spent: new Map() });
    expect(none.rows.every((row) => row.used === 0)).toBe(true);
  });

  it("draws the bar against the cap as edited, so lowering one turns it amber", () => {
    expect(usageBar(131, 150)).toEqual({ percent: 87, warn: true });
    expect(usageBar(131, 200)).toEqual({ percent: 66, warn: false });
    expect(usageBar(127.5, 150)).toEqual({ percent: 85, warn: true });
    expect(usageBar(127.4, 150)).toEqual({ percent: 85, warn: false });
    expect(usageBar(500, 150)).toEqual({ percent: 100, warn: true });
  });

  it("draws no bar for no cap, and a full amber one for a zero cap that was spent against", () => {
    expect(usageBar(40, undefined)).toEqual({ percent: 0, warn: false });
    expect(usageBar(0, 0)).toEqual({ percent: 0, warn: false });
    expect(usageBar(5, 0)).toEqual({ percent: 100, warn: true });
  });

  it("says the default applies to people added later when everyone has an allocation of their own", () => {
    const everyone: SharedSettings = {
      ...shared,
      allocations: Object.fromEntries(people.map((person) => [person.email, 100])),
    };
    const table = allocationTable({
      shared: everyone,
      members: people,
      savedCustom: new Set(people.map((person) => person.email)),
      spent: undefined,
    });
    expect(table.everyone.appliesTo).toBe("people added later");
  });

  it("names who the default applies to, in few words", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Vir"])).toBe("Ana and Vir");
    expect(joinNames(["Ana", "Vir", "Bob"])).toBe("Ana, Vir and Bob");
    expect(joinNames(["A", "B", "C", "D"])).toBe("A, B, C and D");
    expect(joinNames(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C and 3 more");
  });

  it("totals what the allocations commit the way the Hub does: own allocations and the default for the rest", () => {
    // 150 + 150 + 170 + 2 × 80 = 630 against 600.
    expect(summarize(shared, people)).toEqual({
      allocated: 630,
      budget: 600,
      over: 30,
      percent: 100,
    });
  });

  it("fits when the total does not pass the budget", () => {
    expect(
      summarize(
        { ...shared, allocations: { "slavo@acme.dev": 100 }, defaultAllocation: 50 },
        people,
      ),
    ).toEqual({ allocated: 300, budget: 600, over: 0, percent: 50 });
    expect(summarize({ ...shared, defaultAllocation: 75 }, people)).toMatchObject({
      allocated: 620,
      over: 20,
    });
    expect(summarize({ ...shared, defaultAllocation: 65 }, people)).toMatchObject({
      allocated: 600,
      over: 0,
      percent: 100,
    });
  });

  it("counts no default for people when there is none, and handles a budget of zero", () => {
    expect(summarize({ ...shared, defaultAllocation: undefined }, people).allocated).toBe(470);
    expect(summarize({ ...shared, amount: 0 }, people)).toMatchObject({ over: 630, percent: 100 });
    expect(
      summarize({ ...shared, amount: 0, allocations: {}, defaultAllocation: undefined }, people),
    ).toMatchObject({ allocated: 0, over: 0, percent: 0 });
  });

  it("counts cents, not floating point dust", () => {
    expect(
      summarize(
        { ...shared, allocations: {}, defaultAllocation: 0.1, amount: 0.3 },
        people.slice(0, 3),
      ),
    ).toMatchObject({ allocated: 0.3, over: 0 });
  });

  it("words the warning as the design does, with the budget's period", () => {
    expect(
      overBudgetText({
        over: 30,
        budget: 600,
        period: "month",
        currency: "EUR",
        project: "Booking",
      }),
    ).toBe(
      "€30 over the budget. You can save it, but the gateway stops Booking at €600 a month, so someone runs out first.",
    );
    expect(
      overBudgetText({
        over: 12.5,
        budget: 100,
        period: "week",
        currency: "USD",
        project: "Camp-bot",
      }),
    ).toContain("$12.50 over the budget.");
    expect(
      overBudgetText({ over: 1, budget: 100, period: "day", currency: "USD", project: "Camp-bot" }),
    ).toContain("at $100 a day,");
  });

  it("writes an allocation under the member's address, and nothing to take it away", () => {
    expect(allocationEdit("eva@acme.dev", 175)).toEqual({
      path: ["shared", "allocations", "eva@acme.dev"],
      value: 175,
    });
    expect(allocationEdit("eva@acme.dev", undefined).value).toBeUndefined();
  });

  it("gives a person an allocation of their own starting from the project default", () => {
    expect(makeCustomEdit(shared, "ana@acme.dev")).toEqual({
      path: ["shared", "allocations", "ana@acme.dev"],
      value: 80,
    });
    expect(makeCustomEdit({ ...shared, defaultAllocation: undefined }, "ana@acme.dev").value).toBe(
      0,
    );
  });

  it("edits, and clears, the default everyone else gets", () => {
    expect(defaultAllocationEdit(90)).toEqual({ path: ["shared", "defaultAllocation"], value: 90 });
    expect(defaultAllocationEdit(undefined).value).toBeUndefined();
  });

  it("draws rows from the gateway's figures when settings are not there to read", () => {
    expect(
      usageRows([
        { id: "ana@acme.dev", name: "Ana", allocation: 80, spent: 12 },
        { id: "vir@acme.dev", name: "Vir", allocation: null, spent: 70 },
      ]),
    ).toEqual([
      {
        email: "ana@acme.dev",
        name: "Ana",
        source: null,
        value: 80,
        used: 12,
        bar: { percent: 15, warn: false },
      },
      {
        email: "vir@acme.dev",
        name: "Vir",
        source: null,
        value: undefined,
        used: 70,
        bar: { percent: 0, warn: false },
      },
    ]);
  });
});

describe("personal AI plans", () => {
  it("offers the three rules in the design's words", () => {
    expect(planOptions({ project: "Booking", hasShared: true })).toEqual([
      {
        value: "any",
        title: "Any plan",
        description: "People may use their own plans here, consumer ones too.",
        reason: null,
      },
      {
        value: "commercial",
        title: "Commercial plans only · recommended for client work",
        description:
          "Team, Enterprise or API plans. Consumer plans like Pro or Max are blocked for Booking.",
        reason: null,
      },
      {
        value: "none",
        title: "Shared capacity only",
        description: "Agents in Booking use only the budget above. Personal logins are blocked.",
        reason: null,
      },
    ]);
  });

  it("does not offer shared capacity only to a project without a shared budget, and says why", () => {
    const options = planOptions({ project: "Booking", hasShared: false });
    expect(options.map((option) => [option.value, option.reason])).toEqual([
      ["any", null],
      ["commercial", null],
      ["none", "Needs a shared budget for Booking first."],
    ]);
  });

  it("finds who declared only consumer plans, when the document shows plans", () => {
    const document = {
      people: {
        "ana@acme.dev": { name: "Ana", personal: [{ harness: "claude", plan: "pro" }] },
        "vir@acme.dev": {
          personal: [
            { harness: "claude", plan: "max" },
            { harness: "codex", plan: "plus" },
          ],
        },
        "eva@acme.dev": {
          personal: [
            { harness: "claude", plan: "max" },
            { harness: "codex", plan: "team" },
          ],
        },
        "bob@acme.dev": { name: "Bob" },
      },
    };
    expect(consumerOnlyNames(document, people)).toEqual(["Ana", "Vir"]);
    // Without the entries (a lead who is not an admin does not see them) there is nobody to name.
    expect(consumerOnlyNames({}, people)).toEqual([]);
  });

  it.each<[string, Parameters<typeof personalNote>[0], string | null]>([
    [
      "any, on client work",
      { rule: "any", hasShared: true, hasClient: true, consumerOnly: ["Ana"], project: "Booking" },
      "Peer still warns when client work runs on a consumer plan.",
    ],
    [
      "any, on a project without a client",
      { rule: "any", hasShared: true, hasClient: false, consumerOnly: [], project: "Booking" },
      null,
    ],
    [
      "commercial with shared capacity, for two people",
      {
        rule: "commercial",
        hasShared: true,
        hasClient: true,
        consumerOnly: ["Ana", "Vir"],
        project: "Booking",
      },
      "Ana and Vir have only consumer plans, so their agents here use the shared budget. A teammate’s request can’t start an agent here unless the rule is Any plan.",
    ],
    [
      "commercial with shared capacity, for one person",
      {
        rule: "commercial",
        hasShared: true,
        hasClient: true,
        consumerOnly: ["Ana"],
        project: "Booking",
      },
      "Ana has only consumer plans, so their agents here use the shared budget. A teammate’s request can’t start an agent here unless the rule is Any plan.",
    ],
    [
      "commercial without shared capacity",
      {
        rule: "commercial",
        hasShared: false,
        hasClient: true,
        consumerOnly: ["Ana", "Vir"],
        project: "Booking",
      },
      "Ana and Vir have only consumer plans, so their agents can’t start in Booking until it has a shared budget.",
    ],
    [
      "commercial when nobody is known to have only consumer plans",
      {
        rule: "commercial",
        hasShared: true,
        hasClient: true,
        consumerOnly: [],
        project: "Booking",
      },
      null,
    ],
    [
      "shared capacity only",
      { rule: "none", hasShared: true, hasClient: true, consumerOnly: ["Ana"], project: "Booking" },
      null,
    ],
  ])("notes, for %s", (_name, input, expected) => {
    expect(personalNote(input)).toBe(expected);
  });
});

describe("what a draft saves, for the edits the page makes", () => {
  const capacity = {
    personal: "commercial",
    shared: {
      pool: "standard",
      budget: { amount: 600, period: "month" },
      allocations: { "slavo@acme.dev": 150, "eva@acme.dev": 150, "bob@acme.dev": 170 },
      defaultAllocation: 80,
      use: ["on-demand", "overflow", "automation"],
    },
  };
  const slice = ["projects", "booking", "capacity"];
  const at = (...below: string[]) => [...slice, ...below];

  /** Applies the edits to a draft of the document, as the page does one after the other. */
  const saves = (edits: ReadonlyArray<Edit>, project: unknown = { name: "Booking", capacity }) => {
    const document = { projects: { booking: project } };
    const state = edits.reduce<DraftState | null>(
      (draft, change) =>
        edit(draft, "booking", { revision: 7, document }, slice, change.path, change.value),
      null,
    );
    // The order of the sets follows the document's, which says nothing: they are compared by path.
    return state === null
      ? []
      : draftSets(state.base, state.document, slice).sort((a, b) =>
          a.path.join("/").localeCompare(b.path.join("/")),
        );
  };

  it("sends one person's allocation as that person's, so what others changed meanwhile merges", () => {
    expect(saves([allocationEdit("eva@acme.dev", 175)])).toEqual([
      { path: at("shared", "allocations", "eva@acme.dev"), value: 175 },
    ]);
  });

  it("sends nothing for an allocation typed back to what it was", () => {
    expect(
      saves([
        allocationEdit("eva@acme.dev", 17),
        allocationEdit("eva@acme.dev", 175),
        allocationEdit("eva@acme.dev", 150),
      ]),
    ).toEqual([]);
  });

  it("gives someone an allocation of their own, and takes it away again", () => {
    expect(saves([makeCustomEdit(shared, "ana@acme.dev")])).toEqual([
      { path: at("shared", "allocations", "ana@acme.dev"), value: 80 },
    ]);
    expect(saves([allocationEdit("bob@acme.dev", undefined)])).toEqual([
      { path: at("shared", "allocations", "bob@acme.dev"), value: null },
    ]);
    expect(
      saves([makeCustomEdit(shared, "ana@acme.dev"), allocationEdit("ana@acme.dev", undefined)]),
    ).toEqual([]);
  });

  it("changes, and takes away, the default for everyone else", () => {
    expect(saves([defaultAllocationEdit(90)])).toEqual([
      { path: at("shared", "defaultAllocation"), value: 90 },
    ]);
    expect(saves([defaultAllocationEdit(undefined)])).toEqual([
      { path: at("shared", "defaultAllocation"), value: null },
    ]);
  });

  it("sends a budget's amount, period and pool each as the change it is", () => {
    expect(
      saves(budgetEdits(shared, { ok: true, amount: 700, period: "week", pool: "advanced" })),
    ).toEqual([
      { path: at("shared", "budget", "amount"), value: 700 },
      { path: at("shared", "budget", "period"), value: "week" },
      { path: at("shared", "pool"), value: "advanced" },
    ]);
  });

  it("drops the subset of models with the pool", () => {
    const subset = { ...capacity, shared: { ...capacity.shared, models: ["claude-haiku-5-5"] } };
    expect(
      saves(
        budgetEdits(
          { ...shared, models: ["claude-haiku-5-5"] },
          { ok: true, amount: 600, period: "month", pool: "advanced" },
        ),
        { name: "Booking", capacity: subset },
      ),
    ).toEqual([
      { path: at("shared", "models"), value: null },
      { path: at("shared", "pool"), value: "advanced" },
    ]);
  });

  it("gives a project without shared capacity one whole, allocations typed afterwards included", () => {
    const bare = { name: "Booking", capacity: { personal: "any" } };
    const created = budgetEdits(undefined, {
      ok: true,
      amount: 600,
      period: "month",
      pool: "standard",
    });
    expect(saves(created, bare)).toEqual([
      {
        path: at("shared"),
        value: { pool: "standard", budget: { amount: 600, period: "month" } },
      },
    ]);
    const next: SharedSettings = { ...shared, allocations: {}, defaultAllocation: undefined };
    expect(
      saves([...created, defaultAllocationEdit(50), makeCustomEdit(next, "eva@acme.dev")], bare),
    ).toEqual([
      {
        path: at("shared"),
        value: {
          pool: "standard",
          budget: { amount: 600, period: "month" },
          defaultAllocation: 50,
          allocations: { "eva@acme.dev": 0 },
        },
      },
    ]);
  });

  it("takes shared capacity away whole", () => {
    expect(saves([removeSharedEdit])).toEqual([{ path: at("shared"), value: null }]);
  });

  it("sends the rule for personal plans", () => {
    expect(saves([personalEdit("none")])).toEqual([{ path: at("personal"), value: "none" }]);
    expect(saves([personalEdit("none"), personalEdit("commercial")])).toEqual([]);
  });
});
