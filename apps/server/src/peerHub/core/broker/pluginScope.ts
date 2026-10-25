import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import type { PeerBrokerPlugins } from "./host.ts";

/** A signed-in account does not enroll local projects in the Hub's plugins. */
export function pluginsForWorkspace(
  plugins: PeerBrokerPlugins,
  workspace: string,
): PeerBrokerPlugins {
  if (workspace !== PEER_LOCAL_WORKSPACE) return plugins;
  const remote = new Set<string>(
    plugins.active.filter((plugin) => plugin.requiresHub).map((plugin) => plugin.id),
  );
  const active = plugins.active.filter((plugin) => !remote.has(plugin.id));
  return {
    ...plugins,
    active,
    commands: plugins.commands.map((entry) =>
      remote.has(entry.plugin)
        ? {
            ...entry,
            refused: "hub" as const,
            unserved:
              "This command needs a shared Hub project. Local coordination stays available.",
          }
        : entry,
    ),
    reportSessions: plugins.reportSessions.filter((entry) => !remote.has(entry.plugin)),
    runtime: active.find((plugin) => plugin.contributions.runtime !== undefined)?.contributions
      .runtime,
    indexSource: active.find((plugin) => plugin.contributions.indexSource !== undefined)
      ?.contributions.indexSource,
  };
}
