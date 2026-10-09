import type * as Schema from "effect/Schema";

/**
 * The status fields of plugins that came after plugins, spread into `PeerHubStatus`. Each is
 * optional, named after its plugin's camel-cased id, defined in the plugin's `peer/<id>.ts`, and
 * omitted while the plugin is inactive. Plugins that existed before keep their old fields in
 * `peerHub.ts` instead; none is added here.
 */
import { PeerToolTrustStatus } from "./toolTrust.ts";
import { PeerAnnouncementsStatus } from "./announcements.ts";
import * as SchemaValues from "effect/Schema";
export const peerPluginStatusFields = {
  toolTrust: SchemaValues.optional(PeerToolTrustStatus),
  announcements: SchemaValues.optional(PeerAnnouncementsStatus),
} satisfies Schema.Struct.Fields;
