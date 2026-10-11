import { describe, expect, it } from "vite-plus/test";

import {
  DESCRIPTION_MAX,
  basicsReadOnlyNote,
  basicsValues,
  companyKnowledgeHint,
  companyStoreOf,
  confirmsDeletion,
  deleteConsequences,
  deleteOperation,
  descriptionCount,
  firstRepositoryId,
  projectKnowledgeHint,
  settledText,
  shortRepository,
  textLength,
} from "./projectBasics.logic";

const manifest = {
  name: "Booking",
  client: "Northwind Hotels",
  description: "Reservations and payments.",
  knowledge: { kontext: true, company: false },
};

describe("the values of the form", () => {
  it("reads them from the project's entry of the document", () => {
    expect(
      basicsValues(
        {
          name: "Booking 2",
          client: "Northwind",
          description: "New engine.",
          knowledge: { kontext: false, company: true },
        },
        manifest,
      ),
    ).toEqual({
      name: "Booking 2",
      client: "Northwind",
      description: "New engine.",
      kontext: false,
      company: true,
    });
  });

  it("has no client or description where the entry has none, and knowledge on, as the Hub reads it", () => {
    expect(basicsValues({ name: "Booking" }, manifest)).toEqual({
      name: "Booking",
      client: "",
      description: "",
      kontext: true,
      company: true,
    });
  });

  it("reads the manifest while the document is not read", () => {
    expect(basicsValues(undefined, manifest)).toEqual({
      name: "Booking",
      client: "Northwind Hotels",
      description: "Reservations and payments.",
      kontext: true,
      company: false,
    });
  });
});

describe("typed text", () => {
  it("is trimmed, and nothing when blank", () => {
    expect(settledText("  Northwind Hotels \n")).toBe("Northwind Hotels");
    expect(settledText("   ")).toBeUndefined();
    expect(settledText("")).toBeUndefined();
  });

  it("counts characters as people do, not code units", () => {
    expect(textLength("Café 🚀")).toBe(6);
    expect(descriptionCount("a".repeat(92))).toBe(`92 / ${DESCRIPTION_MAX}`);
    expect(DESCRIPTION_MAX).toBe(300);
  });
});

describe("project knowledge", () => {
  it("names the repository whose .ai/ it reads", () => {
    expect(
      firstRepositoryId({ repositories: [{ id: "booking-api" }, { id: "booking-web" }] }),
    ).toBe("booking-api");
    expect(projectKnowledgeHint("booking-api")).toBe(
      "Decisions and conventions in .ai/ of booking-api",
    );
  });

  it("says a repository comes first when the project has none", () => {
    expect(firstRepositoryId({ repositories: [] })).toBeUndefined();
    expect(firstRepositoryId({})).toBeUndefined();
    expect(projectKnowledgeHint(undefined)).toBe(
      "Decisions and conventions in .ai/ of its repository. Add a repository first.",
    );
  });
});

describe("company knowledge", () => {
  const document = {
    knowledge: { company: { repository: "https://github.com/acme/knowledge.git", branch: "main" } },
  };

  it("is the store the document names, with its branch", () => {
    const store = companyStoreOf(document, null);
    expect(store).toEqual({
      repository: "https://github.com/acme/knowledge.git",
      branch: "main",
    });
    expect(companyKnowledgeHint("Acme", store)).toBe(
      "Acme’s shared store · acme/knowledge on main",
    );
  });

  it("is on main where the document leaves the branch out", () => {
    expect(
      companyStoreOf(
        { knowledge: { company: { repository: "git@github.com:acme/kb.git" } } },
        null,
      ),
    ).toEqual({ repository: "git@github.com:acme/kb.git", branch: "main" });
  });

  it("is what the manifest lists while the document is not read, without a branch", () => {
    const store = companyStoreOf(null, { repository: "https://github.com/acme/knowledge" });
    expect(store).toEqual({ repository: "https://github.com/acme/knowledge", branch: undefined });
    expect(companyKnowledgeHint("Acme", store)).toBe("Acme’s shared store · acme/knowledge");
  });

  it("is none where the document read says the workspace has none, whatever the manifest says", () => {
    expect(
      companyStoreOf({ knowledge: {} }, { repository: "https://github.com/acme/x" }),
    ).toBeNull();
    expect(companyStoreOf({}, null)).toBeNull();
    expect(companyStoreOf(null, null)).toBeNull();
  });

  it("says who adds one where the workspace has none", () => {
    expect(companyKnowledgeHint("Acme", null)).toBe(
      "Acme has no shared knowledge store yet. Its admins add one in Workspace › General.",
    );
  });
});

