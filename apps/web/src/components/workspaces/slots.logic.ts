import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus } from "@t3tools/contracts";

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
