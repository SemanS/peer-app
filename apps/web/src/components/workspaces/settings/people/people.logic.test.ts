import type { PeerInvitation, PeerTask, PeerWorkspaceMembers } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accessOf,
  accessText,
  filterPeople,
  initials,
  isGroupPicked,
  isPicked,
  limitOf,
  NO_WORK,
  peopleRows,
  pickAll,
  pickedCount,
  pickGroup,
  pickTask,
  workChanges,
  workGroups,
} from "./people.logic";

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
const task = (id: string, extra: Partial<PeerTask> = {}) =>
  ({ id, title: id, status: "open", ...extra }) as PeerTask;

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

describe("the work to tick", () => {
  const groups = workGroups({
    areas: ["Auth", "Empty"],
    tasks: [
      task("auth", { kind: "group", title: "Authentication" } as Partial<PeerTask>),
      task("login", { parent: "auth" }),
      task("session", { parent: "auth" }),
      task("drag", { area: "Auth" }),
      task("loose"),
      task("gone", { status: "done" }),
    ],
  });
  const of = (id: string) => groups.find((group) => group.id === id)!;

  it("groups tasks under their parent, then their area, and leaves out what is done", () => {
    expect(groups.map((group) => [group.title, group.tasks.map((entry) => entry.id)])).toEqual([
      ["Authentication", ["login", "session"]],
      ["Auth", ["drag"]],
      ["Empty", []],
      ["Other tasks", ["loose"]],
    ]);
  });

  it("hands over a whole area as the area and any other group as its tasks", () => {
    expect(pickGroup(NO_WORK, of("area:Auth"), true)).toEqual({ areas: ["Auth"], tasks: [] });
    expect(pickGroup(NO_WORK, of("group:auth"), true)).toEqual({
      areas: [],
      tasks: ["login", "session"],
    });
  });

  it("keeps the rest of an area when one of its tasks is unticked", () => {
    const whole = { areas: ["Auth"], tasks: [] };
    const group = {
      ...of("area:Auth"),
      tasks: [...of("area:Auth").tasks, { id: "b", title: "b" }],
    };
    expect(isPicked(whole, group, "drag")).toBe(true);
    expect(pickTask(whole, group, "drag", false)).toEqual({ areas: [], tasks: ["b"] });
  });

  it("counts what is ticked", () => {
    const pick = pickGroup(NO_WORK, of("group:auth"), true);
    expect(pickedCount(pick, groups)).toBe("2 of 4 tasks selected");
    expect(isGroupPicked(pick, of("group:auth"))).toBe(true);
    expect(pickedCount(pickAll(groups), groups)).toBe("4 of 4 tasks selected");
  });

  it("asks only for what changed, and keeps other people's areas", () => {
    expect(
      workChanges({
        email: "bob@acme.dev",
        before: { areas: ["Old"], tasks: ["a", "b"] },
        after: { areas: ["New"], tasks: ["b", "c"] },
        areaOwners: { Old: "bob@acme.dev", Other: "ana@acme.dev" },
      }),
    ).toEqual({
      give: ["c"],
      takeBack: ["a"],
      areas: { Other: "ana@acme.dev", New: "bob@acme.dev" },
    });
  });
});
