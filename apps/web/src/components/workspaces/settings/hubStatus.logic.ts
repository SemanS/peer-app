/**
 * What the Hub page says (design artboard 23), from what the app knows of the Hub it is signed in
 * to: its address, its build and which of its features are on. A Hub tells its build and the
 * catalog of what it serves in `/v1/me`, with the features its operator turned off (`status.hub`):
 * each of its features is then on, off for the operator's choice, or waiting for a newer Hub, as
 * the catalog says. A Hub that says less (an older one) leaves the app to tell from each plugin's
 * state (a plugin that needs a Hub feature is inactive with the reason `hub` while the Hub does not
 * serve it) and, from the settings feature, whether path rules and GitHub's checks are served; so
 * for such a Hub a row is only there where one of those says something true.
 *
 * Each feature is told in the status language (`ConnectionStatus`): the Hub serves it (Connected, or
 * what the workspace still has to do for Slack and GitHub's checks), its operator turned it off or
 * the Hub is too old (Not available), or this computer's owner turned its plugin off (Off).
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";
import { hubFeatureState, pluginLockNote } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubInfo, PeerPluginState, PeerSettingsView } from "@t3tools/contracts";

import { CHECKING_LABEL, type ConnectionView } from "../../settings/connectionFacts";
import {
  CONNECTION_STATE_LABEL,
  connectionDetail,
  type ConnectionState,
} from "../../settings/connectionStatus.logic";
import { joinNames } from "./reviewChanges.logic";
import type { SettingsDocument } from "./settingsView.logic";

export const HUB_DESCRIPTION = "Read only. The Hub’s operator changes these, not the app.";

/**
 * Where a feature stands. `off-hub` is the operator's choice, `newer` goes away with an update, and
 * `off-here` is a choice on this computer, not the Hub's: only a Hub that sends no catalog leaves
 * the app to tell from the plugins, which is where this computer's own choice shows.
 */
export type FeatureState = "on" | "off-hub" | "newer" | "off-here";

export interface FeatureRow {
  readonly id: string;
  readonly name: string;
  readonly state: FeatureState;
  /** The status language's state: where the feature stands, apart from the word on its badge. */
  readonly connection: ConnectionState;
  /** The badge's word: "Connected", "Not available", "Off", "Needs setup", "Checking…". */
  readonly label: string;
  /** What it means for the people of the workspace, in the state it is in. */
  readonly effect: string;
}

/** How the Hub's catalog maps onto the status language. */
const CONNECTION: Readonly<Record<FeatureState, ConnectionState>> = {
  on: "connected",
  "off-hub": "unavailable",
  newer: "unavailable",
  "off-here": "off",
};

/** What a feature means in each state the Hub can leave it in. */
interface Words {
  readonly on: string;
  readonly off: string;
  readonly newer: string;
  /** What it means until the workspace has connected it, for the features that need that. */
  readonly pending?: string;
}

/** What tells the state of a Hub that sends no catalog, if anything does. */
type Without = "plugin" | "flags" | "nothing";

interface Feature {
  /** The Hub's id for it, which is its plugin's too. */
  readonly id: string;
  readonly name: string;
  readonly words: Words;
  /**
   * The plugin's state (it needs this Hub feature), the flags the Hub's settings carry, or nothing:
   * a feature no plugin of the app waits for says nothing of an older Hub.
   */
  readonly without: Without;
  /**
   * The Hub may be built without it, and so may the app (Memory, while it is frozen): neither served
   * nor turned off then says the Hub was built without it, not that it is too old, since every Hub
   * with a catalog had it from the catalog's start. A build without its plugin does not advertise it.
   */
  readonly optional?: true;
}

