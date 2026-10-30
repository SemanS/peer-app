import { describe, expect, it } from "vite-plus/test";

import {
  inviteReach,
  inviteRefusal,
  invitationActionRefusal,
  INVITE_ROLES,
  cleanupSets,
  invalidText,
  invitedTitle,
  noLeadNote,
  parseAddresses,
  projectsNaming,
  removalConsequences,
  removalMessage,
  removeLabel,
  stillNamedText,
  tookOutFailed,
  tookOutText,
  unchangeableText,
} from "./workspacePeople.logic";

describe("the addresses an invite names", () => {
  it("takes one address", () => {
    expect(parseAddresses("mia@northwind.dev")).toEqual({
      valid: ["mia@northwind.dev"],
      invalid: [],
    });
  });

  it("splits a pasted list at commas, semicolons, spaces and lines", () => {
    expect(
      parseAddresses(
        "mia@northwind.dev, bob@northwind.dev;ana@northwind.dev\neva@northwind.dev kim@northwind.dev",
      ),
    ).toEqual({
      valid: [
        "mia@northwind.dev",
        "bob@northwind.dev",
        "ana@northwind.dev",
        "eva@northwind.dev",
        "kim@northwind.dev",
      ],
      invalid: [],
    });
  });

  it("takes the address out of a name in angle brackets", () => {
    expect(parseAddresses("Mia Doe <mia@northwind.dev>, Bob <bob@northwind.dev>")).toEqual({
      valid: ["mia@northwind.dev", "bob@northwind.dev"],
      invalid: [],
    });
  });

  it("takes every bracketed address of a part, however many names come before them", () => {
    expect(parseAddresses("Mia <mia@northwind.dev> Bob <bob@northwind.dev>")).toEqual({
      valid: ["mia@northwind.dev", "bob@northwind.dev"],
      invalid: [],
    });
  });

  it("keeps each address once, however it is cased", () => {
    expect(parseAddresses("Mia@Northwind.dev mia@northwind.dev")).toEqual({
      valid: ["Mia@Northwind.dev"],
      invalid: [],
    });
  });

  it("sets aside what is no address, and still takes the rest", () => {
    expect(parseAddresses("mia@northwind.dev, mia, @nobody, bob@x")).toEqual({
      valid: ["mia@northwind.dev"],
      invalid: ["mia", "@nobody", "bob@x"],
    });
  });

  it("is nothing for nothing", () => {
    expect(parseAddresses("  \n , ; ")).toEqual({ valid: [], invalid: [] });
  });

  it("says which words are not addresses", () => {
    expect(invalidText(["mia"])).toBe("“mia” is not an email address.");
    expect(invalidText(["mia", "bob", "@x"])).toBe(
      "“mia”, “bob” and “@x” are not an email address.",
    );
  });
});

describe("the words of the invite", () => {
  it("offers a member and an admin, the admin described by what they manage", () => {
    expect(INVITE_ROLES.map((role) => role.id)).toEqual(["member", "admin"]);
    expect(INVITE_ROLES[0]?.description("Acme")).toBe("Can work on assigned projects");
    expect(INVITE_ROLES[1]?.description("Acme")).toBe("Can manage people and projects");
  });

  it("names the role on the button", () => {});

  it("says who was invited, and as what when it is not a member", () => {
    expect(invitedTitle(["mia@northwind.dev"], "member")).toBe("Invited mia@northwind.dev");
    expect(invitedTitle(["mia@northwind.dev"], "admin")).toBe("Invited mia@northwind.dev as admin");
    expect(invitedTitle(["a@x.dev", "b@x.dev", "c@x.dev"], "member")).toBe("Invited 3 people");
    expect(invitedTitle(["a@x.dev", "b@x.dev"], "admin")).toBe("Invited 2 people as admins");
  });
});

/** Mia as the design has her: a lead of Booking, an allocation in Peer Hub, a member of Camp-bot. */
const document = {
  projects: {
    booking: {
      name: "Booking",
      members: ["slavo@acme.dev", "mia@acme.dev"],
      leads: ["slavo@acme.dev", "mia@acme.dev"],
      capacity: { personal: "any" },
    },
    "peer-hub": {
      name: "Peer Hub",
      members: ["slavo@acme.dev", "mia@acme.dev"],
      leads: ["slavo@acme.dev"],
      capacity: {
        personal: "any",
        shared: {
          pool: "main",
          budget: { amount: 500 },
          allocations: { "slavo@acme.dev": 150, "mia@acme.dev": 80 },
        },
      },
    },
    "camp-bot": { name: "Camp-bot", members: ["mia@acme.dev"], leads: [] },
    everyone: { name: "Everyone", members: ["*"], leads: ["slavo@acme.dev"] },
    solo: { name: "Solo", members: ["*"], leads: ["mia@acme.dev"] },
    elsewhere: { name: "Elsewhere", members: ["slavo@acme.dev"], leads: ["slavo@acme.dev"] },
  },
};

