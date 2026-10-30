import { impactWebPlugin } from "./impact";
import { plansWebPlugin } from "./plans";
import { agreementsWebPlugin } from "./agreements";
import { changesWebPlugin } from "./changes";
import { digestWebPlugin } from "./digest";
import { recipesWebPlugin } from "./recipes";
import { openspecWebPlugin } from "./openspec";

import { metricsWebPlugin } from "./metrics";
import { handoffWebPlugin } from "./handoff";
import { forecastWebPlugin } from "./forecast";
import { needsYouWebPlugin } from "./needs-you";
import { settleWebPlugin } from "./settle";
import { resourcesWebPlugin } from "./resources";
import { dependenciesWebPlugin } from "./dependencies";
import { ownershipWebPlugin } from "./ownership";
import { rolesWebPlugin } from "./roles";
import { roomsWebPlugin } from "./rooms";
import { testReportsWebPlugin } from "./test-reports";
import { acceptanceWebPlugin } from "./acceptance";
/**
 * Slots for Peer plugins in the web UI. Core views (Work, Needs you, the context pages, Settings →
 * Peer and the command palette) render the slots of the plugins that are active on the
 * environment; a plugin that is off, absent or not served by the Hub contributes nothing.
 *
 * A plugin's UI lives in `workspaces/<id>/` and is listed once in `PEER_WEB_PLUGINS`, in the order
 * the server lists plugins: that order is the order on screen. Slot components get their data from
 * their props, never from a subscription of their own per row. The slot types are in
 * `slots.types.ts`.
 */
import type { PeerHubStatus } from "@t3tools/contracts";
import { announcementsWebPlugin } from "./announcements";
import { slackWebPlugin } from "./slack";
import { settingsWebPlugin } from "./settings";

import { auditWebPlugin } from "./audit";
import { capacityWebPlugin } from "./capacity";
import { githubWebPlugin } from "./github";
import { herdrWebPlugin } from "./herdr";
import { jujutsuWebPlugin } from "./jujutsu";
import { knowledgeWebPlugin } from "./knowledge";
import { memoryWebPlugin } from "./memory";
import { observeWebPlugin } from "./observe";
import { toolTrustWebPlugin } from "./tool-trust";
import { mcpWebPlugin } from "./mcp";
import { requestsWebPlugin } from "./requests";
import { selectPeerPlugins } from "./slots.logic";
import type { PeerWebPlugin } from "./slots.types";

export type * from "./slots.types";

/** Every plugin with web UI, in the order the server lists plugins. */
export const PEER_WEB_PLUGINS: ReadonlyArray<PeerWebPlugin> = [
  herdrWebPlugin,
  jujutsuWebPlugin,
  githubWebPlugin,
  dependenciesWebPlugin,
  handoffWebPlugin,
  capacityWebPlugin,
  requestsWebPlugin,
  observeWebPlugin,
  knowledgeWebPlugin,
  memoryWebPlugin,
  slackWebPlugin,

  auditWebPlugin,
  toolTrustWebPlugin,
  mcpWebPlugin,
  announcementsWebPlugin,
  needsYouWebPlugin,
  settleWebPlugin,
  resourcesWebPlugin,
  recipesWebPlugin,
  forecastWebPlugin,

  metricsWebPlugin,
  digestWebPlugin,
  impactWebPlugin,
  ownershipWebPlugin,
  plansWebPlugin,
  agreementsWebPlugin,
  changesWebPlugin,
  openspecWebPlugin,
  testReportsWebPlugin,
  rolesWebPlugin,
  roomsWebPlugin,
  acceptanceWebPlugin,
  settingsWebPlugin,
];

const selections = new Map<string, ReadonlyArray<PeerWebPlugin>>();

/**
 * The plugins whose UI to show: those active on the environment. The same list, by identity, comes
 * back until a plugin turns on or off, not with every status, so views pass it down without
 * re-rendering. At most one list exists per combination of plugins.
 */
export function usePeerPlugins(
  status: Pick<PeerHubStatus, "plugins"> | null,
): ReadonlyArray<PeerWebPlugin> {
  const selected = selectPeerPlugins(PEER_WEB_PLUGINS, status);
  const key = selected.map((plugin) => plugin.id).join(",");
  const known = selections.get(key);
  if (known !== undefined) return known;
  selections.set(key, selected);
  return selected;
}