/** The features of the Hub the app has words for, in the order the page lists them. */
const FEATURES: ReadonlyArray<Feature> = [
  {
    id: "settings",
    name: "Workspace settings",
    without: "plugin",
    words: {
      on: "Settings changed in the app are saved with their history and reviewed first.",
      off: "Settings can’t be changed in the app: this Hub doesn’t run them.",
      newer: "Settings can be read here but not changed until the Hub is updated.",
    },
  },
  {
    id: "resources",
    name: "Path rules",
    without: "flags",
    words: {
      on: "A project’s path rules decide what agents do for the files they name.",
      // Said with the projects that have path rules: `pathRulesOffEffect`.
      off: "",
      newer: "Path rules can’t apply until the Hub is updated.",
    },
  },
  {
    id: "github",
    name: "GitHub PR checks",
    without: "flags",
    words: {
      on: "GitHub’s word on a pull request can count over the agent’s report.",
      off: "Pull requests count as their agents report them: this Hub doesn’t check them with GitHub.",
      newer: "Pull requests count as their agents report them until the Hub is updated.",
      pending: "Pull requests count as their agents report them.",
    },
  },
  {
    id: "audit",
    name: "Audit log",
    without: "nothing",
    words: {
      on: "Every settings change is recorded with who, what, from and to.",
      off: "The audit log can’t be read: this Hub doesn’t run it.",
      newer: "The audit log can’t be read until the Hub is updated.",
    },
  },
  {
    id: "metrics",
    name: "Team metrics",
    without: "nothing",
    words: {
      on: "Workspace › People shows usage per person.",
      off: "Team metrics can’t be shared: this Hub doesn’t run them.",
      newer: "Team metrics can’t be shared until the Hub is updated.",
    },
  },
  {
    id: "webhooks",
    name: "Webhooks",
    without: "plugin",
    words: {
      on: "Workspace events can go to Slack, Teams or an address of your own.",
      off: "Webhooks can’t be added or changed: this Hub doesn’t run them.",
      newer: "Webhooks can’t be added until the Hub is updated.",
    },
  },
  {
    id: "slack",
    name: "Slack",
    without: "plugin",
    words: {
      on: "Agents can ask people in Slack when they wait.",
      off: "Agents can’t ask people in Slack: this Hub doesn’t run it.",
      newer: "Agents can’t ask people in Slack until the Hub is updated.",
      pending: "Until then agents ask only in Peer.",
    },
  },
  {
    id: "requests",
    name: "Team requests",
    without: "plugin",
    words: {
      on: "People can ask a teammate’s agent to take on a task.",
      off: "Team requests can’t be sent: this Hub doesn’t run them.",
      newer: "Team requests can’t be sent until the Hub is updated.",
    },
  },
  {
    id: "observe",
    name: "Observe",
    without: "plugin",
    words: {
      on: "Teammates can watch a thread you share, live.",
      off: "Shared threads can’t be watched live: this Hub doesn’t run it.",
      newer: "Shared threads can’t be watched live until the Hub is updated.",
    },
  },
  {
    id: "knowledge",
    name: "Knowledge",
    without: "plugin",
    words: {
      on: "What agents find becomes knowledge the team reviews and keeps.",
      off: "What agents find isn’t kept as team knowledge: this Hub doesn’t run it.",
      newer: "What agents find isn’t kept as team knowledge until the Hub is updated.",
    },
  },
  {
    id: "memory",
    name: "Memory",
    without: "plugin",
    optional: true,
    words: {
      on: "Projects can turn on Memory.",
      off: "This Hub was built without Memory, so projects can’t turn it on.",
      newer: "Projects can’t turn on Memory until the Hub is updated.",
    },
  },
  {
    id: "handoff",
    name: "Handoff for review",
    without: "plugin",
    words: {
      on: "Agents can store a review package for a task.",
      off: "Review packages can’t be stored: this Hub doesn’t run it.",
      newer: "Review packages can’t be stored until the Hub is updated.",
    },
  },
  {
    id: "dependencies",
    name: "Task dependencies",
    without: "plugin",
    words: {
      on: "Tasks can record what they depend on, and agents hear when it changes.",
      off: "Task dependencies can’t be recorded: this Hub doesn’t run them.",
      newer: "Task dependencies can’t be recorded until the Hub is updated.",
    },
  },
  {
    id: "announcements",
    name: "Announcements",
    without: "nothing",
    words: {
      on: "Leads and services can tell a project’s agents something once.",
      off: "Announcements can’t be posted: this Hub doesn’t run them.",
      newer: "Announcements can’t be posted until the Hub is updated.",
    },
  },
  {
    id: "digest",
    name: "Catch-up digest",
    without: "plugin",
    words: {
      on: "“Since you were away” tells people what changed.",
      off: "People get no catch-up from the Hub: this Hub doesn’t run it.",
      newer: "People get no catch-up from the Hub until it is updated.",
    },
  },
  {
    id: "impact",
    name: "Impact overlaps",
    without: "nothing",
    words: {
      on: "Agents hear when work changes code another task calls.",
      off: "Impact overlaps can’t be found: this Hub doesn’t run them.",
      newer: "Impact overlaps can’t be found until the Hub is updated.",
    },
  },
];

const KNOWN: ReadonlySet<string> = new Set(FEATURES.map((feature) => feature.id));