describe("the projects that still name a person", () => {
  const naming = (extra: Partial<Parameters<typeof projectsNaming>[0]> = {}) =>
    projectsNaming({
      document,
      email: "mia@acme.dev",
      planned: [],
      currency: "EUR",
      ...extra,
    });

  it("list what names them there, by project name", () => {
    expect(naming()).toEqual([
      { id: "booking", name: "Booking", detail: "lead", onlyLead: false, editable: true },
      { id: "camp-bot", name: "Camp-bot", detail: "member", onlyLead: false, editable: true },
      {
        id: "peer-hub",
        name: "Peer Hub",
        detail: "allocation €80",
        onlyLead: false,
        editable: true,
      },
      { id: "solo", name: "Solo", detail: "lead", onlyLead: true, editable: true },
    ]);
  });

  it("do not list a project open to everyone that names them nowhere, nor one that does not", () => {
    const ids = naming().map((project) => project.id);
    expect(ids).not.toContain("everyone");
    expect(ids).not.toContain("elsewhere");
  });

  it("say lead and allocation together, and match an address in any case", () => {
    const both = projectsNaming({
      document: {
        projects: {
          booking: {
            name: "Booking",
            members: ["Mia@Acme.dev"],
            leads: ["MIA@acme.dev", "slavo@acme.dev"],
            capacity: { shared: { allocations: { "Mia@Acme.dev": 120.5 } } },
          },
        },
      },
      email: "mia@acme.dev",
      planned: [],
      currency: "EUR",
    });
    expect(both).toEqual([
      {
        id: "booking",
        name: "Booking",
        detail: "lead · allocation €120.50",
        onlyLead: false,
        editable: true,
      },
    ]);
  });

  it("add the projects the Hub's plan names that the document does not show, as read only", () => {
    const rows = naming({
      planned: ["booking", "legacy"],
      fallbackName: (id) => (id === "legacy" ? "Legacy" : undefined),
    });
    expect(rows.find((row) => row.id === "legacy")).toEqual({
      id: "legacy",
      name: "Legacy",
      detail: "named in the configuration",
      onlyLead: false,
      editable: false,
    });
    expect(rows.filter((row) => row.id === "booking")).toHaveLength(1);
  });

  it("know only the plan's projects without the document, none of them to change here", () => {
    expect(
      projectsNaming({
        document: null,
        email: "mia@acme.dev",
        planned: ["kirkwood"],
        currency: "EUR",
      }),
    ).toEqual([
      {
        id: "kirkwood",
        name: "kirkwood",
        detail: "named in the configuration",
        onlyLead: false,
        editable: false,
      },
    ]);
  });

  it("are none for a person nothing names", () => {
    expect(naming({ email: "nobody@acme.dev" })).toEqual([]);
  });
});

describe("the save that takes a person out of projects", () => {
  const sets = (ids: ReadonlyArray<string>) => cleanupSets(document, "mia@acme.dev", ids);

  it("removes them from the members and the leads of a project", () => {
    expect(sets(["booking"])).toEqual([
      { path: ["projects", "booking", "members"], value: ["slavo@acme.dev"] },
      { path: ["projects", "booking", "leads"], value: ["slavo@acme.dev"] },
    ]);
  });

  it("drops their allocation with them, and leaves the others'", () => {
    expect(sets(["peer-hub"])).toEqual([
      { path: ["projects", "peer-hub", "members"], value: ["slavo@acme.dev"] },
      {
        path: ["projects", "peer-hub", "capacity", "shared", "allocations"],
        value: { "slavo@acme.dev": 150 },
      },
    ]);
  });

  it("leaves a project with no one on it without members, as the Hub allows", () => {
    expect(sets(["camp-bot"])).toEqual([{ path: ["projects", "camp-bot", "members"], value: [] }]);
  });

  it("never touches the whole workspace of a project open to everyone, only the lead", () => {
    expect(sets(["solo"])).toEqual([{ path: ["projects", "solo", "leads"], value: [] }]);
  });

  it("sets nothing for a project that does not name them, or that the document lacks", () => {
    expect(sets(["elsewhere", "everyone", "missing"])).toEqual([]);
  });

  it("covers every project that is ticked, in the order given", () => {
    expect(sets(["peer-hub", "booking"]).map((set) => set.path.slice(0, 3).join("/"))).toEqual([
      "projects/peer-hub/members",
      "projects/peer-hub/capacity",
      "projects/booking/members",
      "projects/booking/leads",
    ]);
  });

  it("matches the address whatever its case", () => {
    expect(
      cleanupSets(
        { projects: { booking: { name: "Booking", members: ["Mia@ACME.dev", "ana@acme.dev"] } } },
        "mia@acme.dev",
        ["booking"],
      ),
    ).toEqual([{ path: ["projects", "booking", "members"], value: ["ana@acme.dev"] }]);
  });

  it("carries the reason the design gives", () => {
    expect(removalMessage("Mia", "Acme")).toBe("Removed Mia from Acme");
  });
});

