import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { PeerMobilePlugin, WorkspaceSectionPlace } from "./slotTypes";

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

/** The workspace sections of the plugins that go at one place on the screen, in registry order. */
export function workspaceSectionsAt(
  plugins: ReadonlyArray<PeerMobilePlugin>,
  place: WorkspaceSectionPlace,
) {
  return plugins.flatMap((plugin) =>
    (plugin.workspaceSections ?? [])
      .filter((section) => section.place === place)
      .map((section) => ({ id: plugin.id, Component: section.Component })),
  );
}
