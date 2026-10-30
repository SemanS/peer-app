/**
 * What settings search knows of Peer's own pages: each page of the Workspace, the person's Projects,
 * Me and This computer, the sections on them and their key fields, with the words people remember
 * them by (Slack, bot token, signing secret, webhook, master key, pools, path rules…). Peer's pages
 * live at addresses that name a workspace and a project, so the catalog is built for the ones the
 * person has open (`peerSearchItems`); a result carries where it lives, so it can say so.
 *
 * What the person may not open is not here: a member gets no admin page or field, and a plugin
 * turned off takes its items with it, as it takes its navigation entries and Overview rows.
 */
import type { PeerSearchItem } from "../../settings/settingsSearch";
import {
  COMPUTER_SECTION_LABELS,
  PROJECT_TAB_LABELS,
  WORKSPACE_SECTION_LABELS,
  INTEGRATION_ANCHORS,
  isPluginHidden,
  isWorkspaceAdmin,
  peerSettingsGroupLabel,
  sectionInNav,
  type ComputerSection,
  type PeerNavWorkspace,
  type PeerSettingsLocation,
  type PluginStatus,
  type ProjectTab,
  type WorkspaceSection,
} from "./peerSettings.logic";

type Place =
  | { readonly workspace: WorkspaceSection }
  | { readonly project: ProjectTab }
  | { readonly computer: ComputerSection };

interface Entry {
  readonly id: string;
  readonly title: string;
  readonly place: Place;
  /** The part of the page it is in; the result writes it after the page's name. */
  readonly part?: string;
  /** The part of the page to scroll to. */
  readonly targetId?: string;
  /** What people may remember it by, instead of its title. */
  readonly terms: string;
  /** Only owners and admins have it, though its page is for everyone. */
  readonly admin?: true;
  /** The plugin whose absence takes it away. */
  readonly plugin?: string;
  /** The Overview row whose status the result shows. */
  readonly row?: string;
}

const w = (workspace: WorkspaceSection): Place => ({ workspace });
const p = (project: ProjectTab): Place => ({ project });
const c = (computer: ComputerSection): Place => ({ computer });

