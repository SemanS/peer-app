import { describe, expect, it } from "vite-plus/test";

import {
  COMPUTER_SECTIONS,
  COMPUTER_SECTION_LABELS,
  PROJECT_TABS,
  PROJECT_TAB_LABELS,
  WORKSPACE_SECTIONS,
  WORKSPACE_SECTION_LABELS,
  canEditProject,
  currentNavWorkspace,
  isComputerSection,
  isPeerNavItemCurrent,
  isPeerSettingsPath,
  isProjectTab,
  isWorkspaceSection,
  parsePeerSettingsPath,
  peerNavGroups,
  peerSettingsPageTitle,
  projectRoleBadge,
  selectPeerEnvironment,
  slotHost,
  workspaceRoleBadge,
  workspaceSwitchTarget,
  type PeerNavWorkspace,
  type PeerSettingsLocation,
} from "./peerSettings.logic";

const acme = (role: PeerNavWorkspace["role"]): PeerNavWorkspace => ({
  slug: "acme",
  name: "Acme",
  role,
  projects: [
    { project: { id: "booking", name: "Booking", role: "lead" } },
    { project: { id: "peer-hub", name: "Peer Hub", role: "member" } },
  ],
});

const labels = (
  role: PeerNavWorkspace["role"],
  group: "workspace" | "projects" | "me" | "computer",
) =>
  peerNavGroups(acme(role))
    .find((candidate) => candidate.id === group)
    ?.items.map((item) => item.label);

describe("the area's addresses", () => {
  it("belongs to /settings/peer and what is under it, nothing that only starts like it", () => {
    expect(isPeerSettingsPath("/settings/peer")).toBe(true);
    expect(isPeerSettingsPath("/settings/peer/w/acme/general")).toBe(true);
    expect(isPeerSettingsPath("/settings/peers")).toBe(false);
    expect(isPeerSettingsPath("/settings/workspaces")).toBe(false);
    expect(isPeerSettingsPath("/settings/general")).toBe(false);
  });

  it.each<[string, PeerSettingsLocation | null]>([
    ["/settings/peer", null],
    ["/settings/peer/w/acme/people", { kind: "workspace", workspace: "acme", section: "people" }],
    ["/settings/peer/w/acme/keys/", { kind: "workspace", workspace: "acme", section: "keys" }],
    [
      "/settings/peer/w/acme/project/booking/repositories",
      { kind: "project", workspace: "acme", projectId: "booking", tab: "repositories" },
    ],
    [
      "/settings/peer/w/acme%20co/project/a%2Fb/basics",
      { kind: "project", workspace: "acme co", projectId: "a/b", tab: "basics" },
    ],
    ["/settings/peer/computer/tool-trust", { kind: "computer", section: "tool-trust" }],
    ["/settings/peer/w/acme", null],
    ["/settings/peer/w/acme/nonsense", null],
    ["/settings/peer/w/acme/project/booking", null],
    ["/settings/peer/w/acme/project/booking/nonsense", null],
    ["/settings/peer/computer", null],
    ["/settings/peer/computer/nonsense", null],
    ["/settings/peer/w/%E0%A4%A/general", null],
    ["/settings/general", null],
  ])("reads %s as the page it names", (pathname, location) => {
    expect(parsePeerSettingsPath(pathname)).toEqual(location);
  });

  it("names every section and tab once, and only valid ones pass the guards", () => {
    expect(Object.keys(WORKSPACE_SECTION_LABELS).toSorted()).toEqual(
      [...WORKSPACE_SECTIONS].toSorted(),
    );
    expect(Object.keys(PROJECT_TAB_LABELS).toSorted()).toEqual([...PROJECT_TABS].toSorted());
    expect(Object.keys(COMPUTER_SECTION_LABELS).toSorted()).toEqual(
      [...COMPUTER_SECTIONS].toSorted(),
    );
    expect(isWorkspaceSection("integrations")).toBe(true);
    expect(isWorkspaceSection("project")).toBe(false);
    expect(isProjectTab("history")).toBe(true);
    expect(isProjectTab("plans")).toBe(false);
    expect(isComputerSection("tool-trust")).toBe(true);
    expect(isComputerSection("general")).toBe(false);
  });
});

