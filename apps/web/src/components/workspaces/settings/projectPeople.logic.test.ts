import { describe, expect, it } from "vite-plus/test";

import {
  addCandidates,
  addPeople,
  customAllocation,
  formatMoney,
  leadNamesOf,
  leadsOf,
  membersForMode,
  membersOf,
  modeOf,
  modeText,
  moreText,
  peopleModel,
  peopleNotes,
  readOnlyPeopleNote,
  removalWords,
  removePerson,
  toggleLead,
  type WorkspacePerson,
} from "./projectPeople.logic";

const roster: ReadonlyArray<WorkspacePerson> = [
  { email: "slavo@acme.dev", name: "Slavo" },
  { email: "eva@acme.dev", name: "Eva" },
  { email: "ana@acme.dev", name: "Ana" },
  { email: "vir@acme.dev", name: "Vir" },
  { email: "bob@acme.dev", name: "Bob" },
  { email: "mia@acme.dev", name: "Mia" },
];

const booking = (overrides: Record<string, unknown> = {}) => ({
  name: "Booking",
  members: ["slavo@acme.dev", "eva@acme.dev", "ana@acme.dev", "vir@acme.dev", "bob@acme.dev"],
  leads: ["slavo@acme.dev", "eva@acme.dev"],
  capacity: {
    personal: "any",
    shared: {
      pool: "main",
      budget: { amount: 600 },
      defaultAllocation: 80,
      allocations: { "slavo@acme.dev": 150, "eva@acme.dev": 150, "bob@acme.dev": 120 },
    },
  },
  ...overrides,
});

const manifest = {
  members: [
    { email: "slavo@acme.dev", name: "Slavo" },
    { email: "ana@acme.dev", name: "Ana" },
  ],
  role: "lead" as const,
};

const model = (entry: unknown, extra: { me?: string | null; people?: typeof roster } = {}) =>
  peopleModel({
    entry,
    people: extra.people ?? roster,
    me: extra.me === undefined ? "slavo@acme.dev" : extra.me,
    currency: "EUR",
    manifest,
  });

describe("who a project names", () => {
  it("reads the whole workspace and named people", () => {
    expect(membersOf({ members: ["*"] })).toEqual(["*"]);
    expect(modeOf(["*"])).toBe("all");
    expect(modeOf(["ana@acme.dev"])).toBe("selected");
  });

  it("reads an entry with no members as everyone, as the Hub does", () => {
    expect(membersOf({ name: "Booking" })).toEqual(["*"]);
  });

  it("names no one for something that is not an entry", () => {
    expect(membersOf(undefined)).toEqual([]);
    expect(leadsOf(undefined)).toEqual([]);
  });
});

describe("the people table", () => {
  it("lists named people with leads first, and says who you are", () => {
    const { rows, mode, count, more } = model(
      booking({
        leads: ["bob@acme.dev"],
        members: ["ana@acme.dev", "bob@acme.dev", "slavo@acme.dev"],
      }),
    );
    expect(mode).toBe("selected");
    expect(rows.map((row) => [row.name, row.lead, row.you])).toEqual([
      ["Bob", true, false],
      ["Ana", false, false],
      ["Slavo", false, true],
    ]);
    expect([count, more]).toEqual([3, 0]);
  });

  it("gives each person their allocation and whose rule it is", () => {
    const { rows } = model(booking());
    expect(rows.map((row) => [row.name, row.allocation])).toEqual([
      ["Slavo", { text: "€150", source: "custom" }],
      ["Eva", { text: "€150", source: "custom" }],
      ["Ana", { text: "€80", source: "project default" }],
      ["Vir", { text: "€80", source: "project default" }],
      ["Bob", { text: "€120", source: "custom" }],
    ]);
  });

  it("says no cap where shared capacity gives a person none, and nothing without shared capacity", () => {
    const withoutDefault = booking({
      capacity: { personal: "any", shared: { pool: "main", budget: { amount: 600 } } },
    });
    expect(model(withoutDefault).rows[2]?.allocation).toEqual({
      text: "No cap",
      source: "project default",
    });
    expect(model(booking({ capacity: { personal: "any" } })).rows[0]?.allocation).toBeNull();
  });

  it("lists the leads and the people with a custom allocation for the whole workspace, and counts the rest", () => {
    const { rows, mode, count, more } = model(booking({ members: ["*"] }));
    expect(mode).toBe("all");
    expect(rows.map((row) => row.name)).toEqual(["Slavo", "Eva", "Bob"]);
    expect([count, more]).toEqual([6, 3]);
  });

  it("leaves out people the workspace no longer has", () => {
    const { rows } = model(booking({ members: ["ana@acme.dev", "gone@acme.dev"], leads: [] }));
    expect(rows.map((row) => row.email)).toEqual(["ana@acme.dev"]);
  });

  it("matches addresses whatever their case", () => {
    const { rows } = model(booking({ members: ["Ana@Acme.dev"], leads: ["ANA@acme.dev"] }));
    expect(rows[0]).toMatchObject({ name: "Ana", lead: true });
  });

  it("names people by their address before the workspace's people are read", () => {
    const { rows } = model(booking({ members: ["ana@acme.dev"], leads: [] }), { people: [] });
    expect(rows[0]?.name).toBe("ana");
  });

  it("falls back to the manifest, where only the person's own part is known", () => {
    const { rows, mode } = model(undefined);
    expect(mode).toBeNull();
    expect(rows).toEqual([
      { email: "slavo@acme.dev", name: "Slavo", you: true, lead: true, allocation: null },
      { email: "ana@acme.dev", name: "Ana", you: false, lead: null, allocation: null },
    ]);
  });
});

