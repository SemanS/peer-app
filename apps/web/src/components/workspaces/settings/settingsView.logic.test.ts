import { describe, expect, it } from "vite-plus/test";

import {
  canChangePath,
  knownPending,
  knownRevision,
  ownersOfPath,
  personName,
  initialOf,
  type SettingsRightsInput,
} from "./settingsView.logic";

const document = {
  projects: {
    booking: {
      name: "Booking",
      leads: ["slavo@acme.dev"],
      members: ["*"],
      capacity: { personal: "any", shared: { pool: "main", budget: { amount: 600 } } },
    },
    "camp-bot": { name: "Camp-bot", leads: ["eva@acme.dev"], members: ["*"] },
  },
  people: { "ana@acme.dev": { name: "Ana" } },
  tools: { jira: { name: "Jira" } },
};

const rightsOf = (
  rights: Partial<SettingsRightsInput["rights"]>,
  email: string | null = "slavo@acme.dev",
): SettingsRightsInput => ({
  rights: { admin: false, owner: false, leads: [], ...rights },
  email,
  document,
});

describe("who may change a node (the Hub's table, for gating controls)", () => {
  const lead = rightsOf({ leads: ["booking"] });
  const member = rightsOf({}, "ana@acme.dev");
  const admin = rightsOf({ admin: true });

  it.each<[string, ReadonlyArray<string>, boolean, boolean, boolean]>([
    // [what, path, lead of booking, plain member, admin]
    ["a project's policy", ["projects", "booking", "coordination", "policy"], true, false, true],
    ["the project node itself (delete)", ["projects", "booking"], true, false, true],
    ["another project they do not lead", ["projects", "camp-bot", "leads"], false, false, true],
    ["a new project (create)", ["projects", "new-one"], true, true, true],
    ["shared capacity itself", ["projects", "booking", "capacity", "shared"], false, false, true],
    ["its budget", ["projects", "booking", "capacity", "shared", "budget"], false, false, true],
    [
      "below its budget",
      ["projects", "booking", "capacity", "shared", "budget", "amount"],
      false,
      false,
      true,
    ],
    ["its pool", ["projects", "booking", "capacity", "shared", "pool"], false, false, true],
    ["its models", ["projects", "booking", "capacity", "shared", "models"], false, false, true],
    ["its use", ["projects", "booking", "capacity", "shared", "use"], false, false, true],
    [
      "an allocation",
      ["projects", "booking", "capacity", "shared", "allocations", "ana@acme.dev"],
      true,
      false,
      true,
    ],
    [
      "the default allocation",
      ["projects", "booking", "capacity", "shared", "defaultAllocation"],
      true,
      false,
      true,
    ],
    [
      "the rule for personal plans",
      ["projects", "booking", "capacity", "personal"],
      true,
      false,
      true,
    ],
    ["a tool of the catalog", ["tools", "jira", "name"], false, false, true],
    ["the gateway", ["gateway", "url"], false, false, true],
    ["a webhook", ["webhooks", "ops"], false, false, true],
    ["the currency", ["currency"], false, false, true],
  ])("%s", (_what, path, asLead, asMember, asAdmin) => {
    expect(canChangePath(lead, path)).toBe(asLead);
    expect(canChangePath(member, path)).toBe(asMember);
    expect(canChangePath(admin, path)).toBe(asAdmin);
  });

  it("lets a person change their own entry, whatever the case of their address, and no one else's", () => {
    expect(canChangePath(member, ["people", "ana@acme.dev", "personal"])).toBe(true);
    expect(
      canChangePath(rightsOf({}, "Ana@Acme.dev"), ["people", "ana@acme.dev", "personal"]),
    ).toBe(true);
    expect(canChangePath(member, ["people", "bob@acme.dev", "personal"])).toBe(false);
    expect(canChangePath(rightsOf({}, null), ["people", "ana@acme.dev"])).toBe(false);
  });

  it("counts an owner as an admin, and a lead of another project as no lead here", () => {
    expect(canChangePath(rightsOf({ owner: true }), ["tools", "jira"])).toBe(true);
    expect(canChangePath(rightsOf({ leads: ["camp-bot"] }), ["projects", "booking", "areas"])).toBe(
      false,
    );
  });
});

describe("who to name where a control is off", () => {
  it.each<[ReadonlyArray<string>, string]>([
    [["projects", "booking", "coordination", "policy"], "Booking's leads and admins"],
    [["projects", "booking", "capacity", "shared", "budget"], "admins"],
    [["projects", "no-name-yet", "leads"], "no-name-yet's leads and admins"],
    [["projects", "brand-new"], "any member"],
    [["people", "ana@acme.dev", "personal"], "ana@acme.dev and admins"],
    [["tools", "jira"], "admins"],
  ])("%j: %s", (path, owners) => {
    expect(ownersOfPath(document, path)).toBe(owners);
  });
});

describe("naming a person", () => {
  const people = [
    { email: "eva@acme.dev", name: "Eva" },
    { email: "ana@acme.dev", name: "  " },
  ];

  it("prefers the workspace's people list, then the name carried, then the address's local part", () => {
    expect(personName(people, { email: "EVA@acme.dev", name: "Evelyn" })).toBe("Eva");
    expect(personName(people, { email: "bob@acme.dev", name: "Bob K." })).toBe("Bob K.");
    expect(personName(people, { email: "ana@acme.dev", name: "" })).toBe("ana");
    expect(personName([], { email: "vir@acme.dev" })).toBe("vir");
  });

  it("marks a name with its first letter", () => {
    expect(initialOf("  eva")).toBe("E");
    expect(initialOf("")).toBe("?");
  });
});

describe("what the status says of a workspace", () => {
  const status = {
    settings: {
      workspaces: [
        { workspace: "acme", revision: 42, pendingProposals: 2 },
        { workspace: "camp", revision: 7, pendingProposals: 0 },
      ],
    },
  };

  it("names the revision and the proposals waiting for the person", () => {
    expect(knownRevision(status, "acme")).toBe(42);
    expect(knownPending(status, "acme")).toBe(2);
    expect(knownRevision(status, "unknown")).toBeUndefined();
    expect(knownRevision({}, "acme")).toBeUndefined();
    expect(knownPending({}, "acme")).toBeUndefined();
  });
});
