/**
 * Where Peer's settings area has pages, and who sees what in its navigation. The area lives under
 * `/settings/peer`:
 *
 * - `w/<workspace>/<section>`: a workspace's own pages, and the "Me" pages that are per workspace
 *   (`plans`, `keys`, `slack`), since a person's keys and Slack link belong to one workspace.
 * - `w/<workspace>/project/<id>/<tab>`: one project's pages.
 * - `computer/<section>`: this computer's pages.
 */
import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus, PeerWorkspaceRole } from "@t3tools/contracts";

export const PEER_SETTINGS_PATH = "/settings/peer";

/** The parts of the Integrations page that Settings › Overview and search send people to. */
export const INTEGRATION_ANCHORS = {
  slack: "integrations-slack",
  webhooks: "integrations-webhooks",
  github: "integrations-github",
} as const;

/** Whether `pathname` is the Peer settings area or one of its pages. */
export function isPeerSettingsPath(pathname: string): boolean {
  return pathname === PEER_SETTINGS_PATH || pathname.startsWith(`${PEER_SETTINGS_PATH}/`);
}

export const WORKSPACE_SECTIONS = [
  "general",
  "people",
  "capacity",
  "tools",
  "secrets",
  "integrations",
  "audit",
  "hub",
  "new-project",
  "plans",
  "keys",
  "slack",
] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const PROJECT_TABS = [
  "basics",
  "people",
  "tasks",
  "repositories",
  "tools",
  "capacity",
  "coordination",
  "history",
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export const COMPUTER_SECTIONS = ["coordination", "tool-trust"] as const;
export type ComputerSection = (typeof COMPUTER_SECTIONS)[number];

export const DEFAULT_WORKSPACE_SECTION: WorkspaceSection = "general";
export const DEFAULT_PROJECT_TAB: ProjectTab = "basics";
export const DEFAULT_COMPUTER_SECTION: ComputerSection = "coordination";

export const WORKSPACE_SECTION_LABELS: Readonly<Record<WorkspaceSection, string>> = {
  general: "General",
  people: "People",
  capacity: "Shared capacity",
  tools: "Tools",
  secrets: "Secrets",
  integrations: "Integrations",
  audit: "Audit log",
  hub: "Hub",
  "new-project": "New project",
  plans: "AI subscriptions",
  keys: "Keys",
  slack: "Slack",
};

export const PROJECT_TAB_LABELS: Readonly<Record<ProjectTab, string>> = {
  basics: "Basics",
  people: "People",
  tasks: "Tasks",
  repositories: "Repositories",
  tools: "Tools",
  capacity: "Capacity",
  coordination: "Coordination",
  history: "History",
};

export const COMPUTER_SECTION_LABELS: Readonly<Record<ComputerSection, string>> = {
  coordination: "Coordination & plugins",
  "tool-trust": "Tool trust",
};

const isOneOf = <T extends string>(values: ReadonlyArray<T>, value: string): value is T =>
  (values as ReadonlyArray<string>).includes(value);

export const isWorkspaceSection = (value: string): value is WorkspaceSection =>
  isOneOf(WORKSPACE_SECTIONS, value);
export const isProjectTab = (value: string): value is ProjectTab => isOneOf(PROJECT_TABS, value);
export const isComputerSection = (value: string): value is ComputerSection =>
  isOneOf(COMPUTER_SECTIONS, value);

/** One page of the area. */
export type PeerSettingsLocation =
  | {
      readonly kind: "workspace";
      readonly workspace: string;
      readonly section: WorkspaceSection;
    }
  | {
      readonly kind: "project";
      readonly workspace: string;
      readonly projectId: string;
      readonly tab: ProjectTab;
    }
  | { readonly kind: "computer"; readonly section: ComputerSection };

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The page an address names, or null for the area's front door and for addresses naming no page. */
export function parsePeerSettingsPath(pathname: string): PeerSettingsLocation | null {
  if (!isPeerSettingsPath(pathname)) return null;
  const segments = pathname
    .slice(PEER_SETTINGS_PATH.length)
    .split("/")
    .filter((segment) => segment !== "");
  if (segments[0] === "computer" && segments.length === 2) {
    const section = segments[1]!;
    return isComputerSection(section) ? { kind: "computer", section } : null;
  }
  if (segments[0] !== "w") return null;
  const workspace = decoded(segments[1] ?? "");
  if (workspace === null || workspace === "") return null;
  if (segments.length === 3) {
    const section = segments[2]!;
    return isWorkspaceSection(section) ? { kind: "workspace", workspace, section } : null;
  }
  if (segments.length === 5 && segments[2] === "project") {
    const projectId = decoded(segments[3]!);
    const tab = segments[4]!;
    return projectId !== null && projectId !== "" && isProjectTab(tab)
      ? { kind: "project", workspace, projectId, tab }
      : null;
  }
  return null;
}

/** The workspace a page belongs to; the computer's pages belong to none. */
export const locationWorkspace = (location: PeerSettingsLocation | null): string | null =>
  location === null || location.kind === "computer" ? null : location.workspace;

export const isWorkspaceAdmin = (role: PeerWorkspaceRole): boolean =>
  role === "owner" || role === "admin";

/**
 * The workspace pages only admins (and owners) have a use for. Members get no link to them, and
 * the page itself says who to ask when a member opens one anyway.
 */
const ADMIN_ONLY_SECTIONS: ReadonlySet<WorkspaceSection> = new Set([
  "capacity",
  "secrets",
  "integrations",
  "audit",
]);

const isAdminOnlySection = (section: WorkspaceSection): boolean => ADMIN_ONLY_SECTIONS.has(section);

/** The Workspace group of the navigation, in order. */
export const WORKSPACE_NAV_SECTIONS = [
  "general",
  "people",
  "capacity",
  "tools",
  "secrets",
  "integrations",
  "audit",
  "hub",
] as const satisfies ReadonlyArray<WorkspaceSection>;

/** The Me group: the person's own, whatever their role. */
export const ME_NAV_SECTIONS = [
  "plans",
  "keys",
  "slack",
] as const satisfies ReadonlyArray<WorkspaceSection>;

/** Whether a role gets a link to a workspace section in the navigation. */
export const sectionInNav = (section: WorkspaceSection, role: PeerWorkspaceRole): boolean =>
  !isAdminOnlySection(section) || isWorkspaceAdmin(role);

/** What gating a page by its plugin reads of the status. */
export type PluginStatus = Pick<PeerHubStatus, "plugins"> & { readonly signedIn?: boolean };

/**
 * Whether a plugin's pages, fields and rows are left out of the navigation, search and Overview: its
 * owner turned it off, an operator forced it off, or the build does not have it. A plugin that waits
 * for a newer Hub stays, since its page says so. With no status (nobody is signed in) nothing is left
 * out, so the way back to a plugin that was turned off is always in reach.
 */
export function isPluginHidden(status: PluginStatus | undefined, plugin: string): boolean {
  if (status === undefined) return false;
  const reason = inactivePluginReason(status, plugin);
  return reason === "off" || reason === "locked" || reason === "missing";
}

/** What the navigation reads of a workspace: the manifest's own shape. */
export interface PeerNavWorkspace {
  readonly slug: string;
  readonly name: string;
  readonly role: PeerWorkspaceRole;
  readonly projects: ReadonlyArray<{
    readonly project: {
      readonly id: string;
      readonly name: string;
      readonly role: "lead" | "member";
    };
  }>;
}

/** The heading a page is listed under in the settings navigation: Workspace, Projects, Me or This computer. */
export function peerSettingsGroupLabel(location: PeerSettingsLocation): string {
  switch (location.kind) {
    case "project":
      return "Projects";
    case "computer":
      return "This computer";
    case "workspace":
      if ((ME_NAV_SECTIONS as ReadonlyArray<WorkspaceSection>).includes(location.section)) {
        return "Me";
      }
      return location.section === "new-project" ? "Projects" : "Workspace";
  }
}

/** What the breadcrumb calls a page: its section, or for a project its name. */
export function peerSettingsPageTitle(
  location: PeerSettingsLocation | null,
  workspaces: ReadonlyArray<PeerNavWorkspace>,
): string | null {
  switch (location?.kind) {
    case undefined:
      return null;
    case "workspace":
      return WORKSPACE_SECTION_LABELS[location.section];
    case "project":
      return (
        workspaces
          .find((workspace) => workspace.slug === location.workspace)
          ?.projects.find(({ project }) => project.id === location.projectId)?.project.name ??
        location.projectId
      );
    case "computer":
      return COMPUTER_SECTION_LABELS[location.section];
  }
}

/**
 * The workspace the navigation shows: the page's own, else the one the person used last, else the
 * first. The computer's pages belong to no workspace, so without the one used last the navigation
 * would jump to another workspace whenever the person opened one.
 */
export function currentNavWorkspace<W extends { readonly slug: string }>(
  workspaces: ReadonlyArray<W>,
  current: PeerSettingsLocation | null,
  lastUsed: string | null,
): W | null {
  const named = locationWorkspace(current) ?? lastUsed;
  return workspaces.find((workspace) => workspace.slug === named) ?? workspaces[0] ?? null;
}

/**
 * Where choosing another workspace goes: the same section when that workspace's role has it,
 * else General.
 */
export function workspaceSwitchTarget(
  current: PeerSettingsLocation | null,
  target: Pick<PeerNavWorkspace, "slug" | "role">,
): PeerSettingsLocation {
  const section =
    current?.kind === "workspace" &&
    (WORKSPACE_NAV_SECTIONS as ReadonlyArray<WorkspaceSection>).includes(current.section) &&
    sectionInNav(current.section, target.role)
      ? current.section
      : DEFAULT_WORKSPACE_SECTION;
  return { kind: "workspace", workspace: target.slug, section };
}

/** What a page header says of the person's part in what it shows. */
export interface RoleBadge {
  readonly label: string;
  readonly tone: "lead" | "admin" | "member";
}

/** A lead is told so first; an admin who does not lead the project still edits it. */
export function projectRoleBadge(
  workspaceRole: PeerWorkspaceRole,
  projectRole: "lead" | "member",
): RoleBadge {
  if (projectRole === "lead") return { label: "You’re a lead", tone: "lead" };
  if (isWorkspaceAdmin(workspaceRole)) return { label: "You’re an admin", tone: "admin" };
  return { label: "Member · read only", tone: "member" };
}

export function workspaceRoleBadge(role: PeerWorkspaceRole, limit?: string): RoleBadge {
  const only = limit === undefined ? "" : ` · ${limit}`;
  if (role === "owner") return { label: `You’re an owner${only}`, tone: "admin" };
  if (role === "admin") return { label: `You’re an admin${only}`, tone: "admin" };
  return { label: `Member${only} · read only`, tone: "member" };
}

/** Leads and admins change a project; its other members read it. */
export const canEditProject = (
  workspaceRole: PeerWorkspaceRole,
  projectRole: "lead" | "member",
): boolean => projectRole === "lead" || isWorkspaceAdmin(workspaceRole);

/**
 * The environment whose Peer the area shows: the one the address names (`machine`, as every
 * settings page does), else the primary one while connected, else any connected one. With none
 * connected the primary (or first) one stands, so its page can say it is not connected.
 */
export function selectPeerEnvironment<
  E extends {
    readonly environmentId: string;
    readonly connection: { readonly phase: string };
    readonly serverConfig: unknown;
  },
>(
  environments: ReadonlyArray<E>,
  primaryEnvironmentId: string | null,
  machine: string | undefined,
): E | null {
  const connected = (environment: E) =>
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  const named =
    machine === undefined
      ? undefined
      : environments.find((environment) => environment.environmentId === machine);
  return (
    named ??
    environments.find(
      (environment) => environment.environmentId === primaryEnvironmentId && connected(environment),
    ) ??
    environments.find(connected) ??
    environments.find((environment) => environment.environmentId === primaryEnvironmentId) ??
    environments[0] ??
    null
  );
}

/**
 * Whether an environment that is not connected is on its way, as against not reachable. The first
 * moments of a page have no environment listed yet, then one that has not started, then one that is
 * connecting, and a page that says "not connected" in them says something false for a second or two;
 * one that failed, went offline or is too old to talk to really is not connected. A connected
 * environment whose configuration has not arrived is still on its way too.
 */
export function environmentIsComing(
  environment: {
    readonly connection: { readonly phase: string };
    readonly serverConfig: unknown;
  } | null,
): boolean {
  if (environment === null) return true;
  const { phase } = environment.connection;
  return (
    phase === "available" ||
    phase === "connecting" ||
    (phase === "connected" && environment.serverConfig === null)
  );
}

/**
 * Where a plugin's settings slot component renders in the area. Plugins fill four generic slots
 * (`settings`, `alwaysSettings`, `workspaceSettings`, `projectSettings`); each page lists the
 * slots hosted on it. A slot without a placement goes to the generic home of its kind.
 */
export type SlotKind = "settings" | "alwaysSettings" | "workspaceSettings" | "projectSettings";

export type SlotHost =
  | "coordination"
  | "general"
  | "people"
  | "capacity"
  | "integrations"
  | "audit"
  | "tool-trust"
  | "basics"
  /** The page renders the plugin's component itself, with what it needs of it. */
  | "own";

const SLOT_HOMES: Readonly<Record<SlotKind, SlotHost>> = {
  settings: "coordination",
  alwaysSettings: "coordination",
  workspaceSettings: "general",
  projectSettings: "basics",
};

const SLOT_PLACEMENTS: Readonly<Record<SlotKind, Readonly<Record<string, SlotHost>>>> = {
  settings: { capacity: "capacity", "tool-trust": "tool-trust", slack: "own" },
  alwaysSettings: {},
  workspaceSettings: { audit: "audit", github: "integrations", metrics: "people" },
  projectSettings: { capacity: "own", acceptance: "coordination" },
};

export const slotHost = (kind: SlotKind, plugin: string): SlotHost =>
  SLOT_PLACEMENTS[kind][plugin] ?? SLOT_HOMES[kind];
