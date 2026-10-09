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
import { webhooksMobilePlugin } from "./webhooks";

import { githubMobilePlugin } from "./github";
import { auditMobilePlugin } from "./audit";
import { herdrMobilePlugin } from "./herdr";
import { memoryMobilePlugin } from "./memory";
import { toolTrustMobilePlugin } from "./tool-trust";
import { requestsMobilePlugin } from "./requests";
import type { PeerMobilePlugin } from "./slotTypes";
import { selectPeerPlugins } from "./slots.logic";

export type * from "./slotTypes";

/** Every plugin with a mobile screen, in the order the server lists plugins. */
export const PEER_MOBILE_PLUGINS: ReadonlyArray<PeerMobilePlugin> = [
  herdrMobilePlugin,
  githubMobilePlugin,
  requestsMobilePlugin,
  memoryMobilePlugin,
  webhooksMobilePlugin,

  auditMobilePlugin,
  toolTrustMobilePlugin,
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
