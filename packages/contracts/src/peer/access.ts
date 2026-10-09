import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";

const Role = Schema.Literals(["owner", "admin", "member"]);
export const PeerRemovedWorkspace = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  removedAt: Schema.String,
});
export const PeerSharedKey = Schema.Struct({
  project: Schema.String,
  environment: Schema.String,
  keyRef: Schema.String,
  issuedAt: Schema.String,
  expiresAt: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PeerSharedKey = typeof PeerSharedKey.Type;
export const PeerWorkspaceMembers = Schema.Struct({
  members: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      name: Schema.optional(Schema.NullOr(Schema.String)),
      role: Role,
      joinedAt: Schema.optional(Schema.String),
      keys: Schema.optional(Schema.Number),
      pendingRevocations: Schema.optional(Schema.Number),
    }),
  ),
  invites: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      role: Role,
      invitedBy: Schema.optional(Schema.String),
      invitedAt: Schema.optional(Schema.String),
    }),
  ),
  removed: Schema.optional(
    Schema.Array(
      Schema.Struct({
        email: Schema.String,
        role: Role,
        name: Schema.optional(Schema.NullOr(Schema.String)),
        removedAt: Schema.String,
        invited: Schema.optional(Schema.Boolean),
        keys: Schema.optional(Schema.Number),
        pendingRevocations: Schema.optional(Schema.Number),
      }),
    ),
  ),
  pendingRevocations: Schema.optional(
    Schema.Struct({
      count: Schema.Number,
      lastError: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
export type PeerWorkspaceMembers = typeof PeerWorkspaceMembers.Type;
export const PeerRemovalPlan = Schema.Union([
  Schema.Struct({ unsupported: Schema.Literal(true) }),
  Schema.Struct({
    email: Schema.String,
    role: Role,
    keys: Schema.Number,
    invites: Schema.optional(Schema.Number),
    projects: Schema.Array(Schema.String),
    canRemove: Schema.Boolean,
    reason: Schema.optional(Schema.String),
  }),
]);
export type PeerRemovalPlan = typeof PeerRemovalPlan.Type;
export const PeerMemberKeys = Schema.Struct({
  email: Schema.String,
  keys: Schema.Array(
    Schema.Struct({ ...PeerSharedKey.fields, replaced: Schema.optional(Schema.Boolean) }),
  ),
  pending: Schema.Array(
    Schema.Struct({
      keyRef: Schema.String,
      project: Schema.String,
      environment: Schema.String,
      reason: Schema.String,
      queuedAt: Schema.String,
      attempts: Schema.Number,
      lastError: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
export type PeerMemberKeys = typeof PeerMemberKeys.Type;
export const PeerHubMemberInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
});
export type PeerHubMemberInput = typeof PeerHubMemberInput.Type;
export const PeerHubMemberRoleInput = Schema.Struct({ ...PeerHubMemberInput.fields, role: Role });
export type PeerHubMemberRoleInput = typeof PeerHubMemberRoleInput.Type;
export const PeerHubMemberKeysInput = Schema.Struct({
  ...PeerHubMemberInput.fields,
  project: Schema.optional(TrimmedNonEmptyString),
  environment: Schema.optional(TrimmedNonEmptyString),
});
export type PeerHubMemberKeysInput = typeof PeerHubMemberKeysInput.Type;
