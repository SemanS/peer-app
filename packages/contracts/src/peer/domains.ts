import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";

export const PeerDomainState = Schema.Literals(["verified", "claimed", "listed"]);
export type PeerDomainState = typeof PeerDomainState.Type;
export const PeerDomainClaim = Schema.Struct({ domain: Schema.String, state: PeerDomainState });
export type PeerDomainClaim = typeof PeerDomainClaim.Type;
export const PeerDomainOffer = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  domain: Schema.String,
  createdAt: Schema.optional(Schema.String),
  createdBy: Schema.optional(Schema.String),
  holder: Schema.optional(
    Schema.Struct({ slug: Schema.String, name: Schema.String, verified: Schema.Boolean }),
  ),
});
export type PeerDomainOffer = typeof PeerDomainOffer.Type;
export const PeerHubJoinWorkspaceInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  confirmDomainMatch: Schema.optional(Schema.Boolean),
});
export type PeerHubJoinWorkspaceInput = typeof PeerHubJoinWorkspaceInput.Type;
