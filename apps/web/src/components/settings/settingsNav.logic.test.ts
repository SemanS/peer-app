import { describe, expect, it } from "vite-plus/test";

import type { OverviewGroup, OverviewRow } from "./overview.logic";
import {
  APP_PAGES,
  COMPUTER_PAGES,
  NO_MARKS,
  navMarks,
  peerLocationCurrent,
  settingsBreadcrumbPath,
  settingsNavGroups,
  type SettingsNavInput,
} from "./settingsNav.logic";
import { SETTINGS_PAGE_GROUPS } from "./settingsSearch";
import type { PeerNavWorkspace } from "../workspaces/settings/peerSettings.logic";

const acme = (role: PeerNavWorkspace["role"]): PeerNavWorkspace => ({
  slug: "acme",
  name: "Acme",
  role,
  projects: [
    { project: { id: "booking", name: "Booking", role: "lead" } },
    { project: { id: "peer-hub", name: "Peer Hub", role: "member" } },
  ],
});

const plugin = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...extra,
});
const PLUGINS = ["slack", "github", "webhooks", "capacity", "audit", "tool-trust"].map((id) =>
  plugin(id),
);
const off = (...ids: string[]) =>
  PLUGINS.map((entry) =>
    ids.includes(entry.id) ? { ...entry, enabled: false, active: false, reason: "off" } : entry,
  );

const nav = (extra: Partial<SettingsNavInput> = {}) =>
  settingsNavGroups({
    pathname: "/settings/overview",
    workspace: acme("admin"),
    status: { plugins: PLUGINS, signedIn: true },
    projectPage: false,
    ...extra,
  });

const labels = (
  groupId: "workspace" | "projects" | "me" | "computer" | "app",
  extra: Partial<SettingsNavInput> = {},
) =>
  nav(extra)
    .groups.find((group) => group.id === groupId)
    ?.items.map((item) => item.label);

describe("the one settings navigation", () => {
  it("lists Overview, then Workspace, Projects, Me, This computer and App, in the design's order", () => {
    const { overview, groups } = nav();
    expect(overview.label).toBe("Overview");
    expect(groups.map((group) => [group.id, group.label, group.who])).toEqual([
      ["workspace", "Workspace", "Acme"],
      ["projects", "Projects", undefined],
      ["me", "Me", undefined],
      ["computer", "This computer", undefined],
      ["app", "App", undefined],
    ]);
  });

  it("gives an admin every Workspace page, then the person's projects with New project", () => {
    expect(labels("workspace")).toEqual([
      "General",
      "People",
      "Shared capacity",
      "Tools",
      "Secrets",
      "Integrations",
      "Audit log",
      "Hub",
    ]);
    expect(labels("workspace", { workspace: acme("owner") })).toEqual(labels("workspace"));
    expect(labels("projects")).toEqual(["Booking", "Peer Hub", "+ New project"]);
  });

  it("puts Peer's pages and the app's own together under This computer and App", () => {
    expect(labels("me")).toEqual(["AI subscriptions", "Keys", "Slack"]);
    expect(labels("computer")).toEqual([
      "Coordination & plugins",
      "Tool trust",
      "Providers",
      "Source control",
      "Browser & devices",
      "Scheduled tasks",
    ]);
    expect(labels("app")).toEqual([
      "General",
      "Appearance",
      "Keyboard shortcuts",
      "Snapshots",
      "Storage",
      "Connections",
      "Archived chats",
    ]);
  });

  it("lists every page of the app's settings once, so none is reachable only by search", () => {
    const listed = [...COMPUTER_PAGES, ...APP_PAGES];
    expect(new Set(listed).size).toBe(listed.length);
    const grouped = (Object.keys(SETTINGS_PAGE_GROUPS) as Array<keyof typeof SETTINGS_PAGE_GROUPS>)
      .filter((to) => ["computer", "app"].includes(SETTINGS_PAGE_GROUPS[to]))
      // The Project page is listed while a project is chosen, and Diagnostics is opened from
      // the places that link to it (the sidebar's utility menu), not from this navigation.
      .filter((to) => to !== "/settings/projects" && to !== "/settings/diagnostics");
    expect([...listed].toSorted()).toEqual([...grouped].toSorted());
  });
});

