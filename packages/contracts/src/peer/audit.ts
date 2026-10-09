import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";
export const PeerAuditEntry = Schema.Struct({
  seq: Schema.Number,
  at: Schema.String,
  kind: Schema.String,
  actor: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("person"),
      email: Schema.String,
      session: Schema.String,
      signedInAt: Schema.String,
    }),
    Schema.Struct({ type: Schema.Literal("hub") }),
  ]),
  subject: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  details: Schema.Record(Schema.String, Schema.Unknown),
});
export type PeerAuditEntry = typeof PeerAuditEntry.Type;
export const PeerAuditPage = Schema.Struct({
  entries: Schema.Array(PeerAuditEntry),
  next: Schema.optional(Schema.NullOr(Schema.Number)),
  unsupported: Schema.optional(Schema.Boolean),
});
export type PeerAuditPage = typeof PeerAuditPage.Type;
export const PeerAuditListInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  kinds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  member: Schema.optional(TrimmedNonEmptyString),
  project: Schema.optional(TrimmedNonEmptyString),
  before: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 200 })),
  ),
});
export type PeerAuditListInput = typeof PeerAuditListInput.Type;
