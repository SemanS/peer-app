import * as Schema from "effect/Schema";

/** Signed delivery facts; the owning Peer still reports its own state separately. */
export const PeerGitHubEvidence = Schema.Struct({
  state: Schema.Literals(["open", "closed", "merged"]),
  headBranch: Schema.String,
  baseBranch: Schema.String,
  updatedAt: Schema.String,
  verifiedAt: Schema.String,
  mergedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.String),
  mergeCommit: Schema.optional(Schema.String),
});
export type PeerGitHubEvidence = typeof PeerGitHubEvidence.Type;
export const PeerGitHubVerification = Schema.Struct({
  workspace: Schema.String,
  configured: Schema.Boolean,
  unsupported: Schema.optional(Schema.Boolean),
  lastVerifiedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PeerGitHubVerification = typeof PeerGitHubVerification.Type;
export const PeerGitHubStatus = Schema.Struct({
  configured: Schema.Boolean,
  unsupported: Schema.optional(Schema.Boolean),
  webhookPath: Schema.String,
  webhookUrl: Schema.optional(Schema.String),
  lastPingAt: Schema.NullOr(Schema.String),
  lastVerifiedAt: Schema.NullOr(Schema.String),
  repositories: Schema.Array(
    Schema.Struct({
      project: Schema.String,
      repository: Schema.String,
      github: Schema.NullOr(Schema.String),
    }),
  ),
  secret: Schema.optional(Schema.Literals(["present", "missing"])),
});
export type PeerGitHubStatus = typeof PeerGitHubStatus.Type;

/** GitHub CLI remains local; delivery verification is an additive workspace snapshot. */
export const PeerGitHubState = Schema.Struct({
  cli: Schema.Boolean,
  account: Schema.NullOr(Schema.String),
  signIn: Schema.NullOr(Schema.Struct({ userCode: Schema.String, verificationUri: Schema.String })),
  error: Schema.NullOr(Schema.String),
  verification: Schema.optional(Schema.Array(PeerGitHubVerification)),
});
export type PeerGitHubState = typeof PeerGitHubState.Type;