describe("money", () => {
  it("writes an amount with its currency's symbol", () => {
    expect(formatMoney(150, "EUR")).toBe("€150");
    expect(formatMoney(80.5, "USD")).toBe("$80.50");
  });

  it("falls back to the code for a currency it does not know", () => {
    expect(formatMoney(12, "XX")).toBe("12 XX");
  });
});

describe("switching who is on the project", () => {
  it("is the whole workspace as `*`", () => {
    expect(
      membersForMode("all", { entry: booking(), saved: booking(), me: "slavo@acme.dev" }),
    ).toEqual(["*"]);
  });

  it("goes back to the people the saved project named, with its leads", () => {
    const saved = booking();
    const draft = booking({ members: ["*"] });
    expect(membersForMode("selected", { entry: draft, saved, me: "slavo@acme.dev" })).toEqual(
      saved.members,
    );
  });

  it("starts from the person editing, the leads and the custom allocations when the project had the whole workspace", () => {
    const saved = booking({ members: ["*"] });
    expect(membersForMode("selected", { entry: saved, saved, me: "mia@acme.dev" })).toEqual([
      "mia@acme.dev",
      "slavo@acme.dev",
      "eva@acme.dev",
      "bob@acme.dev",
    ]);
  });

  it("keeps a lead made meanwhile among the members", () => {
    const saved = booking();
    const draft = booking({ members: ["*"], leads: [...saved.leads, "ana@acme.dev"] });
    expect(membersForMode("selected", { entry: draft, saved, me: null })).toEqual(saved.members);
  });
});

describe("adding, making a lead and removing", () => {
  it("adds people once, whatever the case of their address", () => {
    expect(addPeople(["ana@acme.dev"], ["Ana@acme.dev", "mia@acme.dev"])).toEqual([
      "ana@acme.dev",
      "mia@acme.dev",
    ]);
  });

  it("makes a lead and takes the lead away", () => {
    expect(toggleLead(["slavo@acme.dev"], "ana@acme.dev")).toEqual([
      "slavo@acme.dev",
      "ana@acme.dev",
    ]);
    expect(toggleLead(["slavo@acme.dev", "ana@acme.dev"], "ANA@acme.dev")).toEqual([
      "slavo@acme.dev",
    ]);
  });

  it("takes a person's place, lead and custom allocation with them", () => {
    expect(removePerson(booking(), "eva@acme.dev")).toEqual({
      members: ["slavo@acme.dev", "ana@acme.dev", "vir@acme.dev", "bob@acme.dev"],
      leads: ["slavo@acme.dev"],
      allocations: { "slavo@acme.dev": 150, "bob@acme.dev": 120 },
    });
  });

  it("leaves allocations alone for a person who has none of their own", () => {
    const removal = removePerson(booking(), "ana@acme.dev");
    expect(removal.members).not.toContain("ana@acme.dev");
    expect(removal).not.toHaveProperty("allocations");
  });

  it("reads a person's custom allocation as text", () => {
    expect(customAllocation(booking(), "bob@acme.dev", "EUR")).toBe("€120");
    expect(customAllocation(booking(), "ana@acme.dev", "EUR")).toBeNull();
    expect(
      customAllocation(booking({ capacity: { personal: "any" } }), "bob@acme.dev", "EUR"),
    ).toBeNull();
  });
});

describe("who the add panel offers", () => {
  it("offers the workspace's people who are not on the project, by name", () => {
    expect(
      addCandidates(roster, ["slavo@acme.dev", "ana@acme.dev", "eva@acme.dev"], "").map(
        (person) => person.name,
      ),
    ).toEqual(["Bob", "Mia", "Vir"]);
  });

  it("narrows by what was typed in a name or an address", () => {
    expect(addCandidates(roster, [], "  MI ").map((person) => person.name)).toEqual(["Mia"]);
    expect(addCandidates(roster, [], "bob@").map((person) => person.name)).toEqual(["Bob"]);
    expect(addCandidates(roster, [], "nobody")).toEqual([]);
  });
});