describe("who sees which page", () => {
  it("leaves a member the Workspace pages that are theirs to read, and none of the admin ones", () => {
    expect(labels("workspace", { workspace: acme("member") })).toEqual([
      "General",
      "People",
      "Tools",
      "Hub",
    ]);
    // Their projects, keys and Slack are theirs whatever their role.
    for (const role of ["owner", "admin", "member"] as const) {
      expect(labels("projects", { workspace: acme(role) })).toEqual([
        "Booking",
        "Peer Hub",
        "+ New project",
      ]);
      expect(labels("me", { workspace: acme(role) })).toEqual([
        "AI subscriptions",
        "Keys",
        "Slack",
      ]);
    }
  });

  it("takes the pages of a plugin that is turned off, and keeps Integrations while one of its three is on", () => {
    const status = (...ids: string[]) => ({ plugins: off(...ids), signedIn: true });
    expect(labels("me", { status: status("slack") })).toEqual(["AI subscriptions", "Keys"]);
    expect(labels("workspace", { status: status("capacity", "audit") })).toEqual([
      "General",
      "People",
      "Tools",
      "Secrets",
      "Integrations",
      "Hub",
    ]);
    expect(labels("computer", { status: status("tool-trust") })).not.toContain("Tool trust");
    expect(labels("workspace", { status: status("slack", "github") })).toContain("Integrations");
    expect(labels("workspace", { status: status("slack", "github", "webhooks") })).not.toContain(
      "Integrations",
    );
  });

  it("keeps a page whose plugin waits for a newer Hub, since the page says so", () => {
    const waiting = PLUGINS.map((entry) =>
      entry.id === "slack" ? { ...entry, active: false, reason: "hub" } : entry,
    );
    expect(labels("me", { status: { plugins: waiting, signedIn: true } })).toContain("Slack");
  });

  it("lists everything, plugins included, when no status is known", () => {
    expect(labels("computer", { status: undefined })).toContain("Tool trust");
    expect(labels("me", { status: undefined })).toContain("Slack");
  });

  it("shows the app's Project page under This computer only while a project is chosen", () => {
    expect(labels("computer")).not.toContain("Project");
    expect(labels("computer", { projectPage: true })?.[0]).toBe("Project");
  });
});

describe("with no workspace", () => {
  it("offers signing in when nobody is, and joining a workspace when someone is and has none", () => {
    for (const [signedOut, label] of [
      [true, "Sign in to a Peer Hub"],
      [false, "Join a workspace"],
    ] as const) {
      const groups = nav({ workspace: null, signedOut }).groups;
      expect(groups.map((group) => group.id)).toEqual(["workspace", "computer", "app"]);
      expect(groups[0]?.items).toMatchObject([
        { label, target: { kind: "settings", to: "/settings/peer" } },
      ]);
    }
  });

  it("offers Peer's pages of this computer only to someone signed in, whatever the app's own are", () => {
    const computer = (signedOut: boolean | undefined) =>
      nav({ workspace: null, signedOut }).groups.find((group) => group.id === "computer")?.items;
    expect(computer(false)?.map((item) => item.label)).toEqual([
      "Coordination & plugins",
      "Tool trust",
      "Providers",
      "Source control",
      "Browser & devices",
      "Scheduled tasks",
    ]);
    for (const signedOut of [true, undefined]) {
      expect(computer(signedOut)?.map((item) => item.label)).toEqual([
        "Providers",
        "Source control",
        "Browser & devices",
        "Scheduled tasks",
      ]);
    }
  });

  it("is only This computer and App while it is not known whether anyone is signed in", () => {
    expect(nav({ workspace: null }).groups.map((group) => group.id)).toEqual(["computer", "app"]);
  });
});

describe("the page being shown", () => {
  const current = (pathname: string, extra: Partial<SettingsNavInput> = {}) =>
    nav({ pathname, ...extra })
      .groups.flatMap((group) => group.items)
      .filter((item) => item.current)
      .map((item) => item.id);

  it("marks the Overview, a workspace section, a project (across its tabs) and a computer page", () => {
    expect(nav().overview.current).toBe(true);
    expect(nav({ pathname: "/settings/peer/w/acme/people" }).overview.current).toBe(false);
    expect(current("/settings/peer/w/acme/people")).toEqual(["workspace:people"]);
    expect(current("/settings/peer/w/acme/project/booking/coordination")).toEqual([
      "project:booking",
    ]);
    expect(current("/settings/peer/w/acme/new-project")).toEqual(["workspace:new-project"]);
    expect(current("/settings/peer/computer/tool-trust")).toEqual(["computer:tool-trust"]);
    expect(current("/settings/providers")).toEqual(["settings:/settings/providers"]);
  });

  it("keeps General on for the pages that belong to it", () => {
    expect(current("/settings/open-source-licenses")).toEqual(["settings:/settings/general"]);
    expect(current("/settings/diagnostics")).toEqual(["settings:/settings/general"]);
  });

  it("does not mark a project row for another workspace's project", () => {
    expect(current("/settings/peer/w/other/project/booking/basics")).toEqual([]);
    expect(
      peerLocationCurrent(
        { kind: "project", workspace: "acme", projectId: "booking", tab: "basics" },
        { kind: "project", workspace: "acme", projectId: "peer-hub", tab: "basics" },
      ),
    ).toBe(false);
  });
});

