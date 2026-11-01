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
 * what the workspace still has to do for GitHub's checks), its operator turned it off or
 * the Hub is too old (Not available), or this computer's owner turned its plugin off (Off).
 */
import { hubFeatureState, pluginLockNote } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubInfo, PeerPluginState } from "@t3tools/contracts";

import {
  CONNECTION_STATE_LABEL,
  type ConnectionState,
} from "../../settings/connectionStatus.logic";

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
  /** The badge's word: "Connected", "Not available", "Off". */
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
}

/** What tells the state of a Hub that sends no catalog, if anything does. */
type Without = "plugin" | "nothing";

interface Feature {
  /** The Hub's id for it, which is its plugin's too. */
  readonly id: string;
  readonly name: string;
  readonly words: Words;
  /**
   * The plugin's state (it needs this Hub feature), or nothing: a feature no plugin of the app
   * waits for says nothing of an older Hub.
   */
  readonly without: Without;
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
    id: "observe",
    name: "Observe",
    without: "plugin",
    words: {
      on: "Teammates can watch a thread you share, live.",
      off: "Shared threads can’t be watched live: this Hub doesn’t run it.",
      newer: "Shared threads can’t be watched live until the Hub is updated.",
    },
  },
];

const KNOWN: ReadonlySet<string> = new Set(FEATURES.map((feature) => feature.id));

const OFF_HERE = "Turned off on this computer. Its owner turns it on in Plugins.";

interface Context {
  readonly plugins: ReadonlyArray<PeerPluginState>;
  readonly hub: PeerHubInfo | undefined;
  readonly settingsServed: boolean;
}

/**
 * Where a feature stands, from the catalog where the Hub sent one. Without it the plugin's state
 * tells (the Hub does not serve a feature its plugin needs, and an older Hub is not the one that
 * turned it off); undefined where nothing does, so there is no row.
 */
function stateOf(feature: Feature, context: Context): FeatureState | undefined {
  const plugin = context.plugins.find((candidate) => candidate.id === feature.id);
  const listed = hubFeatureState({ hub: context.hub }, feature.id);
  if (listed !== undefined) {
    // The Hub serves it, but not at the revision the plugin needs.
    if (listed === "on") return plugin?.reason === "hub" ? "newer" : "on";
    if (listed === "off") return "off-hub";
    return "newer";
  }
  switch (feature.without) {
    case "plugin":
      if (plugin === undefined) return undefined;
      if (plugin.active) return "on";
      // The Hub does not serve it. One that serves settings is newer than every feature this app
      // knows, so it is the operator who turned the feature off; an older one has yet to be updated.
      if (plugin.reason === "hub") return context.settingsServed ? "off-hub" : "newer";
      return "off-here";
    case "nothing":
      return undefined;
  }
}

function effectOf(
  feature: Feature,
  state: FeatureState,
  plugin: PeerPluginState | undefined,
): string {
  switch (state) {
    case "on":
      return feature.words.on;
    case "newer":
      return feature.words.newer;
    case "off-hub":
      return feature.words.off;
    case "off-here":
      return (plugin === undefined ? null : pluginLockNote(plugin)) ?? OFF_HERE;
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

/**
 * The features table. Coordination is the Hub's own and always on. Each other feature of the Hub is
 * on, off on this Hub or waiting for a newer one, as the Hub's catalog says (`hub`), with the ones
 * it serves or turned off that this app does not know after them; for a Hub that sends no catalog
 * the plugins tell what they can, as `stateOf` says.
 */
export function hubFeatureRows(input: {
  readonly plugins: ReadonlyArray<PeerPluginState> | undefined;
  /** What the Hub said of itself in `/v1/me`; undefined from one that says nothing. */
  readonly hub: PeerHubInfo | undefined;
}): ReadonlyArray<FeatureRow> {
  const plugins = input.plugins ?? [];
  const context: Context = {
    plugins,
    hub: input.hub,
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
    rows.push({
      id: feature.id,
      name: feature.name,
      state,
      connection: CONNECTION[state],
      label: CONNECTION_STATE_LABEL[CONNECTION[state]],
      effect: effectOf(feature, state, plugin),
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
    ? `${base} “Off” is a choice made on this computer, in Plugins.`
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
