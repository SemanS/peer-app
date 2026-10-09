import * as Schema from "effect/Schema";

export const PeerToolTrustState = Schema.Literals([
  "review",
  "changed",
  "secret",
  "off",
  "invalid",
]);
export const PeerToolTrustStatus = Schema.Struct({
  error: Schema.optional(Schema.String),
  workspaces: Schema.Array(
    Schema.Struct({
      workspace: Schema.String,
      appliedBy: Schema.optional(Schema.String),
      appliedAt: Schema.optional(Schema.String),
      tools: Schema.Array(
        Schema.Struct({
          tool: Schema.String,
          fingerprint: Schema.String,
          state: PeerToolTrustState,
          projects: Schema.Array(Schema.String),
          changes: Schema.optional(Schema.Array(Schema.String)),
          reason: Schema.optional(Schema.String),
          missing: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
      secrets: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          source: Schema.Literals(["stored", "environment", "missing"]),
          environmentSet: Schema.Boolean,
        }),
      ),
    }),
  ),
});
export type PeerToolTrustStatus = typeof PeerToolTrustStatus.Type;
const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/));
export const PeerToolSecretName = Schema.String.check(Schema.isPattern(/^[A-Z_][A-Z0-9_]{0,63}$/));
export const PeerToolSecretValue = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8192),
  Schema.isPattern(/^[^\r\n\0]+$/),
);
export const PeerToolTrustApproveInput = Schema.Struct({
  items: Schema.Array(Schema.Struct({ workspace: Id, tool: Id, fingerprint: Schema.String })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
  ),
});
export type PeerToolTrustApproveInput = typeof PeerToolTrustApproveInput.Type;
export const PeerToolTrustTurnOffInput = Schema.Struct({
  items: Schema.Array(Schema.Struct({ workspace: Id, tool: Id })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
  ),
});
export type PeerToolTrustTurnOffInput = typeof PeerToolTrustTurnOffInput.Type;
export const PeerToolTrustSetSecretInput = Schema.Struct({
  workspace: Id,
  name: PeerToolSecretName,
  source: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("value"), value: PeerToolSecretValue }),
    Schema.Struct({ kind: Schema.Literal("environment") }),
    Schema.Struct({ kind: Schema.Literal("none") }),
  ]),
});
export type PeerToolTrustSetSecretInput = typeof PeerToolTrustSetSecretInput.Type;
export class PeerToolTrustError extends Schema.TaggedError<PeerToolTrustError>()(
  "PeerToolTrustError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}
