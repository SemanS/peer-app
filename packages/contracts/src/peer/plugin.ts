import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Peer's optional plugins, in registry order. The server, web and mobile registries list them in
 * this order, and it fixes the order of their text for agents and of their UI.
 */
export const PEER_PLUGIN_IDS = [
  "herdr",
  "github",
  "capacity",
  "requests",
  "observe",
  "knowledge",
  "ask",
  "find",
  "memory",
] as const;
export const PeerPluginId = Schema.Literals(PEER_PLUGIN_IDS);
export type PeerPluginId = typeof PeerPluginId.Type;

/**
 * Why a plugin is inactive, as `PeerPluginState.reason` names it. The field is a plain string, so a
 * client decodes the status of a newer environment that names another reason; these are the
 * reasons environments name today.
 */
export const PEER_PLUGIN_REASONS = {
  /** Its owner turned it off on this environment. */
  off: "off",
  /** The signed-in Hub does not serve the feature it needs, at the revision it needs. */
  hub: "hub",
} as const;

/**
 * One plugin as an environment's status lists it. `id` and `reason` stay plain strings, so a client
 * decodes the status of an environment with plugins or reasons it does not know.
 */
export const PeerPluginState = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** The owner's choice on this environment, or the plugin's default. */
  enabled: Schema.Boolean,
  /** Turned on, and served by the signed-in Hub. */
  active: Schema.Boolean,
  /** Why it is inactive: one of `PEER_PLUGIN_REASONS`, or one a newer environment names. */
  reason: Schema.optional(Schema.String),
  /** Its last failed cleanup when turned off, or its last background failure. */
  error: Schema.optional(Schema.String),
});
export type PeerPluginState = typeof PeerPluginState.Type;

/** An owner turns one plugin on or off on this environment. */
export const PeerHubSetPluginInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type PeerHubSetPluginInput = typeof PeerHubSetPluginInput.Type;
