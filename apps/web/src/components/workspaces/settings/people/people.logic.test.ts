import type { PeerInvitation, PeerWorkspaceMembers } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { accessOf, accessText, filterPeople, initials, limitOf, peopleRows } from "./people.logic";

const NOW = Date.parse("2026-10-30T08:00:00Z");
const name = (id: string) => (id === "formbricks" ? "Formbricks" : undefined);
const members = {
  members: [
    { email: "ana@acme.dev", role: "owner", joinedAt: "2026-10-01T00:00:00Z" },
    {
      email: "bob@acme.dev",
      role: "member",
      joinedAt: "2026-10-01T00:00:00Z",
      projects: ["formbricks"],
    },
    { email: "cyril@acme.dev", role: "member", joinedAt: "2026-10-01T00:00:00Z", projects: [] },
  ],
  invites: [],
  removed: [{ email: "dan@acme.dev", invited: false }],
} as unknown as PeerWorkspaceMembers;
const invitation = (email: string, status: string, projects: ReadonlyArray<string>) =>
  ({
    email,
    role: "member",
    status,
    projects,
    invitedAt: "2026-10-29T00:00:00Z",
    expiresAt: "2026-11-12T00:00:00Z",
  }) as unknown as PeerInvitation;

describe("the list of people", () => {
  const rows = peopleRows({
    members,
    invitations: [
      invitation("jana@acme.dev", "pending", ["formbricks"]),
      invitation("bob@acme.dev", "accepted", ["formbricks"]),
      invitation("old@acme.dev", "revoked", []),
    ],
    projectName: name,
    now: NOW,
  });

  it("holds everyone once, an invitation as a state of its person", () => {
    expect(rows.map((row) => [row.email, row.summary, row.stateLabel])).toEqual([
      ["ana@acme.dev", "Owner · All projects", "Active"],
      ["bob@acme.dev", "Member · Formbricks", "Active"],
      ["cyril@acme.dev", "Member · No project yet", "Active"],
      ["jana@acme.dev", "Invited · Formbricks", "Pending"],
      ["dan@acme.dev", "No access", "Removed"],
    ]);
  });

  it("filters by state and by what a person's row says", () => {
    expect(filterPeople(rows, "", "invited").map((row) => row.email)).toEqual(["jana@acme.dev"]);
    expect(filterPeople(rows, "no project", "all").map((row) => row.email)).toEqual([
      "cyril@acme.dev",
    ]);
  });

  it("marks a person with two letters", () => {
    expect(initials("Jana Nováková", "j@x.dev")).toBe("JN");
    expect(initials(null, "slavosmn@gmail.com")).toBe("SL");
  });
});

describe("project access", () => {
  it("is every project without a list, and never that for an empty one", () => {
    expect(accessText(null, name)).toBe("All projects");
    expect(accessText([], name)).toBe("No project yet");
    expect(accessText(["formbricks", "gone"], name)).toBe("Formbricks, gone");
    expect(limitOf(accessOf(null))).toBeNull();
    expect(limitOf(accessOf([]))).toEqual([]);
  });
});
