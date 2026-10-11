import {
  AuthAccessWriteScope,
  PEER_MEMORY_AVAILABLE,
  type AuthSessionState,
  type PeerHubStatus,
  type PeerPluginId,
  type PeerPluginState,
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

/** An operator's forced-off choice stays visible and explains why its switch is locked. */
export const pluginLockNote = (plugin: PeerPluginState) =>
  plugin.locked === true ? `Forced off by ${plugin.reason ?? "the environment operator"}.` : null;

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
export type InactivePluginReason = "off" | "hub" | "missing" | "locked";

/**
 * The reason a plugin is not active, or null while it is. Memory is never there to turn on while
 * the build excludes it, whatever the environment lists.
 */
export function inactivePluginReason(
  status: StatusPlugins | null | undefined,
  id: string,
): InactivePluginReason | null {
  if (activePlugin(status, id)) return null;
  if (id === "memory" && !PEER_MEMORY_AVAILABLE) return "missing";
  const state = status?.plugins?.find((plugin) => plugin.id === id);
  if (state === undefined) return "missing";
  if (state.locked === true) return "locked";
  return state.enabled ? "hub" : "off";
}

/** Where the signed-in Hub stands on one of its features. */
export type HubFeatureState = "on" | "off" | "newer";

/**
 * Where the signed-in Hub stands on the feature `id`, from what it said of itself in `/v1/me`
 * (`status.hub`): `on` while it serves the feature at `revision` or a later one, `off` while its
 * operator turned it off, `newer` while it does neither, which an update fixes. A plugin's id is
 * its Hub feature's. Undefined where the Hub does not say enough: it sent no catalog, or one
 * without the list of what is off, so "turned off" and "needs a newer Hub" cannot be told apart.
 */
export function hubFeatureState(
  status: Pick<PeerHubStatus, "hub"> | null | undefined,
  id: string,
  revision = 1,
): HubFeatureState | undefined {
  const hub = status?.hub;
  if (hub?.features !== undefined && (hub.features[id] ?? 0) >= revision) return "on";
  if (hub?.featuresOff?.includes(id) === true) return "off";
  return hub?.features === undefined || hub.featuresOff === undefined ? undefined : "newer";
}

/** Only an owner of the environment, a session with access-write, turns plugins on or off. */
export function canChangePeerPlugins(
  session: Pick<AuthSessionState, "authenticated" | "scopes"> | null | undefined,
): boolean {
  return session?.authenticated === true && session.scopes?.includes(AuthAccessWriteScope) === true;
}
