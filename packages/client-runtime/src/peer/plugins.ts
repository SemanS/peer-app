import {
  AuthAccessWriteScope,
  PEER_MEMORY_AVAILABLE,
  type AuthSessionState,
  type PeerHubStatus,
  type PeerPluginId,
} from "@t3tools/contracts";

/**
 * The features that existed before plugins. An environment that sends no plugin list (an older one,
 * or one with no plugin registered yet) runs all of them, so a client shows them as before.
 */
const PRE_PLUGIN_FEATURES: ReadonlySet<string> = new Set<PeerPluginId>([
  "herdr",
  "github",
  "capacity",
  "requests",
  "observe",
  "knowledge",
  "ask",
  "find",
  "memory",
]);

type StatusPlugins = Pick<PeerHubStatus, "plugins">;

/**
 * Whether a client shows the plugin's UI: it is active on this environment. A status without a
 * plugin list, or with an empty one, counts the pre-plugin features as active. Memory stays hidden
 * while the build excludes it, whatever the environment says.
 */
export function activePlugin(status: StatusPlugins | null | undefined, id: string): boolean {
  if (status === null || status === undefined) return false;
  if (id === "memory" && !PEER_MEMORY_AVAILABLE) return false;
  const plugins = status.plugins;
  if (plugins === undefined || plugins.length === 0) return PRE_PLUGIN_FEATURES.has(id);
  return plugins.some((plugin) => plugin.id === id && plugin.active);
}

/** Why an inactive plugin is inactive: turned off here, the Hub lacks its feature, or not built in. */
export type InactivePluginReason = "off" | "hub" | "missing";

/** The reason a plugin is not active, or null while it is. */
export function inactivePluginReason(
  status: StatusPlugins | null | undefined,
  id: string,
): InactivePluginReason | null {
  if (activePlugin(status, id)) return null;
  const state = status?.plugins?.find((plugin) => plugin.id === id);
  if (state === undefined) return "missing";
  return state.enabled ? "hub" : "off";
}

/** Only an owner of the environment, a session with access-write, turns plugins on or off. */
export function canChangePeerPlugins(
  session: Pick<AuthSessionState, "authenticated" | "scopes"> | null | undefined,
): boolean {
  return session?.authenticated === true && session.scopes?.includes(AuthAccessWriteScope) === true;
}
