import { PeerMetricsStatus } from "./metrics.ts";
import { PeerHandoffStatus } from "./handoff.ts";
import { PeerResourcesState } from "./resources.ts";
import { PeerImpactStatus } from "./impact.ts";
import type * as Schema from "effect/Schema";

/**
 * The status fields of plugins that came after plugins, spread into `PeerHubStatus`. Each is
 * optional, named after its plugin's camel-cased id, defined in the plugin's `peer/<id>.ts`, and
 * omitted while the plugin is inactive. Plugins that existed before keep their old fields in
 * `peerHub.ts` instead; none is added here.
 */
import { PeerToolTrustStatus } from "./toolTrust.ts";
import { PeerAnnouncementsStatus } from "./announcements.ts";
import { PeerMcpStatus } from "./mcp.ts";
import * as SchemaValues from "effect/Schema";
import { PeerNeedsYouStatus } from "./needs-you.ts";
import { PeerDependencySnapshot } from "./dependencies.ts";
export const peerPluginStatusFields = {
  impact: SchemaValues.optional(PeerImpactStatus),
  resources: SchemaValues.optional(PeerResourcesState),
  needsYou: SchemaValues.optional(PeerNeedsYouStatus),
  metrics: SchemaValues.optional(PeerMetricsStatus),
  handoff: SchemaValues.optional(PeerHandoffStatus),
  dependencies: SchemaValues.optional(SchemaValues.Array(PeerDependencySnapshot)),
  toolTrust: SchemaValues.optional(PeerToolTrustStatus),
  announcements: SchemaValues.optional(PeerAnnouncementsStatus),
  mcp: SchemaValues.optional(PeerMcpStatus),
} satisfies Schema.Struct.Fields;