describe("the navigation", () => {
  it("gives an admin every workspace page, in order", () => {
    expect(labels("admin", "workspace")).toEqual([
      "General",
      "People",
      "Shared capacity",
      "Tools",
      "Secrets",
      "Integrations",
      "Audit log",
      "Hub",
    ]);
    expect(labels("owner", "workspace")).toEqual(labels("admin", "workspace"));
  });

  it("leaves a member the pages that are theirs to read, and none of the admin ones", () => {
    expect(labels("member", "workspace")).toEqual(["General", "People", "Tools", "Hub"]);
  });

  it("lists the person's projects, then New project, whatever their role", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(labels(role, "projects")).toEqual(["Booking", "Peer Hub", "+ New project"]);
      expect(labels(role, "me")).toEqual(["AI subscriptions", "Keys", "Slack"]);
      expect(labels(role, "computer")).toEqual(["Coordination & plugins", "Tool trust"]);
    }
  });

  it("marks the projects the person leads and opens each on its Basics tab", () => {
    const projects = peerNavGroups(acme("member")).find((group) => group.id === "projects");
    expect(projects?.items.map((item) => item.project)).toEqual([
      { id: "booking", name: "Booking", lead: true },
      { id: "peer-hub", name: "Peer Hub", lead: false },
      undefined,
    ]);
    expect(projects?.items[0]?.location).toEqual({
      kind: "project",
      workspace: "acme",
      projectId: "booking",
      tab: "basics",
    });
  });

  it("names the workspace beside its group, and shows only this computer without one", () => {
    expect(peerNavGroups(acme("member"))[0]).toMatchObject({ label: "Workspace", who: "Acme" });
    expect(peerNavGroups(null).map((group) => group.id)).toEqual(["computer"]);
  });

  it("keeps a project's row on across its tabs, and a section's row on its own page only", () => {
    const [workspaceGroup, projectsGroup] = peerNavGroups(acme("admin"));
    const people = workspaceGroup!.items[1]!;
    const booking = projectsGroup!.items[0]!;
    const onTab: PeerSettingsLocation = {
      kind: "project",
      workspace: "acme",
      projectId: "booking",
      tab: "coordination",
    };
    expect(isPeerNavItemCurrent(booking, onTab)).toBe(true);
    expect(isPeerNavItemCurrent(booking, { ...onTab, projectId: "peer-hub" })).toBe(false);
    expect(isPeerNavItemCurrent(booking, { ...onTab, workspace: "other" })).toBe(false);
    expect(
      isPeerNavItemCurrent(people, { kind: "workspace", workspace: "acme", section: "people" }),
    ).toBe(true);
    expect(
      isPeerNavItemCurrent(people, { kind: "workspace", workspace: "acme", section: "keys" }),
    ).toBe(false);
    expect(isPeerNavItemCurrent(people, null)).toBe(false);
  });
});

describe("which workspace the navigation shows", () => {
  const workspaces = [{ slug: "acme" }, { slug: "beta" }];
  const onBeta: PeerSettingsLocation = { kind: "workspace", workspace: "beta", section: "people" };
  const onComputer: PeerSettingsLocation = { kind: "computer", section: "coordination" };

  it("follows the page, else the one used last, else the first", () => {
    expect(currentNavWorkspace(workspaces, onBeta, "acme")?.slug).toBe("beta");
    expect(currentNavWorkspace(workspaces, onComputer, "beta")?.slug).toBe("beta");
    expect(currentNavWorkspace(workspaces, null, null)?.slug).toBe("acme");
  });

  it("ignores a workspace the person is no longer in", () => {
    expect(currentNavWorkspace(workspaces, onComputer, "gone")?.slug).toBe("acme");
    expect(currentNavWorkspace(workspaces, { ...onBeta, workspace: "gone" }, "beta")?.slug).toBe(
      "acme",
    );
    expect(currentNavWorkspace([], onBeta, "beta")).toBeNull();
  });

  it("keeps the section when switching, unless the other role has no link to it", () => {
    const audit: PeerSettingsLocation = { kind: "workspace", workspace: "acme", section: "audit" };
    expect(workspaceSwitchTarget(audit, { slug: "beta", role: "admin" })).toEqual({
      kind: "workspace",
      workspace: "beta",
      section: "audit",
    });
    expect(workspaceSwitchTarget(audit, { slug: "beta", role: "member" })).toEqual({
      kind: "workspace",
      workspace: "beta",
      section: "general",
    });
    expect(
      workspaceSwitchTarget(
        { kind: "workspace", workspace: "acme", section: "people" },
        { slug: "beta", role: "member" },
      ),
    ).toEqual({ kind: "workspace", workspace: "beta", section: "people" });
  });

  it("opens General when the person was on a project, this computer, or nothing", () => {
    for (const current of [
      null,
      onComputer,
      { kind: "project", workspace: "acme", projectId: "booking", tab: "tools" },
      { kind: "workspace", workspace: "acme", section: "new-project" },
    ] satisfies Array<PeerSettingsLocation | null>) {
      expect(workspaceSwitchTarget(current, { slug: "beta", role: "owner" })).toEqual({
        kind: "workspace",
        workspace: "beta",
        section: "general",
      });
    }
  });
});

