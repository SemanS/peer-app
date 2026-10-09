import * as Schema from "effect/Schema";
export const PeerMcpStatus = Schema.Struct({
  enabled: Schema.Boolean,
  command: Schema.String,
  agents: Schema.Array(Schema.String),
});
export type PeerMcpStatus = typeof PeerMcpStatus.Type;