describe("the sentences of the tab", () => {
  it("says who sees the project in each mode", () => {
    expect(
      modeText({
        mode: "selected",
        projectName: "Booking",
        workspaceName: "Acme",
        workspaceSize: 14,
      }),
    ).toBe(
      "Only the people below see Booking’s tasks, threads and events, and can get requests and notifications for it.",
    );
    expect(
      modeText({ mode: "all", projectName: "Booking", workspaceName: "Acme", workspaceSize: 14 }),
    ).toBe("Everyone in Acme (14 people) sees Booking. New members of Acme join it automatically.");
    expect(
      modeText({ mode: "all", projectName: "Booking", workspaceName: "Acme", workspaceSize: 0 }),
    ).toBe("Everyone in Acme sees Booking. New members of Acme join it automatically.");
  });

  it("counts the people the table does not list", () => {
    expect(moreText(9, "Acme")).toBe("and 9 more people in Acme");
    expect(moreText(1, "Acme")).toBe("and 1 more person in Acme");
  });

  it("tells a member who changes it, and the leads", () => {
    expect(readOnlyPeopleNote("Booking", ["Slavo", "Eva"])).toBe(
      "Leads and admins change who’s on Booking. Leads: Slavo, Eva.",
    );
    expect(readOnlyPeopleNote("Booking", [])).toBe("Leads and admins change who’s on Booking.");
  });

  it("names the leads from the document", () => {
    expect(leadNamesOf(booking(), ({ email }) => email.split("@")[0]!)).toEqual(["slavo", "eva"]);
  });
});

describe("what saving does beyond the changes", () => {
  const notes = (draft: unknown, extra: { me?: string; admin?: boolean } = {}) =>
    peopleNotes({
      projectName: "Booking",
      workspaceName: "Acme",
      saved: booking(),
      draft,
      me: extra.me ?? "slavo@acme.dev",
      admin: extra.admin ?? false,
    });

  it("says nothing while a lead stays", () => {
    expect(notes(booking({ leads: ["slavo@acme.dev"] }))).toEqual([]);
  });

  it("warns that a project left without a lead is changed by admins only", () => {
    expect(notes(booking({ leads: [] }))).toEqual([
      "Booking will have no lead. Only admins of Acme can change it then.",
    ]);
  });

  it("warns a lead who gives up their own lead, unless they are an admin", () => {
    const draft = booking({ leads: ["eva@acme.dev"] });
    expect(notes(draft)).toEqual([
      "You won’t be able to change Booking after this: only its leads and admins can.",
    ]);
    expect(notes(draft, { admin: true })).toEqual([]);
  });

  it("does not warn someone who was not a lead", () => {
    expect(notes(booking({ leads: ["eva@acme.dev"] }), { me: "ana@acme.dev" })).toEqual([]);
  });
});

describe("taking someone off the project", () => {
  const words = (overrides: Partial<Parameters<typeof removalWords>[0]> = {}) =>
    removalWords({
      projectName: "Booking",
      workspaceName: "Acme",
      person: { name: "Eva", you: false },
      sharedCapacity: true,
      allocation: null,
      ...overrides,
    });

  it("says what stops, what is revoked and that they stay in the workspace", () => {
    expect(words()).toEqual({
      title: "Remove Eva from Booking?",
      confirm: "Remove Eva",
      consequences: [
        "Stops seeing Booking’s tasks, threads and events, and stops getting its notifications.",
        "Their key for Booking’s shared capacity is revoked.",
        "Eva stays in Acme and in other projects.",
      ],
    });
  });

  it("mentions a key only where the project has shared capacity", () => {
    expect(words({ sharedCapacity: false }).consequences.join(" ")).not.toContain("key");
  });

  it("says a custom allocation goes with them", () => {
    expect(words({ allocation: "€150" }).consequences).toContain(
      "Their allocation of €150 is dropped.",
    );
  });

  it("speaks to the person removing themselves", () => {
    expect(words({ person: { name: "Slavo", you: true }, allocation: "€150" })).toEqual({
      title: "Remove yourself from Booking?",
      confirm: "Remove yourself",
      consequences: [
        "You stop seeing Booking’s tasks, threads and events, and stop getting its notifications.",
        "Your key for Booking’s shared capacity is revoked.",
        "Your allocation of €150 is dropped.",
        "You stay in Acme and in other projects.",
      ],
    });
  });
});
