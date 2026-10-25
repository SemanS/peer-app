/**
 * The one settings navigation (design artboard 3d): the Overview on top, then Workspace (named),
 * Projects, Me, This computer and App, with the pages the person may open and nothing else. Peer's
 * pages and the app's own sit in one list; where a page lives is what the person asks, not which
 * product made it. Pure, so who sees what is a function of the role, the plugins and the address.
 *
 * - A member gets no admin page (Shared capacity, Secrets, Integrations, Audit log).
 * - A plugin turned off takes its pages with it; Integrations goes when Slack, GitHub's checks and
 *   webhooks are all off.
 * - App is folded behind its count unless a page of it is open.
 * - A mark beside a page (a dot, "2 detected") says something there is left to do, as the Overview
 *   counts it.
 */
import type { OverviewGroup } from "./overview.logic";
import { toFinishLabel, overviewSummary } from "./overview.logic";
import { SETTINGS_SECTION_LABELS, settingsPagePath, type SettingsPath } from "./settingsSearch";
import {
  COMPUTER_SECTION_LABELS,
  COMPUTER_SECTIONS,
  DEFAULT_PROJECT_TAB,
  ME_NAV_SECTIONS,
  WORKSPACE_NAV_SECTIONS,
  WORKSPACE_SECTION_LABELS,
  isPluginHidden,
  parsePeerSettingsPath,
  sectionInNav,
  type ComputerSection,
  type PeerNavWorkspace,
  type PeerSettingsLocation,
  type PluginStatus,
  type WorkspaceSection,
} from "../workspaces/settings/peerSettings.logic";

export type SettingsNavGroupId = "workspace" | "projects" | "me" | "computer" | "app";

/** Where a row of the navigation goes: a page of Peer's area, or a page of the app's settings. */
export type SettingsNavTarget =
  | { readonly kind: "peer"; readonly location: PeerSettingsLocation }
  | { readonly kind: "settings"; readonly to: SettingsPath };

export interface SettingsNavItem {
  /** `workspace:integrations`, `project:booking`, `computer:tool-trust`, `settings:/settings/general`. */
  readonly id: string;
  readonly label: string;
  readonly target: SettingsNavTarget;
  /** It is the page being shown; a project's row stays on for all its tabs. */
  readonly current: boolean;
  /** A project's row: its mark, and whether the person leads it. */
  readonly project?: { readonly id: string; readonly name: string; readonly lead: boolean };
  /** A quiet row: "+ New project". */
  readonly quiet?: boolean;
  /** Something there is left to finish here. */
  readonly dot?: boolean | undefined;
  /** A few words beside the label: "2 detected". */
  readonly tag?: string | undefined;
}

export interface SettingsNavGroup {
  readonly id: SettingsNavGroupId;
  readonly label: string;
  /** Beside the label, in quiet type: the workspace's name. */
  readonly who?: string;
  readonly items: ReadonlyArray<SettingsNavItem>;
  /** Folded behind its count until the person opens it; only App, and only while none of its pages is open. */
  readonly folded: boolean;
}

export interface SettingsNav {
  /** The Overview, on top of the groups, with "N to finish" when there is. */
  readonly overview: SettingsNavItem & { readonly badge: string | null };
  readonly groups: ReadonlyArray<SettingsNavGroup>;
}

/** What the navigation marks, from the Overview: pages with something to finish and what to say. */
export interface NavMarks {
  /** "1 to finish" beside the Overview; null when nothing is. */
  readonly toFinish: string | null;
  /** The pages with a setup under way or a connection that broke, by item id. */
  readonly dots: ReadonlySet<string>;
  /** A few words beside a page, by item id: "2 detected". */
  readonly tags: ReadonlyMap<string, string>;
}

export const NO_MARKS: NavMarks = { toFinish: null, dots: new Set(), tags: new Map() };

/** The page of the navigation each Overview row is about. */
function navItemOfRow(rowId: string): string | undefined {
  if (rowId === "workspace:hub") return "workspace:hub";
  if (rowId === "workspace:capacity") return "workspace:capacity";
  if (
    rowId === "workspace:slack" ||
    rowId === "workspace:webhooks" ||
    rowId === "workspace:github"
  ) {
    return "workspace:integrations";
  }
  if (rowId === "me:slack") return "workspace:slack";
  if (rowId === "me:plans") return "workspace:plans";
  if (rowId === "computer:slack-plugin") return "computer:coordination";
  if (rowId === "computer:browser" || rowId === "computer:device-hub") {
    return "settings:/settings/integrations";
  }
  if (rowId.startsWith("computer:provider:")) return "settings:/settings/providers";
  if (rowId.startsWith("computer:source-control")) return "settings:/settings/source-control";
  return undefined;
}

