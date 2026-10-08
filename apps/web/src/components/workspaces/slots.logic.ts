import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { PeerWebPlugin } from "./slots.types";

/**
 * The registry's plugins that are active on the environment, in registry order. A status without
 * a plugin list selects the features that existed before plugins; a plugin the status names but
 * the registry does not know is ignored.
 */
export function selectPeerPlugins<P extends { readonly id: string }>(
  registry: ReadonlyArray<P>,
  status: Pick<PeerHubStatus, "plugins"> | null,
): ReadonlyArray<P> {
  return registry.filter((plugin) => activePlugin(status, plugin.id));
}

/** Whether a colleague's shared thread can be watched here: Observe is among the active plugins. */
export function canWatchThreads(plugins: ReadonlyArray<{ readonly id: string }>): boolean {
  return plugins.some((plugin) => plugin.id === "observe");
}

/** What the plugins add to the Needs you count. */
export function needsYouCount(
  plugins: ReadonlyArray<PeerWebPlugin>,
  status: PeerHubStatus,
): number {
  return plugins.reduce((total, plugin) => total + (plugin.needsYou?.count?.(status) ?? 0), 0);
}

const NOTHING_NEEDS_YOU = "Nothing needs you right now.";

/** What an empty Needs you says: the first plugin with something to add, else the plain line. */
export function needsYouEmptyText(
  plugins: ReadonlyArray<PeerWebPlugin>,
  status: PeerHubStatus | null,
  running: number,
): string {
  if (status !== null) {
    for (const plugin of plugins) {
      const text = plugin.needsYou?.emptyText?.(status, { running });
      if (text !== undefined && text !== null) return text;
    }
  }
  return NOTHING_NEEDS_YOU;
}