const OFF_HERE = "Turned off on this computer. Its owner turns it on in Coordination & plugins.";

/** The features whose Hub support is only half of it: the workspace connects them too. */
export type ConnectedFeature = "slack" | "github";

/**
 * What the workspace's own connection says of the features that have one, by the feature's id:
 * the status language's view of Slack and of GitHub's checks, as the Integrations page and
 * Settings › Overview tell them. A feature without an entry says only what the Hub does.
 */
export type FeatureConnections = Readonly<Partial<Record<ConnectedFeature, ConnectionView>>>;

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The names of the projects that have path rules, which the Hub saves whether or not it applies them. */
export function projectsWithPathRules(document: SettingsDocument | null): ReadonlyArray<string> {
  const projects = document === null ? undefined : getAt(document, ["projects"]);
  if (!isMapping(projects)) return [];
  return Object.entries(projects)
    .filter(([, project]) => {
      const paths = getAt(project, ["coordination", "paths"]);
      return isMapping(paths) && Object.keys(paths).length > 0;
    })
    .map(([id, project]) => {
      const name = getAt(project, ["name"]);
      return typeof name === "string" && name !== "" ? name : id;
    })
    .toSorted((a, b) => a.localeCompare(b));
}

/** What path rules that are saved and not applied say: whose they are, and what agents get instead. */
export function pathRulesOffEffect(projectNames: ReadonlyArray<string>): string {
  const whose =
    projectNames.length === 0
      ? "Path rules"
      : `${joinNames(projectNames.map((name) => `${name}’s`))} path rules`;
  return `${whose} are saved but don’t apply. Agents get each project’s policy.`;
}

interface Context {
  readonly plugins: ReadonlyArray<PeerPluginState>;
  readonly hub: PeerHubInfo | undefined;
  readonly flags: PeerSettingsView["features"] | null;
  readonly settingsServed: boolean;
}

/**
 * Where a feature stands, from the catalog where the Hub sent one. Without it the plugin's state
 * tells (the Hub does not serve a feature its plugin needs, and an older Hub is not the one that
 * turned it off), or the flags of the settings; undefined where nothing does, so there is no row.
 */
function stateOf(feature: Feature, context: Context): FeatureState | undefined {
  const plugin = context.plugins.find((candidate) => candidate.id === feature.id);
  if (feature.optional === true && plugin === undefined) return undefined;
  const listed = hubFeatureState({ hub: context.hub }, feature.id);
  if (listed !== undefined) {
    // The Hub serves it, but not at the revision the plugin needs.
    if (listed === "on") return plugin?.reason === "hub" ? "newer" : "on";
    if (listed === "off") return "off-hub";
    return feature.optional === true ? "off-hub" : "newer";
  }
  switch (feature.without) {
    case "plugin":
      if (plugin === undefined) return undefined;
      if (plugin.active) return "on";
      // The Hub does not serve it. One that serves settings is newer than every feature this app
      // knows, so it is the operator who turned the feature off; an older one has yet to be updated.
      if (plugin.reason === "hub") return context.settingsServed ? "off-hub" : "newer";
      return "off-here";
    case "flags": {
      if (!context.settingsServed || context.flags === null) return undefined;
      const served = feature.id === "resources" ? context.flags.pathRules : context.flags.github;
      return served ? "on" : "off-hub";
    }
    case "nothing":
      return undefined;
  }
}

function effectOf(
  feature: Feature,
  state: FeatureState,
  input: {
    readonly plugin: PeerPluginState | undefined;
    readonly pathRuleProjects: ReadonlyArray<string>;
  },
): string {
  switch (state) {
    case "on":
      return feature.words.on;
    case "newer":
      return feature.words.newer;
    case "off-hub":
      return feature.id === "resources"
        ? pathRulesOffEffect(input.pathRuleProjects)
        : feature.words.off;
    case "off-here":
      return (input.plugin === undefined ? null : pluginLockNote(input.plugin)) ?? OFF_HERE;
  }
}

/** A feature of the Hub this version of Peer has no words for: its id, and that it is there. */
function unknownRow(id: string, state: "on" | "off-hub"): FeatureRow {
  const name = id.replaceAll("-", " ");
  return {
    id,
    name: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    state,
    connection: CONNECTION[state],
    label: CONNECTION_STATE_LABEL[CONNECTION[state]],
    effect: "A feature of this Hub that this version of Peer has no words for.",
  };
}

const sentences = (...parts: ReadonlyArray<string | undefined>): string =>
  parts.filter((part): part is string => part !== undefined && part !== "").join(" ");