describe("the words of the removal", () => {
  it("says how far the button goes", () => {
    expect(removeLabel("Acme", 0, 0)).toBe("Remove from Acme");
    expect(removeLabel("Acme", 2, 0)).toBe("Remove from Acme only");
    expect(removeLabel("Acme", 2, 1)).toBe("Remove from Acme and 1 project");
    expect(removeLabel("Acme", 2, 2)).toBe("Remove from Acme and 2 projects");
  });

  it("names the person, never a pronoun, where the projects are listed", () => {
    expect(stillNamedText("Mia", 2)).toBe(
      "Mia is still named in two projects. Take Mia out of them too:",
    );
    expect(stillNamedText("Mia", 1)).toBe(
      "Mia is still named in one project. Take Mia out of it too:",
    );
    expect(stillNamedText("Mia", 12)).toBe(
      "Mia is still named in 12 projects. Take Mia out of them too:",
    );
  });

  it("warns of a project left without a lead", () => {
    expect(noLeadNote("Solo", "Acme")).toBe(
      "Solo will have no lead. Only admins of Acme can change it then.",
    );
  });

  it("says what stays when the settings cannot be changed here", () => {
    expect(unchangeableText("Mia", ["Legacy", "Kirkwood"])).toBe(
      "The workspace configuration still names Mia in Legacy and Kirkwood. Mia stays named there until it is changed.",
    );
  });

  it("tells what the follow-up did, or that the removal stands", () => {
    expect(tookOutText("Mia", ["Booking", "Peer Hub"])).toBe(
      "Took Mia out of Booking and Peer Hub",
    );
    expect(tookOutFailed("Mia", "Acme", "Eva saved Booking meanwhile")).toBe(
      "Mia is removed from Acme, but the projects still name Mia: Eva saved Booking meanwhile",
    );
  });
});

