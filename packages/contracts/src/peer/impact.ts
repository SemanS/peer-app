import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const PeerImpactChange = Schema.Literals(["body", "signature", "removed"]);
export type PeerImpactChange = typeof PeerImpactChange.Type;
const symbol = { name: Schema.String, path: Schema.String };
export const PeerImpactSide = Schema.Struct({
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  label: Schema.String,
  task: Schema.optional(Schema.String),
});
export type PeerImpactSide = typeof PeerImpactSide.Type;
export const PeerImpactItem = Schema.Struct({
  ...symbol,
  change: PeerImpactChange,
  changer: Schema.String,
  from: Schema.Array(Schema.Struct(symbol)).check(Schema.isMaxLength(20)),
});
export type PeerImpactItem = typeof PeerImpactItem.Type;
export const PeerImpactRecord = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  sides: Schema.Tuple([PeerImpactSide, PeerImpactSide]),
  items: Schema.Array(PeerImpactItem).check(Schema.isMaxLength(20)),
  state: Schema.Literals(["open", "dismissed", "cleared"]),
  live: Schema.Boolean,
  reopened: Schema.Boolean,
  openedAt: Schema.String,
  updatedAt: Schema.String,
  dismissedBy: Schema.optional(Schema.String),
  dismissedAt: Schema.optional(Schema.String),
});
export type PeerImpactRecord = typeof PeerImpactRecord.Type;
export const PeerImpactProvided = Schema.Struct({
  ...symbol,
  project: Schema.String,
  side: PeerImpactSide,
  change: PeerImpactChange,
  rev: count,
  changedAt: Schema.String,
});
export type PeerImpactProvided = typeof PeerImpactProvided.Type;
export const PeerImpactView = Schema.Struct({
  records: Schema.Array(PeerImpactRecord),
  provided: Schema.Array(PeerImpactProvided),
});
export type PeerImpactView = typeof PeerImpactView.Type;
/** Explicitly projected wire payload: ranges, hashes, and source are local only. */
export const PeerImpactFootprint = Schema.Struct({
  session: Schema.String,
  project: Schema.String,
  changed: Schema.Array(
    Schema.Struct({ ...symbol, change: PeerImpactChange, rev: count, provided: Schema.Boolean }),
  ).check(Schema.isMaxLength(40)),
  uses: Schema.Array(
    Schema.Struct({ ...symbol, from: Schema.String, fromPath: Schema.String }),
  ).check(Schema.isMaxLength(120)),
});
export type PeerImpactFootprint = typeof PeerImpactFootprint.Type;
export const PeerImpactRootState = Schema.Struct({
  root: Schema.String,
  state: Schema.Literals([
    "ready",
    "missing",
    "uninitialized",
    "corrupt",
    "pending",
    "partial",
    "mismatch",
    "failed",
  ]),
  commands: Schema.Array(Schema.String),
  checkedAt: Schema.optional(Schema.String),
  /** How many changed files CodeGraph has not indexed yet, while the state is `pending`. */
  waiting: Schema.optional(count),
});
export type PeerImpactRootState = typeof PeerImpactRootState.Type;
export const PeerImpactStatus = Schema.Struct({
  enabled: Schema.Boolean,
  forcedOff: Schema.Boolean,
  autoIndex: Schema.Boolean,
  hubSupport: Schema.Literals(["unknown", "supported", "unsupported"]),
  lastContact: Schema.optional(Schema.String),
  roots: Schema.Array(PeerImpactRootState),
  counts: Schema.Array(
    Schema.Struct({ workspace: Schema.String, project: Schema.String, task: Schema.String, count }),
  ),
  revision: count,
});
export type PeerImpactStatus = typeof PeerImpactStatus.Type;
export const PeerImpactPlace = Schema.Struct({
  workspace: Schema.String,
  project: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  /** Cache key only; filtering and authorization use the place fields. */
  revision: Schema.optional(count),
});
export type PeerImpactPlace = typeof PeerImpactPlace.Type;
const action = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  id: Schema.String,
});
export const PEER_IMPACT_METHODS = {
  peerImpactList: "peerImpact.list",
  peerImpactDismiss: "peerImpact.dismiss",
  peerImpactReopen: "peerImpact.reopen",
  peerImpactConfigure: "peerImpact.configure",
} as const;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const PeerImpactRpcs = RpcGroup.make(
  Rpc.make(PEER_IMPACT_METHODS.peerImpactList, {
    payload: PeerImpactPlace,
    success: PeerImpactView,
    error,
  }),
  Rpc.make(PEER_IMPACT_METHODS.peerImpactDismiss, {
    payload: action,
    success: PeerImpactView,
    error,
  }),
  Rpc.make(PEER_IMPACT_METHODS.peerImpactReopen, {
    payload: action,
    success: PeerImpactView,
    error,
  }),
  Rpc.make(PEER_IMPACT_METHODS.peerImpactConfigure, {
    payload: Schema.Struct({ autoIndex: Schema.Boolean }),
    success: PeerImpactStatus,
    error,
  }),
);
export const ImpactRpcScopes = {
  [PEER_IMPACT_METHODS.peerImpactList]: AuthOrchestrationReadScope,
  [PEER_IMPACT_METHODS.peerImpactDismiss]: AuthOrchestrationOperateScope,
  [PEER_IMPACT_METHODS.peerImpactReopen]: AuthOrchestrationOperateScope,
  [PEER_IMPACT_METHODS.peerImpactConfigure]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof PeerImpactRpcs>["_tag"], AuthEnvironmentScope>;
