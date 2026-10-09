import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  AuthAccessReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import { PeerAuditListInput, PeerAuditPage } from "./audit.ts";
export const PEER_AUDIT_METHODS = { peerAuditList: "peer.audit.list" } as const;
export const AuditRpcGroup = RpcGroup.make(
  Rpc.make(PEER_AUDIT_METHODS.peerAuditList, {
    payload: PeerAuditListInput,
    success: PeerAuditPage,
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);
export const AuditRpcScopes = {
  [PEER_AUDIT_METHODS.peerAuditList]: AuthAccessReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof AuditRpcGroup>["_tag"], AuthEnvironmentScope>;
