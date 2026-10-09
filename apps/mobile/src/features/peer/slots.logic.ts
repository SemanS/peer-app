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

/**
 * The workspace sections of the plugins that go at one place on the screen, in registry order, each
 * with a key that is its own even when a plugin has several sections.
 */
export function workspaceSectionsAt(
  plugins: ReadonlyArray<PeerMobilePlugin>,
  place: WorkspaceSectionPlace,
) {
  return plugins.flatMap((plugin) =>
    (plugin.workspaceSections ?? []).flatMap((section, index) =>
      section.place === place
        ? [{ key: `${plugin.id}:${index}`, Component: section.Component }]
        : [],
    ),
  );
}

/** Registered inactive features can explain their state at either workspace section place. */
export function alwaysWorkspaceSectionsAt(
  registry: ReadonlyArray<PeerMobilePlugin>,
  status: Pick<PeerHubStatus, "plugins"> | null,
  place: WorkspaceSectionPlace,
) {
  return registry.flatMap((plugin) =>
    (plugin.alwaysWorkspaceSections ?? []).flatMap((section) =>
      section.place === place && status?.plugins?.some((known) => known.id === plugin.id)
        ? [{ key: `always:${plugin.id}:${section.key}`, Component: section.Component }]
        : [],
    ),
  );
}
