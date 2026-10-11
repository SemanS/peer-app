/**
 * What the Hub page says (design artboard 23), from what the app already knows of the Hub it is
 * signed in to: its address, and which of its features are on. The app is told no Hub version, build
 * or schema state, and no list of the features the Hub serves; what it knows is each plugin's state
 * on this computer (a plugin that needs a Hub feature is inactive with the reason `hub` while the Hub
 * does not serve it) and, from the settings feature, whether path rules, webhooks and GitHub checks
 * are served. So a row is only there where one of those says something true about the Hub.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";
import { pluginLockNote } from "@t3tools/client-runtime/peer/plugins";
import type { PeerPluginState, PeerSettingsView } from "@t3tools/contracts";

import { joinNames } from "./reviewChanges.logic";
import type { SettingsDocument } from "./settingsView.logic";

export const HUB_DESCRIPTION = "Read only. The Hub’s operator changes these, not the app.";

/**
 * Where a feature stands. `off-hub` is the operator's choice, `newer` goes away with an update, and
 * `off-here` is a choice on this computer, not the Hub's.
 */
export type FeatureState = "on" | "off-hub" | "newer" | "off-here";

export interface FeatureRow {
  readonly id: string;
  readonly name: string;
  readonly state: FeatureState;
  /** "On", "Off on this Hub", "Needs a newer Hub", "Off on this computer". */
  readonly label: string;
  /** What it means for the people of the workspace, in the state it is in. */
  readonly effect: string;
}

const LABELS: Readonly<Record<FeatureState, string>> = {
  on: "On",
  "off-hub": "Off on this Hub",
  newer: "Needs a newer Hub",
  "off-here": "Off on this computer",
};

/** What a feature means in each state the Hub can leave it in. */
interface Words {
  readonly on: string;
  readonly off: string;
  readonly newer: string;
}

/**
 * The plugins that need a feature of the Hub, in the order the page lists them. A plugin that is
 * not in the status (a build without it) has no row.
 */
const PLUGIN_FEATURES: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly words: Words;
}> = [
  {
    id: "webhooks",
    name: "Webhooks",
    words: {
      on: "Workspace events can go to Slack, Teams or an address of your own.",
      off: "Webhooks can’t be added or changed: this Hub doesn’t run them.",
      newer: "Webhooks can’t be added until the Hub is updated.",
    },
  },
  {
    id: "slack",
    name: "Slack",
    words: {
      on: "Agents can ask people in Slack when they wait.",
      off: "Agents can’t ask people in Slack: this Hub doesn’t run it.",
      newer: "Agents can’t ask people in Slack until the Hub is updated.",
    },
  },
  {
    id: "requests",
    name: "Team requests",
    words: {
      on: "People can ask a teammate’s agent to take on a task.",
      off: "Team requests can’t be sent: this Hub doesn’t run them.",
      newer: "Team requests can’t be sent until the Hub is updated.",
    },
  },
  {
    id: "observe",
    name: "Observe",
    words: {
      on: "Teammates can watch a thread you share, live.",
      off: "Shared threads can’t be watched live: this Hub doesn’t run it.",
      newer: "Shared threads can’t be watched live until the Hub is updated.",
    },
  },
  {
    id: "knowledge",
    name: "Knowledge",
    words: {
      on: "What agents find becomes knowledge the team reviews and keeps.",
      off: "What agents find isn’t kept as team knowledge: this Hub doesn’t run it.",
      newer: "What agents find isn’t kept as team knowledge until the Hub is updated.",
    },
  },
  {
    id: "memory",
    name: "Memory",
    words: {
      on: "Projects can turn on Memory.",
      off: "This Hub was built without Memory, so projects can’t turn it on.",
      newer: "Projects can’t turn on Memory until the Hub is updated.",
    },
  },
  {
    id: "handoff",
    name: "Handoff for review",
    words: {
      on: "Agents can store a review package for a task.",
      off: "Review packages can’t be stored: this Hub doesn’t run it.",
      newer: "Review packages can’t be stored until the Hub is updated.",
    },
  },
  {
    id: "dependencies",
    name: "Task dependencies",
    words: {
      on: "Tasks can record what they depend on, and agents hear when it changes.",
      off: "Task dependencies can’t be recorded: this Hub doesn’t run them.",
      newer: "Task dependencies can’t be recorded until the Hub is updated.",
    },
  },
];

