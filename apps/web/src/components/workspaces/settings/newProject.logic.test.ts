import { describe, expect, it } from "vite-plus/test";

import {
  chipsFor,
  createOperation,
  isSafeRef,
  isSafeRemote,
  nameProblem,
  newProjectValue,
  projectIdFromName,
  readyToCreate,
  repositoryChoices,
  repositoryEntry,
  repositoryIdFromUrl,
  repositoryProblem,
  takenProjectIds,
  type NewProjectInput,
} from "./newProject.logic";

describe("the id a name makes", () => {
  it.each([
    ["Northwind loyalty", "northwind-loyalty"],
    ["  Booking  ", "booking"],
    ["Camp-bot", "camp-bot"],
    ["Café Ñandú", "cafe-nandu"],
    ["API v2 (new)!", "api-v2-new"],
    ["--A--B--", "a-b"],
    ["", ""],
    ["Проект", ""],
    ["!!!", ""],
  ])("makes %j into %j", (name, id) => {
    expect(projectIdFromName(name)).toBe(id);
  });

  it("is at most 48 characters, and never ends on a hyphen where it was cut", () => {
    const id = projectIdFromName(`${"a".repeat(47)} bcd`);
    expect(id).toBe("a".repeat(47));
    expect(projectIdFromName("x".repeat(80))).toHaveLength(48);
  });
});

describe("what is wrong with the name", () => {
  const taken = new Set(["booking", "camp-bot"]);
  const problem = (name: string) => nameProblem({ name, id: projectIdFromName(name), taken });

  it("says nothing of an empty name", () => {
    expect(problem("")).toBeNull();
    expect(problem("   ")).toBeNull();
  });

  it("says nothing of a name that makes a free id", () => {
    expect(problem("Northwind loyalty")).toBeNull();
  });

  it("refuses the reserved id, as the design words it", () => {
    expect(problem("Company")).toEqual({
      kind: "reserved",
      text: "“company” is reserved. Pick another name.",
    });
  });

  it("refuses the id of a project that exists", () => {
    expect(problem("Booking")).toEqual({
      kind: "taken",
      text: "A project with the ID “booking” exists already. Pick another name.",
    });
  });

  it("refuses a name that makes no id", () => {
    expect(problem("Проект")?.kind).toBe("no-id");
  });

  it("knows the ids of the document's projects and the manifest's", () => {
    expect(
      takenProjectIds({ projects: { booking: {}, "camp-bot": {} } }, ["peer-hub", "booking"]),
    ).toEqual(new Set(["booking", "camp-bot", "peer-hub"]));
    expect(takenProjectIds(null, ["peer-hub"])).toEqual(new Set(["peer-hub"]));
    expect(takenProjectIds({}, [])).toEqual(new Set());
  });
});

describe("a repository address", () => {
  it.each([
    "https://github.com/acme/booking-api",
    "https://github.com/acme/booking-api.git",
    "ssh://git@gitlab.com/acme/app.git",
    "git@gitlab.com:acme/app.git",
    "gitlab.com:acme/app.git",
    "file:///srv/git/app.git",
    "/Users/ana/code/app",
  ])("takes %s", (url) => {
    expect(isSafeRemote(url)).toBe(true);
  });

  it.each([
    "ext::sh -c touch% /tmp/pwned",
    "fd::17",
    "--upload-pack=touch /tmp/pwned",
    "https://example.test/app.git --config=x",
    " https://example.test/app.git",
    "https:///etc/passwd",
    "acme/booking-api",
    "",
  ])("refuses %j", (url) => {
    expect(isSafeRemote(url)).toBe(false);
  });

  it("takes a plain branch and refuses an option, a path trick or a lock", () => {
    expect(isSafeRef("main")).toBe(true);
    expect(isSafeRef("feature/KRK-812_split.payments")).toBe(true);
    for (const ref of ["--orphan", "-b", "a..b", "a b", "/main", "main/", "x.lock", ""]) {
      expect(isSafeRef(ref)).toBe(false);
    }
  });

  it.each([
    ["https://github.com/acme/booking-api", "booking-api"],
    ["https://github.com/acme/Booking-API.git", "booking-api"],
    ["git@github.com:acme/booking_web.git", "booking-web"],
    ["https://github.com/acme/booking-api/", "booking-api"],
    ["https://github.com/acme/booking-api?tab=readme", "booking-api"],
    ["file:///srv/git/app.git", "app"],
    ["/Users/ana/code/Peer Hub", "peer-hub"],
    ["https://example.test/", "example-test"],
    ["/", "repo"],
  ])("gives %s the id %s", (url, id) => {
    expect(repositoryIdFromUrl(url)).toBe(id);
  });
});

describe("the repository of the form", () => {
  it("is optional: no address is no repository and no problem", () => {
    expect(repositoryProblem({ url: "  ", branch: "nonsense branch" })).toBeNull();
    expect(repositoryEntry({ url: "", branch: "main" })).toBeNull();
  });

  it("is main until the person names a branch", () => {
    expect(repositoryEntry({ url: " https://github.com/acme/booking-api ", branch: "" })).toEqual({
      id: "booking-api",
      url: "https://github.com/acme/booking-api",
      branch: "main",
    });
    expect(
      repositoryEntry({ url: "https://github.com/acme/booking-api", branch: " release/2026 " })
        ?.branch,
    ).toBe("release/2026");
  });

  it("says what is wrong with the address or the branch", () => {
    expect(repositoryProblem({ url: "acme/booking-api", branch: "" })).toEqual({
      field: "url",
      text: "Enter a clone address, like https://github.com/acme/booking-api.",
    });
    expect(
      repositoryProblem({ url: "https://github.com/acme/booking-api", branch: "-b" })?.field,
    ).toBe("branch");
    expect(
      repositoryProblem({ url: "https://github.com/acme/booking-api", branch: "release/1" }),
    ).toBeNull();
  });
});

