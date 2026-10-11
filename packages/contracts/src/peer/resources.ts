import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";

export const PeerResourceHolder = Schema.Struct({
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
});
/** The intent route's flat holder detail also applies to unleased path claims. */
export const PeerIntentHold = Schema.Struct({
  ...PeerResourceHolder.fields,
  intent: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
});
export const PeerHeldResource = Schema.Struct({
  project: Schema.String,
  kind: Schema.Literals(["resource", "pattern"]),
  name: Schema.String,
  holder: PeerResourceHolder,
  intent: Schema.optional(Schema.String),
  expiresAt: Schema.String,
});
export type PeerHeldResource = typeof PeerHeldResource.Type;
export const PeerPathPattern = Schema.Struct({
  pattern: Schema.String,
  policy: Schema.Literals(["notify", "coordinate", "ask", "exclusive"]),
});
export type PeerPathPattern = typeof PeerPathPattern.Type;
export const PeerResourcesList = Schema.Struct({
  held: Schema.Array(PeerHeldResource),
  patterns: Schema.Record(Schema.String, Schema.Array(PeerPathPattern)),
  at: Schema.String,
});
export type PeerResourcesList = typeof PeerResourcesList.Type;
/** The snapshot has no patterns or reasons beyond the bounded Hub list, and never session text. */
export const PeerResourcesState = Schema.Struct({
  held: Schema.Array(
    Schema.Struct({
      workspace: Schema.String,
      ...PeerHeldResource.fields,
      at: Schema.String,
    }),
  ),
  /**
   * How many path rules each project has as the Hub lists them: counts, never patterns. A project
   * without rules is not listed, and neither is anything while the Hub lists none.
   */
  pathRules: Schema.optional(
    Schema.Array(
      Schema.Struct({
        workspace: Schema.String,
        project: Schema.String,
        count: Schema.Number,
      }),
    ),
  ),
});
export type PeerResourcesState = typeof PeerResourcesState.Type;
export const PeerResourceReleaseInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  target: TrimmedNonEmptyString,
  op: Schema.optional(TrimmedNonEmptyString),
});
export type PeerResourceReleaseInput = typeof PeerResourceReleaseInput.Type;
export const PeerResourceReleaseResult = Schema.Struct({
  released: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(["not_held", "held_by_other"])),
  resource: Schema.optional(PeerHeldResource),
  at: Schema.String,
});
export const PeerResourceClaimResult = Schema.Struct({
  verdict: Schema.Literals(["clear", "held"]),
  resource: PeerHeldResource,
  at: Schema.String,
});
export const PEER_RESOURCES_PLUGIN = {
  id: "resources",
  title: "Resource claims",
  summary: "Leased resources and project path policies.",
  defaultEnabled: true,
} as const;