describe("the breadcrumb's page", () => {
  it("is the section's label, or the project's name from the workspace", () => {
    const workspaces = [acme("member")];
    expect(
      peerSettingsPageTitle(
        { kind: "workspace", workspace: "acme", section: "capacity" },
        workspaces,
      ),
    ).toBe("Shared capacity");
    expect(peerSettingsPageTitle({ kind: "computer", section: "tool-trust" }, workspaces)).toBe(
      "Tool trust",
    );
    expect(
      peerSettingsPageTitle(
        { kind: "project", workspace: "acme", projectId: "peer-hub", tab: "people" },
        workspaces,
      ),
    ).toBe("Peer Hub");
    expect(
      peerSettingsPageTitle(
        { kind: "project", workspace: "acme", projectId: "unlisted", tab: "people" },
        workspaces,
      ),
    ).toBe("unlisted");
    expect(peerSettingsPageTitle(null, workspaces)).toBeNull();
  });
});

describe("what the person is told of their part", () => {
  it("tells a lead first, then an admin, and a member that the page is read only", () => {
    expect(projectRoleBadge("member", "lead")).toEqual({ label: "You’re a lead", tone: "lead" });
    expect(projectRoleBadge("owner", "lead").label).toBe("You’re a lead");
    expect(projectRoleBadge("admin", "member")).toEqual({
      label: "You’re an admin",
      tone: "admin",
    });
    expect(projectRoleBadge("owner", "member").label).toBe("You’re an admin");
    expect(projectRoleBadge("member", "member")).toEqual({
      label: "Member · read only",
      tone: "member",
    });
  });

  it("lets leads and admins edit a project, and no one else", () => {
    expect(canEditProject("member", "lead")).toBe(true);
    expect(canEditProject("admin", "member")).toBe(true);
    expect(canEditProject("owner", "member")).toBe(true);
    expect(canEditProject("member", "member")).toBe(false);
  });

  it("names an owner an owner, and treats admins and members as the project header does", () => {
    expect(workspaceRoleBadge("owner").label).toBe("You’re an owner");
    expect(workspaceRoleBadge("admin").label).toBe("You’re an admin");
    expect(workspaceRoleBadge("member").label).toBe("Member · read only");
  });
});

describe("which environment the area shows", () => {
  const environment = (id: string, connected: boolean) => ({
    environmentId: id,
    connection: { phase: connected ? "connected" : "disconnected" },
    serverConfig: connected ? {} : null,
  });
  const here = environment("here", true);
  const there = environment("there", true);
  const away = environment("away", false);

  it("takes the one the address names, even while it is not connected", () => {
    expect(selectPeerEnvironment([here, there, away], "here", "away")).toBe(away);
    expect(selectPeerEnvironment([here, there, away], "here", "there")).toBe(there);
  });

  it("otherwise prefers the primary one while connected, then any connected one", () => {
    expect(selectPeerEnvironment([there, here], "here", undefined)).toBe(here);
    expect(selectPeerEnvironment([away, there], "away", undefined)).toBe(there);
  });

  it("ignores an address that names no environment, and falls back to one that is not connected", () => {
    expect(selectPeerEnvironment([here, there], "here", "stale")).toBe(here);
    expect(selectPeerEnvironment([away], "away", undefined)).toBe(away);
    expect(selectPeerEnvironment([away, environment("other", false)], null, undefined)).toBe(away);
    expect(selectPeerEnvironment([], null, undefined)).toBeNull();
  });
});

describe("where plugin settings are hosted", () => {
  it("puts the plugins a page is about on that page", () => {
    expect(slotHost("settings", "capacity")).toBe("capacity");
    expect(slotHost("settings", "tool-trust")).toBe("tool-trust");
    expect(slotHost("workspaceSettings", "audit")).toBe("audit");
    expect(slotHost("workspaceSettings", "github")).toBe("integrations");
    expect(slotHost("workspaceSettings", "metrics")).toBe("people");
    expect(slotHost("projectSettings", "capacity")).toBe("project-capacity");
  });

  it("leaves Slack and webhooks to the pages that render them for one workspace", () => {
    expect(slotHost("settings", "slack")).toBe("own");
    expect(slotHost("settings", "webhooks")).toBe("own");
  });

  it("sends every other slot to its kind's home, so no plugin's settings go missing", () => {
    expect(slotHost("settings", "herdr")).toBe("coordination");
    expect(slotHost("settings", "a-plugin-from-the-future")).toBe("coordination");
    expect(slotHost("alwaysSettings", "impact")).toBe("coordination");
    expect(slotHost("workspaceSettings", "a-plugin-from-the-future")).toBe("general");
    expect(slotHost("projectSettings", "announcements")).toBe("basics");
  });
});
