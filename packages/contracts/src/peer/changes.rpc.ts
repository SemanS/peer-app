import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  ChangesPlace,
  MarkReviewedInput,
  ProjectChanges,
  ReviewDiff,
  ReviewDiffInput,
  ReviewMark,
} from "./changes.ts";

export const PEER_CHANGES_METHODS = {
  peerChangesSubscribe: "peer.changes.subscribe",
  peerChangesMarkReviewed: "peer.changes.markReviewed",
  peerChangesReviewDiff: "peer.changes.reviewDiff",
} as const;

const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const ChangesRpcGroup = RpcGroup.make(
  /** A project's changes: a view on subscribe, then each time the Hub or this computer moves them. */
  Rpc.make(PEER_CHANGES_METHODS.peerChangesSubscribe, {
    payload: ChangesPlace,
    success: ProjectChanges,
    error,
    stream: true,
  }),
  Rpc.make(PEER_CHANGES_METHODS.peerChangesMarkReviewed, {
    payload: MarkReviewedInput,
    success: Schema.NullOr(ReviewMark),
    error,
  }),
  Rpc.make(PEER_CHANGES_METHODS.peerChangesReviewDiff, {
    payload: ReviewDiffInput,
    success: ReviewDiff,
    error,
  }),
);

export const ChangesRpcScopes = {
  [PEER_CHANGES_METHODS.peerChangesSubscribe]: AuthOrchestrationReadScope,
  // A mark moves a reference in the person's own checkout.
  [PEER_CHANGES_METHODS.peerChangesMarkReviewed]: AuthOrchestrationOperateScope,
  [PEER_CHANGES_METHODS.peerChangesReviewDiff]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof ChangesRpcGroup>["_tag"], AuthEnvironmentScope>;
