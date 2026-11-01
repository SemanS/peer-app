import { PeerChangesStatus } from "./changes.ts";
import { JujutsuState } from "./jujutsu.ts";
import type * as Schema from "effect/Schema";

/**
 * The status fields of plugins that came after plugins, spread into `PeerHubStatus`. Each is
 * optional, named after its plugin's camel-cased id, defined in the plugin's `peer/<id>.ts`, and
 * omitted while the plugin is inactive. Plugins that existed before keep their old fields in
 * `peerHub.ts` instead; none is added here.
 */
import { PeerToolTrustStatus } from "./toolTrust.ts";
import { PeerMcpStatus } from "./mcp.ts";
import { PeerHerdrStatus } from "./herdr.ts";
import * as SchemaValues from "effect/Schema";
import { PeerSettingsStatus } from "./settings.ts";
import { PeerRoomsStatus } from "./rooms.ts";
/** The schemas of these plugins reach the package index through here. */
export * from "./changes.ts";
export * from "./jujutsu.ts";
export * from "./rooms.ts";

export const peerPluginStatusFields = {
  changes: SchemaValues.optional(PeerChangesStatus),
  toolTrust: SchemaValues.optional(PeerToolTrustStatus),
  mcp: SchemaValues.optional(PeerMcpStatus),
  herdr: SchemaValues.optional(PeerHerdrStatus),
  jujutsu: SchemaValues.optional(JujutsuState),
  settings: SchemaValues.optional(PeerSettingsStatus),
  rooms: SchemaValues.optional(PeerRoomsStatus),
} satisfies Schema.Struct.Fields;
