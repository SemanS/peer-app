/**
 * The roles plugin's WebSocket RPCs: a person reads a project's session roles, gives a session or a
 * thread of theirs the role `review` or clears it, and starts a review of a task. Agents take the
 * role themselves through `peer role review`, not through here.
 */
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
  PeerRolesClearInput,
  PeerRolesListInput,
  PeerRolesProject,
  PeerRolesSetInput,
  PeerRolesStartReviewInput,
  PeerRolesStartReviewResult,
} from "./roles.ts";

export const PEER_ROLES_METHODS = {
  peerRolesList: "peer.roles.list",
  peerRolesSet: "peer.roles.set",
  peerRolesClear: "peer.roles.clear",
  peerRolesStartReview: "peer.roles.startReview",
} as const;

const methods = PEER_ROLES_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

// Every change answers with the project's roles as they now read, so a client shows the result at once.
export const RolesRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerRolesList, {
    payload: PeerRolesListInput,
    success: PeerRolesProject,
    error,
  }),
  Rpc.make(methods.peerRolesSet, { payload: PeerRolesSetInput, success: PeerRolesProject, error }),
  Rpc.make(methods.peerRolesClear, {
    payload: PeerRolesClearInput,
    success: PeerRolesProject,
    error,
  }),
  Rpc.make(methods.peerRolesStartReview, {
    payload: PeerRolesStartReviewInput,
    success: PeerRolesStartReviewResult,
    error,
  }),
);

/** Reading is orchestration-read; a role changes what an agent may do, so setting one is operating. */
export const RolesRpcScopes = {
  [methods.peerRolesList]: AuthOrchestrationReadScope,
  [methods.peerRolesSet]: AuthOrchestrationOperateScope,
  [methods.peerRolesClear]: AuthOrchestrationOperateScope,
  [methods.peerRolesStartReview]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof RolesRpcGroup>["_tag"], AuthEnvironmentScope>;
