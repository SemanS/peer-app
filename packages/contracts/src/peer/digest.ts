import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { PeerHubError } from "./base.ts";
import { AuthOrchestrationReadScope, EnvironmentAuthorizationError } from "../auth.ts";
export const PeerDigestEntry = Schema.Struct({
  kind: Schema.String,
  at: Schema.String,
  by: Schema.Array(Schema.String),
  subject: Schema.String,
  detail: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.Struct({ type: Schema.String, id: Schema.String })),
});
export type PeerDigestEntry = typeof PeerDigestEntry.Type;
export const PeerDigestSection = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  total: Schema.Number,
  entries: Schema.Array(PeerDigestEntry),
});
export type PeerDigestSection = typeof PeerDigestSection.Type;
export const PeerDigest = Schema.Struct({
  project: Schema.String,
  since: Schema.String,
  until: Schema.String,
  coverage: Schema.Struct({ complete: Schema.Boolean, from: Schema.optional(Schema.String) }),
  sections: Schema.Array(PeerDigestSection),
  unavailable: Schema.optional(Schema.Array(Schema.String)),
});
export type PeerDigest = typeof PeerDigest.Type;
export const PeerDigestInput = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  since: Schema.String,
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20)),
  ),
});
export type PeerDigestInput = typeof PeerDigestInput.Type;
const phrases: Readonly<Record<string, string>> = {
  "announcement.posted": "posted by",
  "task.created": "created by",
  "task.moved": "moved by",
  "task.closed": "closed by",
  "task.reopened": "reopened by",
  "task.removed": "removed by",
  "pr.merged": "merged, work of",
  "context.updated": "updated by",
  "context.restored": "restored by",
  "overlap.opened": "opened by",
  "overlap.resolved": "resolved by",
  "knowledge.kept": "kept by",
  "knowledge.dismissed": "dismissed by",
  "request.received": "received from",
  "request.answered": "answered by",
};
export const digestPhrase = (kind: string) => phrases[kind] ?? kind.split(".").at(-1) ?? kind;
export const PEER_DIGEST_METHODS = { peerDigestGet: "peer.digest.get" } as const;
export const DigestRpcGroup = RpcGroup.make(
  Rpc.make(PEER_DIGEST_METHODS.peerDigestGet, {
    payload: PeerDigestInput,
    success: Schema.NullOr(PeerDigest),
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);
export const DigestRpcScopes = {
  [PEER_DIGEST_METHODS.peerDigestGet]: AuthOrchestrationReadScope,
} as const;
export const PEER_DIGEST_PLUGIN = {
  id: "digest",
  title: "Catch-up digest",
  summary: "See what the team changed while you were away.",
  defaultEnabled: true,
  hubFeature: { id: "digest", revision: 1 },
} as const;