describe("a repository as people name it", () => {
  it.each([
    ["https://github.com/acme/knowledge.git", "acme/knowledge"],
    ["https://github.com/acme/knowledge/", "acme/knowledge"],
    ["git@github.com:acme/knowledge.git", "acme/knowledge"],
    ["ssh://git@gitlab.com/acme/team/knowledge.git", "acme/team/knowledge"],
    ["gitlab.com:acme/app", "acme/app"],
    ["/srv/git/knowledge.git", "/srv/git/knowledge.git"],
    ["not a url", "not a url"],
  ])("writes %s as %s", (address, short) => {
    expect(shortRepository(address)).toBe(short);
  });
});

describe("reading the form as a member", () => {
  it("names who changes it, in the Hub's words, and the leads", () => {
    expect(basicsReadOnlyNote("Booking's leads and admins", ["Slavo", "Eva"])).toBe(
      "Booking's leads and admins change this. Leads: Slavo, Eva.",
    );
    expect(basicsReadOnlyNote("admins", [])).toBe("Admins change this.");
  });
});

describe("deleting a project", () => {
  const booking = { id: "booking", name: "Booking" };

  it("lists what goes away and what stays, as the design words it", () => {
    expect(
      deleteConsequences(booking, { tasks: 14, areas: 3, people: 5, gatewayTeam: true }),
    ).toEqual([
      "14 tasks in 3 areas, with their task context and coordination history",
      "Booking’s settings: people, tools, path rules and allocations",
      "Booking leaves Work for 5 people. Threads on their computers stay, without the project.",
      "The gateway team “booking” stays, with its usage. Remove it there if you want.",
    ]);
  });

  it("leaves out the gateway team where the project has no shared capacity", () => {
    const lines = deleteConsequences(booking, {
      tasks: 2,
      areas: 0,
      people: 1,
      gatewayTeam: false,
    });
    expect(lines).toEqual([
      "2 tasks, with their task context and coordination history",
      "Booking’s settings: people, tools, path rules and allocations",
      "Booking leaves Work for 1 person. Threads on their computers stay, without the project.",
    ]);
  });

  it("does not count tasks that are not there", () => {
    expect(
      deleteConsequences(booking, { tasks: 0, areas: 2, people: 3, gatewayTeam: false })[0],
    ).toBe("Its areas, task context and coordination history");
    expect(
      deleteConsequences(booking, { tasks: 0, areas: 0, people: 3, gatewayTeam: false })[0],
    ).toBe("Its task context and coordination history");
    expect(
      deleteConsequences(booking, { tasks: 1, areas: 1, people: 3, gatewayTeam: false })[0],
    ).toBe("1 task in 1 area, with their task context and coordination history");
  });

  it("is confirmed by typing the id, not the name", () => {
    expect(confirmsDeletion("booking", "booking")).toBe(true);
    expect(confirmsDeletion("  booking ", "booking")).toBe(true);
    expect(confirmsDeletion("Booking", "booking")).toBe(false);
    expect(confirmsDeletion("", "booking")).toBe(false);
  });

  it("sets the project's node to nothing, against the revision read", () => {
    expect(deleteOperation("acme", 42, "booking")).toEqual({
      kind: "save",
      workspace: "acme",
      base: 42,
      set: [{ path: ["projects", "booking"], value: null }],
    });
  });
});
