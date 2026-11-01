import { describe, expect, it } from "vite-plus/test";

import { adminWords, adminsOf, listNames, memberWords } from "./noProjects.logic";

const people = [
  { email: "mia@acme.test", name: "Mia", role: "member" as const },
  { email: "slavo@acme.test", name: "Slavo", role: "owner" as const },
  { email: "eva@acme.test", name: "Eva", role: "admin" as const },
];

describe("who a member is told to ask", () => {
  it("names the workspace's owners and admins, in the order the Hub lists its people", () => {
    expect(adminsOf(people)).toEqual([
      { email: "slavo@acme.test", name: "Slavo" },
      { email: "eva@acme.test", name: "Eva" },
    ]);
  });

  it("calls a person with no name by the part of their address before the @", () => {
    expect(adminsOf([{ email: "ana@acme.test", name: " ", role: "admin" }])).toEqual([
      { email: "ana@acme.test", name: "ana" },
    ]);
  });

  it("lists names the way a sentence does", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["Slavo"])).toBe("Slavo");
    expect(listNames(["Slavo", "Eva"])).toBe("Slavo and Eva");
    expect(listNames(["Slavo", "Eva", "Ana"])).toBe("Slavo, Eva and Ana");
  });
});

describe("what Work says to a member with no project", () => {
  it("names the workspace and its admins", () => {
    expect(memberWords({ workspaceName: "Acme", admins: adminsOf(people) })).toEqual({
      title: "You’re in Acme, but not on a project yet",
      text: "Project leads and admins add people in a project’s settings. Admins in Acme: Slavo and Eva.",
    });
  });

  it("gives no name while the Hub has not said who they are", () => {
    expect(memberWords({ workspaceName: "Acme", admins: [] })).toEqual({
      title: "You’re in Acme, but not on a project yet",
      text: "Project leads and admins add people in a project’s settings.",
    });
  });
});

describe("what Work says to an admin with no project", () => {
  it("introduces the first steps, and names the workspace when there are several", () => {
    const text = "Four steps get it ready for your team. Each opens the page that does it.";
    expect(adminWords({ workspaceName: "Acme", several: false })).toEqual({
      title: "Set up your workspace",
      text,
    });
    expect(adminWords({ workspaceName: "Acme", several: true }).title).toBe("Set up Acme");
  });
});