/** The pages and fields of the workspace the person has open, and the ones that are theirs alone. */
const WORKSPACE_ENTRIES: ReadonlyArray<Entry> = [
  // General
  {
    id: "general",
    title: "Workspace name",
    place: w("general"),
    terms: "general name rename slug",
  },
  {
    id: "domains",
    title: "Email domains",
    place: w("general"),
    terms: "domain dns txt verify email admit allowed domains join invite claim",
  },
  {
    id: "company-knowledge",
    title: "Company knowledge",
    place: w("general"),
    terms: "knowledge repository decisions conventions branch store",
  },
  {
    id: "workspace-yaml",
    title: "Workspace YAML",
    place: w("general"),
    terms: "yaml import export configuration file manifest",
    admin: true,
  },
  // People
  {
    id: "people",
    title: "People and roles",
    place: w("people"),
    terms: "invite member admin owner role people remove",
  },
  {
    id: "team-metrics",
    title: "Team metrics",
    place: w("people"),
    terms: "usage per person metrics team outcomes",
    plugin: "metrics",
  },
  // Shared capacity
  {
    id: "capacity",
    title: "Shared capacity",
    place: w("capacity"),
    terms: "capacity gateway api keys budget litellm",
    plugin: "capacity",
    row: "workspace:capacity",
  },
  {
    id: "gateway",
    title: "Gateway",
    place: w("capacity"),
    terms: "gateway url address currency rate usd eur litellm sync",
    plugin: "capacity",
  },
  {
    id: "master-key",
    title: "Gateway master key",
    place: w("capacity"),
    terms: "gateway master key token api key secret litellm",
    plugin: "capacity",
  },
  {
    id: "pools",
    title: "Model pools",
    place: w("capacity"),
    terms: "pool pools model models capacity budget api",
    plugin: "capacity",
  },
  // Tools, secrets
  {
    id: "tools-catalog",
    title: "Tools catalog",
    place: w("tools"),
    terms: "mcp tools catalog server add tool",
  },
  {
    id: "hub-secrets",
    title: "Hub secrets",
    place: w("secrets"),
    terms: "secret secrets token key sealed value store",
  },
  // Integrations
  {
    id: "slack",
    title: "Slack conversations",
    place: w("integrations"),
    targetId: INTEGRATION_ANCHORS.slack,
    terms: "slack bot app manifest ask questions conversations channel",
    plugin: "slack",
    row: "workspace:slack",
  },
  {
    id: "slack-bot-token",
    title: "Bot token",
    place: w("integrations"),
    part: "Slack",
    targetId: INTEGRATION_ANCHORS.slack,
    terms: "slack xoxb token bot user oauth",
    plugin: "slack",
  },
  {
    id: "slack-signing-secret",
    title: "Signing secret",
    place: w("integrations"),
    part: "Slack",
    targetId: INTEGRATION_ANCHORS.slack,
    terms: "slack secret signing",
    plugin: "slack",
  },
  {
    id: "webhooks",
    title: "Webhooks",
    place: w("integrations"),
    targetId: INTEGRATION_ANCHORS.webhooks,
    terms: "webhook slack teams generic events notifications deliveries",
    plugin: "webhooks",
    row: "workspace:webhooks",
  },
  {
    id: "webhook-signing-key",
    title: "Webhook signing key",
    place: w("integrations"),
    part: "Webhooks",
    targetId: INTEGRATION_ANCHORS.webhooks,
    terms: "webhook signing key whsec secret token generic standard webhooks",
    plugin: "webhooks",
  },
  {
    id: "github-checks",
    title: "GitHub PR checks",
    place: w("integrations"),
    targetId: INTEGRATION_ANCHORS.github,
    terms: "github webhook secret ping pull request merge checks",
    plugin: "github",
    row: "workspace:github",
  },
  // Audit, Hub, New project
  {
    id: "settings-history",
    title: "Settings history",
    place: w("audit"),
    terms: "history revision audit revert log who changed",
    plugin: "audit",
  },
  {
    id: "hub",
    title: "Peer Hub",
    place: w("hub"),
    terms: "hub address version features sync operator",
    row: "workspace:hub",
  },
  {
    id: "new-project",
    title: "New project",
    place: w("new-project"),
    terms: "create project add project clone repository",
  },
  // Me
  {
    id: "ai-subscriptions",
    title: "AI subscriptions",
    place: w("plans"),
    terms: "plan plans claude max chatgpt pro subscription personal detected",
    row: "me:plans",
  },
  {
    id: "keys",
    title: "Keys",
    place: w("keys"),
    terms: "keys key api key shared capacity personal computer",
  },
  {
    id: "slack-account",
    title: "Slack account",
    place: w("slack"),
    terms: "slack ask me dm notifications delay link account",
    plugin: "slack",
    row: "me:slack",
  },
];

/** This computer's own pages, whatever workspace is open. */
const COMPUTER_ENTRIES: ReadonlyArray<Entry> = [
  {
    id: "coordination-default",
    title: "Your coordination default",
    place: c("coordination"),
    terms: "notify coordinate ask default policy coordination",
  },
  {
    id: "peer-plugins",
    title: "Peer plugins",
    place: c("coordination"),
    terms:
      "plugin plugins turn on off herdr github dependencies handoff requests observe knowledge memory announcements settle recipes forecast metrics usage digest impact ownership",
  },
  {
    id: "slack-plugin",
    title: "Slack plugin",
    place: c("coordination"),
    terms: "slack plugin",
    row: "computer:slack-plugin",
  },
  {
    id: "agent-coordination",
    title: "Agent coordination",
    place: c("coordination"),
    terms: "coordination hooks claude mod codex trust experimental",
  },
  {
    id: "phone-alerts",
    title: "Phone alerts",
    place: c("coordination"),
    terms: "phone alerts mobile push notifications needs you",
    plugin: "needs-you",
  },
  {
    id: "settle-resume",
    title: "Resume an ended agent to settle its overlaps",
    place: c("coordination"),
    terms: "settle overlap resume ended agent handover close leave it to me",
    plugin: "settle",
  },
  {
    id: "tool-trust",
    title: "Tool trust",
    place: c("tool-trust"),
    terms: "mcp trust approve tools",
    plugin: "tool-trust",
  },
  {
    id: "tool-secrets",
    title: "Personal tool secrets",
    place: c("tool-trust"),
    terms: "secret token key mcp tool personal",
    plugin: "tool-trust",
  },
];

