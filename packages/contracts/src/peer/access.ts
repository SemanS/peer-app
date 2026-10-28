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
/**
 * What became of an invitation's email. `state` is `sent`, `failed` or `skipped` (the Hub only logs
 * mail, or the invite predates delivery); an open string so a newer Hub's state still decodes.
 */
export const PeerInvitationDelivery = Schema.Struct({
  state: Schema.String,
  attempts: Schema.optional(Schema.Number),
  lastAttemptAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** The mail service's words when the last attempt failed. */
  error: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PeerInvitationDelivery = typeof PeerInvitationDelivery.Type;

/**
 * An invitation as admins see it. A Hub from before invitations had a lifecycle sends only the
 * address, role and who invited when: everything else is optional, and `status` is an open string
 * (`pending`, `accepted`, `expired`, `revoked`) a client reads through `invitationStatus`.
 */
export const PeerInvitation = Schema.Struct({
  email: Schema.String,
  role: Role,
  invitedBy: Schema.optional(Schema.String),
  invitedAt: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
  delivery: Schema.optional(PeerInvitationDelivery),
  projects: Schema.optional(Schema.Array(Schema.String)),
  /** When an accepted or revoked invitation ended, and who ended it. */
  at: Schema.optional(Schema.NullOr(Schema.String)),
  by: Schema.optional(Schema.NullOr(Schema.String)),
  /** It brings back an address an admin removed. */
  readmits: Schema.optional(Schema.Boolean),
  /** The emailed link; only from a Hub that echoes mail (local runs and tests). */
  link: Schema.optional(Schema.String),
});
export type PeerInvitation = typeof PeerInvitation.Type;

/** A workspace's invitations: the pending ones (expired too) and those that ended recently. */
export const PeerInvitationList = Schema.Struct({ invitations: Schema.Array(PeerInvitation) });
export type PeerInvitationList = typeof PeerInvitationList.Type;

/** What inviting an address would reach, before the invitation is sent. */
export const PeerInvitePreview = Schema.Struct({
  email: Schema.String,
  /** Projects the person works in once they join: open to every member, or naming them already. */
  openProjects: Schema.Array(Schema.String),
  /** Projects that need the person added to them. */
  restrictedProjects: Schema.Array(Schema.String),
  capacity: Schema.Struct({
    /** Null when nothing limits the workspace. */
    memberLimit: Schema.NullOr(Schema.Number),
    members: Schema.Number,
    /** Invitations to other addresses that still admit. */
    pending: Schema.Number,
  }),
  /** Members and pending invitations, this one included, would be more than the limit. */
  wouldExceed: Schema.Boolean,
  alreadyMember: Schema.Boolean,
  readmits: Schema.Boolean,
});
export type PeerInvitePreview = typeof PeerInvitePreview.Type;

/**
 * An organization a hub administrator founded for the signed-in address, waiting for them to accept
 * it as its owner. Only `slug` and `name` are sure to be there.
 */
export const PeerFounding = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  /** The hub administrator who founded it. */
  initiatedBy: Schema.optional(Schema.String),
  initiatedAt: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
  /** Past `expiresAt`: it still reserves its name, but the Hub's administrator must send it again. */
  expired: Schema.optional(Schema.Boolean),
});
export type PeerFounding = typeof PeerFounding.Type;

export const PeerHubFoundingInput = Schema.Struct({ slug: TrimmedNonEmptyString });
export type PeerHubFoundingInput = typeof PeerHubFoundingInput.Type;

export const PeerWorkspaceMembers = Schema.Struct({
  members: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      name: Schema.optional(Schema.NullOr(Schema.String)),
      role: Role,
      joinedAt: Schema.optional(Schema.String),
      /**
       * The projects a member joined through an invitation that named them is on, and no other;
       * null or absent for a member without a limit (and from a Hub from before limits).
       */
      projects: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
      keys: Schema.optional(Schema.Number),
      pendingRevocations: Schema.optional(Schema.Number),
    }),
  ),
  /** The pending invitations; a newer Hub adds their status, expiry and delivery. */
  invites: Schema.Array(PeerInvitation),
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
