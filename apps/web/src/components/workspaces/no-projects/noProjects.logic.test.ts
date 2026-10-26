import type { PeerSettingsProposal } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  adminWords,
  adminsOf,
  alreadyAsked,
  ASK_TO_BE_ADDED,
  askInput,
  askRefusal,
  listNames,
  memberWords,
} from "./noProjects.logic";

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
  it("names the workspace, its admins and the first of them to ask", () => {
    expect(memberWords({ workspaceName: "Acme", admins: adminsOf(people) })).toEqual({
      title: "You’re in Acme, but not on a project yet",
      text: "Project leads and admins add people in a project’s settings. Admins in Acme: Slavo and Eva.",
      ask: "Ask Slavo to add you",
    });
  });

  it("asks an admin, with no name to give, while the Hub has not said who they are", () => {
    expect(memberWords({ workspaceName: "Acme", admins: [] })).toEqual({
      title: "You’re in Acme, but not on a project yet",
      text: "Project leads and admins add people in a project’s settings.",
      ask: "Ask an admin to add you",
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

describe("the request to be added", () => {
  it("is a proposal without changes, about the workspace, on the revision the person read", () => {
    expect(askInput("acme", 42)).toEqual({
      workspace: "acme",
      base: 42,
      set: [],
      message: "Please add me to a project",
      scope: "workspace",
    });
    expect(ASK_TO_BE_ADDED).toBe("Please add me to a project");
  });

  const proposal = (extra: Partial<PeerSettingsProposal> = {}): PeerSettingsProposal => ({
    id: "p1",
    by: { email: "mia@acme.test", name: "Mia" },
    at: "2026-10-11T10:00:00Z",
    base: 42,
    message: ASK_TO_BE_ADDED,
    lines: [],
    scopes: ["workspace"],
    owners: "admins",
    state: "pending",
    mine: true,
    canDecide: false,
    ...extra,
  });

  it("is waiting while one of the person's own requests without changes is pending", () => {
    expect(alreadyAsked([proposal()])).toBe(true);
    expect(alreadyAsked([])).toBe(false);
    // Someone else's, one already answered, and an agent's proposal of changes are not it.
    expect(alreadyAsked([proposal({ mine: false })])).toBe(false);
    expect(alreadyAsked([proposal({ state: "declined" })])).toBe(false);
    expect(
      alreadyAsked([
        proposal({
          lines: [
            {
              path: ["projects", "booking", "members"],
              scope: { kind: "project", id: "booking", name: "Booking" },
              label: "People",
              from: "none",
              to: "Mia",
            },
          ],
        }),
      ]),
    ).toBe(false);
    expect(alreadyAsked([proposal({ message: "Something else" })])).toBe(false);
  });

  it("says why the Hub did not take it, and nothing when it did", () => {
    expect(askRefusal({ kind: "proposed", proposal: proposal() })).toBeNull();
    expect(askRefusal({ kind: "forbidden", refused: [] })).toBe(
      "Peer could not send the request to the admins.",
    );
    expect(
      askRefusal({
        kind: "invalid",
        diagnostics: [{ severity: "error", at: "scope", message: "no such scope" }],
      }),
    ).toBe("no such scope");
    expect(askRefusal({ kind: "invalid", diagnostics: [] })).toBe(
      "Peer could not send the request to the admins.",
    );
  });
});
