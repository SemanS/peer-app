/**
 * The rows of Settings › Overview and what they share: a row is one thing Peer connects to, with
 * its status in the status language, what is left to do, and the page where that is done. Pure,
 * so the rows can be built from facts and tested without a screen.
 */
import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { PeerSettingsLocation } from "../workspaces/settings/peerSettings.logic";
import { CHECKING, isUnderway, type ConnectionView } from "./connectionFacts";
import { CONNECTION_STATE_LABEL, connectionNeedsAttention } from "./connectionStatus.logic";
import type { SettingsPath } from "./settingsSearch";

export type OverviewGroupId = "workspace" | "me" | "computer";

/** Where a row's action goes: a page of Peer's area (and the part of it), or a settings page. */
export type OverviewTarget =
  | {
      readonly kind: "peer";
      readonly location: PeerSettingsLocation;
      /** The part of the page to scroll to. */
      readonly targetId?: string;
    }
  | { readonly kind: "settings"; readonly to: SettingsPath; readonly targetId?: string };

export interface OverviewAction {
  readonly label: string;
  readonly target: OverviewTarget;
}

export interface OverviewRow {
  readonly id: string;
  readonly group: OverviewGroupId;
  /** What the list calls it: "Slack conversations". */
  readonly name: string;
  /** What a sentence calls it: "Slack for Webinson". */
  readonly subject: string;
  readonly connection: ConnectionView;
  /** The account the detail is about (a hosting tool's), shown hidden until revealed. */
  readonly account: string | null;
  readonly action: OverviewAction | null;
  /** What it means for the people until it is done: "Until then agents ask only in Peer." */
  readonly consequence: string | null;
  /** In the "Needs attention" filter: it Needs setup or has a Problem. */
  readonly attention: boolean;
  /** Counts as "to finish": a setup with a step left, or a connection that broke. */
  readonly underway: boolean;
  /** What a search result shows beside the title when the row needs attention: "Needs setup". */
  readonly badge: string | null;
}

export function overviewRow(input: {
  readonly id: string;
  readonly group: OverviewGroupId;
  readonly name: string;
  readonly subject?: string;
  readonly connection: ConnectionView;
  readonly account?: string | null;
  readonly action?: OverviewAction | null;
  readonly consequence?: string;
  /** Replaces the badge the state would give ("2 detected"). */
  readonly badge?: string;
}): OverviewRow {
  const attention = connectionNeedsAttention(input.connection.state);
  return {
    id: input.id,
    group: input.group,
    name: input.name,
    subject: input.subject ?? input.name,
    connection: input.connection,
    account: input.account ?? null,
    action: input.action ?? null,
    consequence: input.consequence ?? null,
    attention,
    underway: isUnderway(input.connection),
    badge: attention
      ? (input.badge ?? input.connection.label ?? CONNECTION_STATE_LABEL[input.connection.state])
      : null,
  };
}

/**
 * The action a row offers by where it stands: the setup it continues, the problem it fixes, else
 * the page by its name. A feature the Hub cannot do offers none. `off` replaces the page's name
 * where turning it on is the thing to do ("Turn on", "Set up").
 */
export function actionFor(
  connection: ConnectionView,
  target: OverviewTarget,
  page: string,
  labels: { readonly off?: string } = {},
): OverviewAction | null {
  switch (connection.state) {
    case "unavailable":
      return null;
    case "setup":
      return { label: connection.step === undefined ? page : "Continue setup", target };
    case "problem":
      return { label: "Fix", target };
    case "off":
      return { label: connection.label === undefined ? (labels.off ?? page) : page, target };
    case "connected":
      return { label: page, target };
  }
}

/** What a feature's plugin lets a row say. */
export type PluginGate =
  | { readonly kind: "open" }
  /** Turned off here, forced off or not built: its rows are not listed. */
  | { readonly kind: "hidden" }
  /** The Hub cannot serve it yet, or no Hub has answered: the row says so. */
  | { readonly kind: "view"; readonly view: ConnectionView };

const OPEN: PluginGate = { kind: "open" };
const HIDDEN: PluginGate = { kind: "hidden" };

export function pluginGate(
  status: Pick<PeerHubStatus, "plugins"> & { readonly signedIn?: boolean },
  plugin: string,
  title: string,
): PluginGate {
  switch (inactivePluginReason(status, plugin)) {
    case null:
      return OPEN;
    case "off":
    case "locked":
    case "missing":
      return HIDDEN;
    case "hub":
      return {
        kind: "view",
        view: { state: "unavailable", detail: `This Peer Hub has no ${title} support yet.` },
      };
    case "waiting":
      return { kind: "view", view: CHECKING };
  }
}