const withFullStop = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * A feature the Hub serves, told by the workspace's own connection where it has one: connected, it
 * is what the Hub does for the feature; otherwise the connection's step or detail comes first and
 * then what it means until the workspace is done.
 */
function connectedRow(
  feature: Feature,
  view: ConnectionView,
): Pick<FeatureRow, "connection" | "label" | "effect"> {
  const label = view.label ?? CONNECTION_STATE_LABEL[view.state];
  // Not read yet: say what the feature does, and nothing about how far the workspace is.
  if (view.state === "connected" || view.label === CHECKING_LABEL) {
    return { connection: view.state, label, effect: feature.words.on };
  }
  const why = connectionDetail(view);
  return {
    connection: view.state,
    label,
    effect: sentences(
      why === undefined ? undefined : withFullStop(why),
      view.state === "unavailable" ? undefined : feature.words.pending,
    ),
  };
}

/**
 * The features table. Coordination is the Hub's own and always on. Each other feature of the Hub is
 * on, off on this Hub or waiting for a newer one, as the Hub's catalog says (`hub`), with the ones
 * it serves or turned off that this app does not know after them; for a Hub that sends no catalog
 * the plugins and the settings flags tell what they can, as `stateOf` says.
 */
export function hubFeatureRows(input: {
  readonly plugins: ReadonlyArray<PeerPluginState> | undefined;
  /** What the Hub said of itself in `/v1/me`; undefined from one that says nothing. */
  readonly hub: PeerHubInfo | undefined;
  /** `GET /settings`' `features`; null while the settings cannot be read. */
  readonly flags: PeerSettingsView["features"] | null;
  /** The projects that have path rules, by name. */
  readonly pathRuleProjects: ReadonlyArray<string>;
  /** What the workspace's own connection says of Slack and GitHub's checks, once read. */
  readonly connections?: FeatureConnections | undefined;
}): ReadonlyArray<FeatureRow> {
  const plugins = input.plugins ?? [];
  const context: Context = {
    plugins,
    hub: input.hub,
    flags: input.flags,
    settingsServed: plugins.find((plugin) => plugin.id === "settings")?.active === true,
  };
  const rows: FeatureRow[] = [
    {
      id: "coordination",
      name: "Coordination",
      state: "on",
      connection: "connected",
      label: CONNECTION_STATE_LABEL.connected,
      effect: "Agents check files with the Hub before they edit.",
    },
  ];
  for (const feature of FEATURES) {
    const state = stateOf(feature, context);
    if (state === undefined) continue;
    const plugin = plugins.find((candidate) => candidate.id === feature.id);
    const view =
      state === "on" && (feature.id === "slack" || feature.id === "github")
        ? input.connections?.[feature.id]
        : undefined;
    rows.push({
      id: feature.id,
      name: feature.name,
      state,
      ...(view === undefined
        ? {
            connection: CONNECTION[state],
            label: CONNECTION_STATE_LABEL[CONNECTION[state]],
            effect: effectOf(feature, state, { plugin, pathRuleProjects: input.pathRuleProjects }),
          }
        : connectedRow(feature, view)),
    });
  }
  const unknown = (ids: ReadonlyArray<string> | undefined) =>
    (ids ?? []).filter((id) => !KNOWN.has(id)).toSorted();
  for (const id of unknown(Object.keys(input.hub?.features ?? {}))) {
    rows.push(unknownRow(id, "on"));
  }
  for (const id of unknown(input.hub?.featuresOff)) rows.push(unknownRow(id, "off-hub"));
  return rows;
}

/** The line under the table, which explains the states that are in it. */
export function featuresFootnote(rows: ReadonlyArray<FeatureRow>): string {
  const base =
    "“Not available” is the Hub’s: its operator turned the feature off, or the Hub needs an update, and the row says which.";
  return rows.some((feature) => feature.state === "off-here")
    ? `${base} “Off” is a choice made on this computer, in Coordination & plugins.`
    : base;
}

/** The Hub's build as the page shows it: its release, and the start of the commit it was made from. */
export function hubBuild(
  hub: PeerHubInfo | undefined,
): { readonly version: string | null; readonly commit: string | null } | null {
  const version = hub?.version?.trim() || null;
  const commit = hub?.commit?.trim().slice(0, 7) || null;
  return version === null && commit === null ? null : { version, commit };
}

/** The Hub's address as the page shows it: without `https://` and a closing slash. */
export function hubAddress(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.replace(/^https:\/\//i, "");
}