/**
 * What the Overview asks the navigation to mark: a dot where a setup is under way or a connection
 * broke, "2 detected" beside AI subscriptions when plans wait to be added, and the Overview's own
 * "N to finish".
 */
export function navMarks(groups: ReadonlyArray<OverviewGroup>): NavMarks {
  const dots = new Set<string>();
  const tags = new Map<string, string>();
  for (const row of groups.flatMap((group) => group.rows)) {
    const item = navItemOfRow(row.id);
    if (item === undefined) continue;
    if (row.underway) dots.add(item);
    if (row.id === "me:plans" && row.badge !== null && !row.underway) tags.set(item, row.badge);
  }
  return { toFinish: toFinishLabel(overviewSummary(groups)), dots, tags };
}

export interface SettingsNavInput {
  readonly pathname: string;
  /** The workspace the navigation shows; null with none. */
  readonly workspace: PeerNavWorkspace | null;
  /** Peer's status is known and nobody is signed in (true), someone is (false); unknown if absent. */
  readonly signedOut?: boolean | undefined;
  /** The plugins this computer lists, which decide what is left out. */
  readonly status?: PluginStatus | undefined;
  /** A project is chosen, so the app's Project page has one to show. */
  readonly projectPage: boolean;
  readonly marks?: NavMarks | undefined;
}

/** A page of the app's settings is on while the address is it or below it; its detail pages belong to General. */
function staticCurrent(to: SettingsPath, pathname: string): boolean {
  const here = pathname.replace(/\/+$/, "");
  if (to === "/settings/general") {
    return (
      here === to || here === "/settings/open-source-licenses" || here === "/settings/diagnostics"
    );
  }
  return here === to || here.startsWith(`${to}/`);
}

/** Whether a page of Peer's area is the one `current` names; a project's row stays on for its tabs. */
export function peerLocationCurrent(
  target: PeerSettingsLocation,
  current: PeerSettingsLocation | null,
): boolean {
  if (current === null) return false;
  switch (target.kind) {
    case "workspace":
      return (
        current.kind === "workspace" &&
        current.workspace === target.workspace &&
        current.section === target.section
      );
    case "project":
      return (
        current.kind === "project" &&
        current.workspace === target.workspace &&
        current.projectId === target.projectId
      );
    case "computer":
      return current.kind === "computer" && current.section === target.section;
  }
}

/** The app's own pages of This computer, after Peer's two, in the design's order. */
export const COMPUTER_PAGES = [
  "/settings/providers",
  "/settings/source-control",
  "/settings/integrations",
  "/settings/scheduled-tasks",
] as const satisfies ReadonlyArray<SettingsPath>;

/** The pages of App, in the design's order. */
export const APP_PAGES = [
  "/settings/general",
  "/settings/appearance",
  "/settings/keybindings",
  "/settings/snap-shot",
  "/settings/storage",
  "/settings/connections",
  "/settings/archived",
] as const satisfies ReadonlyArray<SettingsPath>;

/** The Workspace pages whose plugins decide whether they are listed (Integrations: any of three). */
const SECTION_PLUGINS: Readonly<Partial<Record<WorkspaceSection, ReadonlyArray<string>>>> = {
  capacity: ["capacity"],
  audit: ["audit"],
  integrations: ["slack", "github", "webhooks"],
  slack: ["slack"],
};

const COMPUTER_PLUGINS: Readonly<Partial<Record<ComputerSection, string>>> = {
  "tool-trust": "tool-trust",
};

/** Whether the plugins a page is for are all turned off (or not built), so it has nothing to show. */
function sectionHidden(section: WorkspaceSection, status: PluginStatus | undefined): boolean {
  const plugins = SECTION_PLUGINS[section];
  return plugins !== undefined && plugins.every((plugin) => isPluginHidden(status, plugin));
}