describe("the repositories open on this computer", () => {
  const checkout = (id: string, title: string, remoteUrl?: string) => ({
    id,
    title,
    ...(remoteUrl === undefined ? {} : { repositoryIdentity: { locator: { remoteUrl } } }),
  });

  it("offers the checkouts with a remote the Hub would take, by their project's title", () => {
    expect(
      repositoryChoices([
        checkout("a", "booking-api", "git@github.com:acme/booking-api.git"),
        checkout("b", "notes"),
        checkout("c", "odd", "ext::sh -c touch /tmp/x"),
        { id: "d", title: "none", repositoryIdentity: null },
        checkout("e", "booking-web", "https://github.com/acme/booking-web"),
      ]),
    ).toEqual([
      { id: "a", title: "booking-api", url: "git@github.com:acme/booking-api.git" },
      { id: "e", title: "booking-web", url: "https://github.com/acme/booking-web" },
    ]);
  });
});

describe("who is on the new project", () => {
  const people = [
    { email: "slavo@acme.dev", name: "Slavo" },
    { email: "eva@acme.dev", name: "Eva" },
    { email: "ana@acme.dev", name: "Ana" },
  ];
  const nameOf = ({ email }: { email: string }) =>
    people.find((person) => person.email === email.toLowerCase())?.name ?? email;

  it("lists the creator first, as a lead, then the people chosen", () => {
    expect(chipsFor("slavo@acme.dev", ["eva@acme.dev", "ana@acme.dev"], people, nameOf)).toEqual([
      { email: "slavo@acme.dev", name: "Slavo", lead: true },
      { email: "eva@acme.dev", name: "Eva", lead: false },
      { email: "ana@acme.dev", name: "Ana", lead: false },
    ]);
  });

  it("never lists the creator twice, nor someone the workspace does not have", () => {
    expect(
      chipsFor(
        "slavo@acme.dev",
        ["Slavo@acme.dev", "eva@acme.dev", "EVA@acme.dev", "gone@acme.dev"],
        people,
        nameOf,
      ).map((chip) => chip.email),
    ).toEqual(["slavo@acme.dev", "eva@acme.dev"]);
  });
});

describe("the project the form creates", () => {
  const input = (overrides: Partial<NewProjectInput> = {}): NewProjectInput => ({
    name: "  Northwind loyalty ",
    client: "",
    description: "",
    who: "selected",
    people: [],
    repository: { url: "", branch: "" },
    me: "slavo@acme.dev",
    ...overrides,
  });

  it("is the name, the creator as its only member and lead, and no repository", () => {
    expect(newProjectValue(input())).toEqual({
      name: "Northwind loyalty",
      members: ["slavo@acme.dev"],
      leads: ["slavo@acme.dev"],
      repositories: [],
    });
  });

  it("adds the client, the description, the people and the repository when given", () => {
    expect(
      newProjectValue(
        input({
          client: " Northwind Hotels ",
          description: " Loyalty programme. ",
          people: ["eva@acme.dev", "Slavo@acme.dev", "eva@acme.dev"],
          repository: { url: "https://github.com/acme/loyalty", branch: "" },
        }),
      ),
    ).toEqual({
      name: "Northwind loyalty",
      client: "Northwind Hotels",
      description: "Loyalty programme.",
      members: ["slavo@acme.dev", "eva@acme.dev"],
      leads: ["slavo@acme.dev"],
      repositories: [{ id: "loyalty", url: "https://github.com/acme/loyalty", branch: "main" }],
    });
  });

  it("is the whole workspace as `*`, with the creator still its lead", () => {
    expect(newProjectValue(input({ who: "all", people: ["eva@acme.dev"] }))).toMatchObject({
      members: ["*"],
      leads: ["slavo@acme.dev"],
    });
  });

  it("is added by a change on the project's node against the revision read", () => {
    const operation = createOperation({
      workspace: "acme",
      base: 41,
      id: "northwind-loyalty",
      project: input(),
    });
    expect(operation).toMatchObject({
      kind: "save",
      workspace: "acme",
      base: 41,
      set: [{ path: ["projects", "northwind-loyalty"], value: { name: "Northwind loyalty" } }],
    });
  });
});

describe("when Create is on", () => {
  const ready = {
    name: "Northwind loyalty",
    nameProblem: null,
    description: "",
    repositoryProblem: null,
    read: true,
  };

  it("is on for a name that makes a free id", () => {
    expect(readyToCreate(ready)).toBe(true);
  });

  it.each([
    ["no name", { name: "  " }],
    ["a problem with the name", { nameProblem: { kind: "taken" as const, text: "x" } }],
    ["a description that is too long", { description: "a".repeat(301) }],
    [
      "a repository that cannot be cloned",
      { repositoryProblem: { field: "url" as const, text: "x" } },
    ],
    ["settings that are not read", { read: false }],
  ])("is off with %s", (_, change) => {
    expect(readyToCreate({ ...ready, ...change })).toBe(false);
  });
});