/** What each project of the person has, in the tab of its own. */
const PROJECT_ENTRIES: ReadonlyArray<Entry> = [
  {
    id: "project-basics",
    title: "Project basics",
    place: p("basics"),
    terms: "name client description id knowledge",
  },
  {
    id: "project-knowledge",
    title: "Project knowledge",
    place: p("basics"),
    terms: "knowledge kontext company agents read",
  },
  {
    id: "project-people",
    title: "Project people",
    place: p("people"),
    terms: "members leads lead invite add person role people",
  },
  {
    id: "project-tasks",
    title: "Project tasks",
    place: p("tasks"),
    terms: "tasks task group groups order tree area areas",
  },
  {
    id: "project-repositories",
    title: "Repositories",
    place: p("repositories"),
    terms: "repository repositories repo git github clone branch url checkout",
  },
  {
    id: "project-tools",
    title: "Project tools",
    place: p("tools"),
    terms: "tools mcp add from catalog project",
  },
  {
    id: "project-capacity",
    title: "Project capacity",
    place: p("capacity"),
    terms: "capacity budget shared pool allocations models personal plans",
  },
  {
    id: "coordination-policy",
    title: "Coordination policy",
    place: p("coordination"),
    terms: "policy notify coordinate ask exclusive coordination agents overlap",
  },
  {
    id: "path-rules",
    title: "Path rules",
    place: p("coordination"),
    terms: "path rule rules glob pattern exception folder file",
  },
  {
    id: "test-a-path",
    title: "Test a path",
    place: p("coordination"),
    terms: "path test rule which mode decides",
  },
  {
    id: "project-history",
    title: "Project history",
    place: p("history"),
    terms: "history revision changes audit",
  },
];

/** What the search needs to know of the person's Peer to build its items. */
export interface PeerSearchContext {
  /** Someone is signed in to a Hub; without one Peer's pages open on the sign-in view and are not offered. */
  readonly signedIn: boolean;
  /** The workspace the settings area has open; null with none. */
  readonly workspace: PeerNavWorkspace | null;
  /** The plugins this computer lists, which decide what is left out. */
  readonly status?: PluginStatus | undefined;
  /** Where a connection stands, by the Overview's row id: "Needs setup", "2 detected". */
  readonly statuses?: Readonly<Record<string, string>> | undefined;
}

function itemOf(
  entry: Entry,
  location: PeerSettingsLocation,
  path: ReadonlyArray<string>,
  statuses: PeerSearchContext["statuses"],
): PeerSearchItem {
  const status = entry.row === undefined ? undefined : statuses?.[entry.row];
  return {
    id: location.kind === "project" ? `${entry.id}:${location.projectId}` : entry.id,
    title: entry.title,
    path: entry.part === undefined ? path : [...path, entry.part],
    location,
    ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
    searchTerms: [entry.terms],
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * Every page, section and key field of Peer's settings the person may open, with where each lives.
 * Workspace and Me items need a workspace; This computer's do not.
 */
export function peerSearchItems(context: PeerSearchContext): ReadonlyArray<PeerSearchItem> {
  const { workspace, status, statuses } = context;
  if (!context.signedIn) return [];
  const shown = (entry: Entry) =>
    entry.plugin === undefined || !isPluginHidden(status, entry.plugin);
  const items: PeerSearchItem[] = [];
  if (workspace !== null) {
    const admin = isWorkspaceAdmin(workspace.role);
    for (const entry of WORKSPACE_ENTRIES.filter(shown)) {
      if (!("workspace" in entry.place)) continue;
      const section = entry.place.workspace;
      if (!sectionInNav(section, workspace.role) || (entry.admin === true && !admin)) continue;
      items.push(
        itemOf(
          entry,
          { kind: "workspace", workspace: workspace.slug, section },
          [
            peerSettingsGroupLabel({ kind: "workspace", workspace: workspace.slug, section }),
            WORKSPACE_SECTION_LABELS[section],
          ],
          statuses,
        ),
      );
    }
    for (const { project } of workspace.projects) {
      for (const entry of PROJECT_ENTRIES) {
        if (!("project" in entry.place)) continue;
        const tab = entry.place.project;
        items.push(
          itemOf(
            entry,
            { kind: "project", workspace: workspace.slug, projectId: project.id, tab },
            ["Projects", project.name, PROJECT_TAB_LABELS[tab]],
            statuses,
          ),
        );
      }
    }
  }
  for (const entry of COMPUTER_ENTRIES.filter(shown)) {
    if (!("computer" in entry.place)) continue;
    const section = entry.place.computer;
    items.push(
      itemOf(
        entry,
        { kind: "computer", section },
        ["This computer", COMPUTER_SECTION_LABELS[section]],
        statuses,
      ),
    );
  }
  return items;
}