describe("App, folded unless open", () => {
  const app = (pathname: string) => nav({ pathname }).groups.find((group) => group.id === "app");

  it("is folded behind its seven pages while another page is open", () => {
    expect(app("/settings/overview")?.folded).toBe(true);
    expect(app("/settings/peer/w/acme/general")?.folded).toBe(true);
    expect(app("/settings/providers")?.folded).toBe(true);
    expect(app("/settings/overview")?.items).toHaveLength(7);
  });

  it("is open when one of its pages is", () => {
    expect(app("/settings/appearance")?.folded).toBe(false);
    expect(app("/settings/open-source-licenses")?.folded).toBe(false);
  });

  it("never folds the other groups", () => {
    expect(
      nav()
        .groups.filter((group) => group.id !== "app")
        .every((group) => !group.folded),
    ).toBe(true);
  });
});

describe("what the navigation marks", () => {
  const row = (extra: Partial<OverviewRow> & Pick<OverviewRow, "id">): OverviewRow => ({
    group: "workspace",
    name: extra.id,
    subject: extra.id,
    connection: { state: "connected" },
    account: null,
    action: null,
    consequence: null,
    attention: false,
    underway: false,
    badge: null,
    ...extra,
  });
  const groups: ReadonlyArray<OverviewGroup> = [
    {
      id: "workspace",
      title: "Workspace",
      who: "Acme",
      rows: [
        row({
          id: "workspace:slack",
          attention: true,
          underway: true,
          badge: "Needs setup",
          connection: {
            state: "setup",
            step: { n: 3, of: 4, title: "verify the stored token with Slack" },
          },
        }),
      ],
    },
    {
      id: "me",
      title: "Me",
      who: "",
      rows: [row({ id: "me:plans", group: "me", attention: true, badge: "2 detected" })],
    },
  ];

  it("puts a dot on Integrations while Slack is at a step, and '2 detected' beside AI subscriptions", () => {
    const marks = navMarks(groups);
    expect(marks.toFinish).toBe("1 to finish");
    expect([...marks.dots]).toEqual(["workspace:integrations"]);
    expect([...marks.tags]).toEqual([["workspace:plans", "2 detected"]]);
    const built = nav({ marks });
    expect(built.overview.badge).toBe("1 to finish");
    const integrations = built.groups[0]?.items.find((item) => item.label === "Integrations");
    expect(integrations).toMatchObject({ dot: true });
    const plans = built.groups.find((group) => group.id === "me")?.items[0];
    expect(plans).toMatchObject({ label: "AI subscriptions", tag: "2 detected" });
  });

  it("marks nothing when nothing is to finish", () => {
    expect(navMarks([])).toEqual({ ...NO_MARKS, toFinish: null });
    const built = nav();
    expect(built.overview.badge).toBeNull();
    expect(built.groups.flatMap((group) => group.items).some((item) => item.dot)).toBe(false);
  });
});

describe("the breadcrumb of a page", () => {
  it("names the group the navigation lists the page under", () => {
    expect(settingsBreadcrumbPath("/settings/overview")).toEqual(["Overview"]);
    expect(settingsBreadcrumbPath("/settings/providers")).toEqual(["This computer", "Providers"]);
    expect(settingsBreadcrumbPath("/settings/appearance/")).toEqual(["App", "Appearance"]);
    expect(settingsBreadcrumbPath("/settings/open-source-licenses")).toEqual([
      "App",
      "Open source licenses",
    ]);
  });

  it("is nothing for an address that is no settings page", () => {
    expect(settingsBreadcrumbPath("/settings")).toBeNull();
    expect(settingsBreadcrumbPath("/settings/nonsense")).toBeNull();
  });
});