describe("what removing a member does", () => {
  const plan = {
    email: "mia@acme.dev",
    role: "member" as const,
    keys: 2,
    invites: 1,
    projects: ["booking"],
    canRemove: true,
  };

  it("lists the access, keys, way back and invitations from the plan", () => {
    expect(removalConsequences({ name: "Mia", workspaceName: "Acme", plan })).toEqual([
      "Mia loses access to Acme.",
      "Mia’s 2 shared-capacity keys are revoked.",
      "Mia cannot rejoin by domain until an admin invites Mia again.",
      "1 invitation Mia sent is withdrawn.",
      "Local clones and git host access must be reviewed separately.",
    ]);
  });

  it("leaves out the keys and invitations there are none of", () => {
    const lines = removalConsequences({
      name: "Mia",
      workspaceName: "Acme",
      plan: { ...plan, keys: 0, invites: 0 },
    });
    expect(lines).toEqual([
      "Mia loses access to Acme.",
      "Mia cannot rejoin by domain until an admin invites Mia again.",
      "Local clones and git host access must be reviewed separately.",
    ]);
  });

  it("says one key, and several invitations, in the right number", () => {
    const lines = removalConsequences({
      name: "Mia",
      workspaceName: "Acme",
      plan: { ...plan, keys: 1, invites: 3 },
    });
    expect(lines).toContain("Mia’s 1 shared-capacity key is revoked.");
    expect(lines).toContain("3 invitations Mia sent are withdrawn.");
  });

  it("says a Hub that cannot preview cannot", () => {
    const lines = removalConsequences({
      name: "Mia",
      workspaceName: "Acme",
      plan: { unsupported: true },
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("This Hub cannot preview the effect.");
    expect(lines[0]).toContain("may allow Mia to rejoin by domain");
    expect(lines[1]).toBe("Local clones and git host access must be reviewed separately.");
  });
});

describe("what an invitation reaches", () => {
  const preview = {
    email: "mia@northwind.dev",
    openProjects: ["Booking", "Site"],
    restrictedProjects: ["Payroll"],
    capacity: { memberLimit: 3, members: 2, pending: 0 },
    wouldExceed: false,
    alreadyMember: false,
    readmits: false,
  };

  it("names the open projects, the restricted ones and the room left", () => {
    const reach = inviteReach(preview, "Northwind");
    expect(reach.projects).toBe("They work in Booking and Site once they join.");
    expect(reach.restricted).toBe("Payroll needs them added in the project’s People tab.");
    expect(reach.capacity).toBe("2 of 3 members.");
    expect(reach.overLimit).toBeNull();
  });

  it("warns when the invitations are more than the limit, by the Hub's word for one", () => {
    expect(inviteReach({ ...preview, wouldExceed: true }, "Northwind").overLimit).toContain(
      "Hub’s administrator raises its capacity",
    );
  });

  it("keeps address-specific project access and readmission facts separate in a batch", () => {
    const alice = inviteReach(
      { ...preview, email: "alice@northwind.dev", openProjects: ["Alice only", "Shared"] },
      "Northwind",
    );
    const bob = inviteReach(
      {
        ...preview,
        email: "bob@northwind.dev",
        openProjects: ["Shared"],
        restrictedProjects: ["Alice only"],
        readmits: true,
      },
      "Northwind",
    );
    expect(alice.projects).toContain("Alice only and Shared");
    expect(alice.projects).not.toContain("They all");
    expect(bob.projects).not.toContain("Alice only");
    expect(bob.restricted).toContain("Alice only needs them added");
    expect(bob.person).toContain("bob@northwind.dev was removed before");
    expect(alice.person).toBeNull();
    expect(
      inviteReach({ ...preview, alreadyMember: true, readmits: false }, "Northwind").person,
    ).toContain("already a member");
  });

  it("says nothing of capacity where nothing limits it, and tells a returning person", () => {
    const reach = inviteReach(
      {
        ...preview,
        openProjects: [],
        capacity: { memberLimit: null, members: 9, pending: 1 },
        readmits: true,
      },
      "Northwind",
    );
    expect(reach.capacity).toBeNull();
    expect(reach.projects).toContain("They have no project access in Northwind yet");
    expect(reach.person).toBe("mia@northwind.dev was removed before; this invites them back.");
  });
});

describe("a refused invitation", () => {
  it("says an address an admin removed comes back by an admin only", () => {
    expect(
      inviteRefusal("dan@acme.test", { code: "removed", status: 403, message: "removed" }),
    ).toBe("An admin removed dan@acme.test; only an admin can invite them again.");
  });

  it("says whose invitation is pending in the words the server put it", () => {
    const message = "ana@acme.test already invited dan@acme.test; ask ana@acme.test or an admin.";
    expect(
      inviteRefusal("dan@acme.test", { code: "invitation_pending", status: 409, message }),
    ).toBe(message);
  });

  it("keeps the Hub's words for any other refusal", () => {
    expect(inviteRefusal("dan@acme.test", { code: "forbidden", message: "not allowed" })).toBe(
      "Could not invite dan@acme.test: not allowed",
    );
  });

  it("tells a lead that another person's invitation is not theirs", () => {
    const gone = { code: "not_found", status: 404, message: "no invitation for dan@acme.test" };
    expect(invitationActionRefusal("dan@acme.test", "resend", gone, true)).toBe(
      "dan@acme.test: not your invitation. Only the person who sent it or an admin can send it again.",
    );
    expect(invitationActionRefusal("dan@acme.test", "revoke", gone, true)).toBe(
      "dan@acme.test: not your invitation. Only the person who sent it or an admin can revoke it.",
    );
    expect(invitationActionRefusal("dan@acme.test", "revoke", gone, false)).toBe(
      "dan@acme.test: no invitation for dan@acme.test",
    );
    expect(
      invitationActionRefusal(
        "dan@acme.test",
        "resend",
        { code: "not_a_lead", status: 403, message: "you no longer lead webshop" },
        true,
      ),
    ).toBe("dan@acme.test: you no longer lead webshop");
  });
});