export function settingsNavGroups(input: SettingsNavInput): SettingsNav {
  const { pathname, workspace, status, marks = NO_MARKS } = input;
  const current = parsePeerSettingsPath(pathname);

  const peerItem = (
    id: string,
    label: string,
    location: PeerSettingsLocation,
    extra: Partial<SettingsNavItem> = {},
  ): SettingsNavItem => ({
    id,
    label,
    target: { kind: "peer", location },
    current: peerLocationCurrent(location, current),
    ...(marks.dots.has(id) ? { dot: true } : {}),
    ...(marks.tags.has(id) ? { tag: marks.tags.get(id) } : {}),
    ...extra,
  });
  const staticItem = (to: SettingsPath, extra: Partial<SettingsNavItem> = {}): SettingsNavItem => {
    const id = `settings:${to}`;
    return {
      id,
      label: SETTINGS_SECTION_LABELS[to],
      target: { kind: "settings", to },
      current: staticCurrent(to, pathname),
      ...(marks.dots.has(id) ? { dot: true } : {}),
      ...extra,
    };
  };
  const workspaceItem = (
    ws: PeerNavWorkspace,
    section: WorkspaceSection,
    extra: Partial<SettingsNavItem> = {},
  ) =>
    peerItem(
      `workspace:${section}`,
      WORKSPACE_SECTION_LABELS[section],
      { kind: "workspace", workspace: ws.slug, section },
      extra,
    );

  const groups: SettingsNavGroup[] = [];
  const shown = (section: WorkspaceSection, ws: PeerNavWorkspace) =>
    sectionInNav(section, ws.role) && !sectionHidden(section, status);

  if (workspace !== null) {
    groups.push({
      id: "workspace",
      label: "Workspace",
      who: workspace.name,
      folded: false,
      items: WORKSPACE_NAV_SECTIONS.filter((section) => shown(section, workspace)).map((section) =>
        workspaceItem(workspace, section),
      ),
    });
    groups.push({
      id: "projects",
      label: "Projects",
      folded: false,
      items: [
        ...workspace.projects.map(({ project }) =>
          peerItem(
            `project:${project.id}`,
            project.name,
            {
              kind: "project",
              workspace: workspace.slug,
              projectId: project.id,
              tab: DEFAULT_PROJECT_TAB,
            },
            { project: { id: project.id, name: project.name, lead: project.role === "lead" } },
          ),
        ),
        workspaceItem(workspace, "new-project", { label: "+ New project", quiet: true }),
      ],
    });
    groups.push({
      id: "me",
      label: "Me",
      folded: false,
      items: ME_NAV_SECTIONS.filter((section) => shown(section, workspace)).map((section) =>
        workspaceItem(workspace, section),
      ),
    });
  } else if (input.signedOut !== undefined) {
    // Nobody is signed in, or no workspace was joined yet: the way in is the area's front door.
    groups.push({
      id: "workspace",
      label: "Workspace",
      folded: false,
      items: [
        {
          id: "settings:/settings/peer",
          label: input.signedOut ? "Peer Local & optional Hub" : "Join a workspace",
          target: { kind: "settings", to: "/settings/peer" },
          current: pathname.replace(/\/+$/, "") === "/settings/peer",
          quiet: true,
        },
      ],
    });
  }

  const peerComputer = workspace !== null || input.signedOut !== undefined;
  groups.push({
    id: "computer",
    label: "This computer",
    folded: false,
    items: [
      ...(input.projectPage ? [staticItem("/settings/projects")] : []),
      ...COMPUTER_SECTIONS.filter((section) => {
        const plugin = COMPUTER_PLUGINS[section];
        return peerComputer && (plugin === undefined || !isPluginHidden(status, plugin));
      }).map((section) =>
        peerItem(`computer:${section}`, COMPUTER_SECTION_LABELS[section], {
          kind: "computer",
          section,
        }),
      ),
      ...COMPUTER_PAGES.map((to) => staticItem(to)),
    ],
  });
  const app = APP_PAGES.map((to) => staticItem(to));
  groups.push({
    id: "app",
    label: "App",
    folded: !app.some((item) => item.current),
    items: app,
  });

  return {
    overview: {
      ...staticItem("/settings/overview"),
      badge: marks.toFinish,
    },
    groups,
  };
}

/** Settings pages that are not in the navigation but belong to one of its pages. */
const EXTRA_PAGES: Readonly<Record<string, string>> = {
  "/settings/diagnostics": "Diagnostics",
  "/settings/open-source-licenses": "Open source licenses",
};

/**
 * Where a page of the app's settings lives, as its breadcrumb writes it after "Settings":
 * ["This computer", "Providers"], ["App", "Appearance"], ["Overview"]. Null for an address that is
 * no settings page.
 */
export function settingsBreadcrumbPath(pathname: string): ReadonlyArray<string> | null {
  const here = pathname.replace(/\/+$/, "") || "/";
  if (here in SETTINGS_SECTION_LABELS) return settingsPagePath(here as SettingsPath);
  const extra = EXTRA_PAGES[here];
  return extra === undefined ? null : ["App", extra];
}