const stateOf = (plugin: PeerPluginState, settingsServed: boolean): FeatureState => {
  if (plugin.active) return "on";
  // The Hub does not serve it. One that serves settings is newer than every feature this app knows,
  // so it is the operator who turned the feature off; an older one has yet to be updated.
  if (plugin.reason === "hub") return settingsServed ? "off-hub" : "newer";
  return "off-here";
};

const OFF_HERE = "Turned off on this computer. Its owner turns it on in Coordination & plugins.";

function row(
  id: string,
  name: string,
  state: FeatureState,
  words: Words,
  plugin?: PeerPluginState,
): FeatureRow {
  const effect =
    state === "on"
      ? words.on
      : state === "off-hub"
        ? words.off
        : state === "newer"
          ? words.newer
          : ((plugin === undefined ? null : pluginLockNote(plugin)) ?? OFF_HERE);
  return { id, name, state, label: LABELS[state], effect };
}

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

/**
 * The features table. Coordination is the Hub's own and always on. The settings feature, and with it
 * path rules and GitHub's checks, are told from what the settings read says, which only a Hub with
 * settings gives; each other row is a plugin that needs a Hub feature, told from the plugin's state.
 */
export function hubFeatureRows(input: {
  readonly plugins: ReadonlyArray<PeerPluginState> | undefined;
  /** `GET /settings`' `features`; null while the settings cannot be read. */
  readonly flags: PeerSettingsView["features"] | null;
  /** The projects that have path rules, by name. */
  readonly pathRuleProjects: ReadonlyArray<string>;
}): ReadonlyArray<FeatureRow> {
  const plugins = input.plugins ?? [];
  const find = (id: string) => plugins.find((plugin) => plugin.id === id);
  const settings = find("settings");
  const settingsServed = settings?.active === true;
  const rows: FeatureRow[] = [
    row("coordination", "Coordination", "on", {
      on: "Agents check files with the Hub before they edit.",
      off: "",
      newer: "",
    }),
  ];
  if (settings !== undefined) {
    rows.push(
      row(
        "settings",
        "Workspace settings",
        stateOf(settings, settingsServed),
        {
          on: "Settings changed in the app are saved with their history and reviewed first.",
          off: "Settings can’t be changed in the app: this Hub doesn’t run them.",
          newer: "Settings can be read here but not changed until the Hub is updated.",
        },
        settings,
      ),
    );
  }
  if (settingsServed && input.flags !== null) {
    rows.push(
      input.flags.pathRules
        ? row("path-rules", "Path rules", "on", {
            on: "A project’s path rules decide what agents do for the files they name.",
            off: "",
            newer: "",
          })
        : {
            id: "path-rules",
            name: "Path rules",
            state: "off-hub",
            label: LABELS["off-hub"],
            effect: pathRulesOffEffect(input.pathRuleProjects),
          },
      row("github", "GitHub PR checks", input.flags.github ? "on" : "off-hub", {
        on: "GitHub’s word on a pull request can count over the agent’s report.",
        off: "Pull requests count as their agents report them: this Hub doesn’t check them with GitHub.",
        newer: "",
      }),
    );
  }
  for (const feature of PLUGIN_FEATURES) {
    const plugin = find(feature.id);
    if (plugin === undefined) continue;
    rows.push(
      row(feature.id, feature.name, stateOf(plugin, settingsServed), feature.words, plugin),
    );
  }
  return rows;
}

/** The line under the table, which explains the states that are in it. */
export function featuresFootnote(rows: ReadonlyArray<FeatureRow>): string {
  const base =
    "“Off on this Hub” is the operator’s choice. “Needs a newer Hub” goes away with an update.";
  return rows.some((feature) => feature.state === "off-here")
    ? `${base} “Off on this computer” is a choice made here, in Coordination & plugins.`
    : base;
}

/** The Hub's address as the page shows it: without `https://` and a closing slash. */
export function hubAddress(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.replace(/^https:\/\//i, "");
}
