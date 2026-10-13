import { impactMobilePlugin } from "./impact";
import { plansMobilePlugin } from "./plans";
import { agreementsMobilePlugin } from "./agreements";
import { digestMobilePlugin } from "./digest";
import { recipesMobilePlugin } from "./recipes";

import { metricsMobilePlugin } from "./metrics";
import { needsYouMobilePlugin } from "./needs-you";
import { forecastMobilePlugin } from "./forecast";
import { handoffMobilePlugin } from "./handoff";
import { resourcesMobilePlugin } from "./resources";
import { dependenciesMobilePlugin } from "./dependencies";
/**
 * Slots for Peer plugins on mobile. The Peer workspaces screen and the Settings index render the
 * slots of the plugins that are active on the environment; a plugin that is off, absent or not
 * served by the Hub contributes nothing.
 *
 * A plugin's screens live in `features/peer/<id>/` and are listed once in `PEER_MOBILE_PLUGINS`,
 * in the order the server lists plugins: that order is the order on screen. The slot types are in
 * `slotTypes.ts`.
 */
import type { PeerHubStatus } from "@t3tools/contracts";
import { announcementsMobilePlugin } from "./announcements";
import { webhooksMobilePlugin } from "./webhooks";
import { slackMobilePlugin } from "./slack";

import { githubMobilePlugin } from "./github";
import { auditMobilePlugin } from "./audit";
import { herdrMobilePlugin } from "./herdr";
import { knowledgeMobilePlugin } from "./knowledge";
import { memoryMobilePlugin } from "./memory";
import { toolTrustMobilePlugin } from "./tool-trust";
import { mcpMobilePlugin } from "./mcp";
import { ownershipMobilePlugin } from "./ownership";
import { requestsMobilePlugin } from "./requests";
import type { PeerMobilePlugin } from "./slotTypes";
import { selectPeerPlugins } from "./slots.logic";

export type * from "./slotTypes";

/** Every plugin with a mobile screen, in the order the server lists plugins. */
export const PEER_MOBILE_PLUGINS: ReadonlyArray<PeerMobilePlugin> = [
  herdrMobilePlugin,
  githubMobilePlugin,
  dependenciesMobilePlugin,
  handoffMobilePlugin,
  requestsMobilePlugin,
  knowledgeMobilePlugin,
  memoryMobilePlugin,
  webhooksMobilePlugin,
  slackMobilePlugin,

  auditMobilePlugin,
  toolTrustMobilePlugin,
  mcpMobilePlugin,
  announcementsMobilePlugin,
  needsYouMobilePlugin,
  resourcesMobilePlugin,
  recipesMobilePlugin,
  forecastMobilePlugin,

  metricsMobilePlugin,
  digestMobilePlugin,
  impactMobilePlugin,
  ownershipMobilePlugin,
  plansMobilePlugin,
  agreementsMobilePlugin,
];

const selections = new Map<string, ReadonlyArray<PeerMobilePlugin>>();

/**
 * The plugins whose screens to show: those active on the environment. The same list, by identity,
 * comes back until a plugin turns on or off, so screens pass it down without re-rendering.
 */
export function usePeerMobilePlugins(
  status: PeerHubStatus | null,
): ReadonlyArray<PeerMobilePlugin> {
  const selected = selectPeerPlugins(PEER_MOBILE_PLUGINS, status);
  const key = selected.map((plugin) => plugin.id).join(",");
  const known = selections.get(key);
  if (known !== undefined) return known;
  selections.set(key, selected);
  return selected;
}
