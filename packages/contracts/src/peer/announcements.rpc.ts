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
import {
  PeerAnnouncementProjectInput,
  PeerAnnouncementInput,
  PeerAnnouncementList,
  PeerAnnouncementDetail,
  PeerAnnouncementPostInput,
  PeerAnnouncementPostResult,
  PeerAnnouncementWithdrawInput,
  PeerAnnouncementWithdrawResult,
  PeerAnnouncementCredentials,
  PeerAnnouncementCredentialCreateInput,
  PeerAnnouncementCredentialCreated,
  PeerAnnouncementCredential,
  PeerAnnouncementsSetWakeInput,
} from "./announcements.ts";

export const PEER_ANNOUNCEMENTS_METHODS = {
  peerAnnouncementsList: "peer.announcements.list",
  peerAnnouncementsDetail: "peer.announcements.detail",
  peerAnnouncementsPost: "peer.announcements.post",
  peerAnnouncementsWithdraw: "peer.announcements.withdraw",
  peerAnnouncementsCredentials: "peer.announcements.credentials",
  peerAnnouncementsCreateCredential: "peer.announcements.createCredential",
  peerAnnouncementsRevokeCredential: "peer.announcements.revokeCredential",
  peerAnnouncementsSetWake: "peer.announcements.setWake",
} as const;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const AnnouncementsRpcGroup = RpcGroup.make(
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsList, {
    payload: PeerAnnouncementProjectInput,
    success: Schema.NullOr(PeerAnnouncementList),
    error,
  }),
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsDetail, {
    payload: PeerAnnouncementInput,
    success: PeerAnnouncementDetail,
    error,
  }),
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsPost, {
    payload: PeerAnnouncementPostInput,
    success: PeerAnnouncementPostResult,
    error,
  }),
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsWithdraw, {
    payload: PeerAnnouncementWithdrawInput,
    success: PeerAnnouncementWithdrawResult,
    error,
  }),
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsCredentials, {
    payload: PeerAnnouncementProjectInput,
    success: PeerAnnouncementCredentials,
    error,
  }),
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsCreateCredential, {
    payload: PeerAnnouncementCredentialCreateInput,
    success: PeerAnnouncementCredentialCreated,
    error,
  }),
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsRevokeCredential, {
    payload: PeerAnnouncementInput,
    success: PeerAnnouncementCredential,
    error,
  }),
  Rpc.make(PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsSetWake, {
    payload: PeerAnnouncementsSetWakeInput,
    success: Schema.Void,
    error,
  }),
);
export const AnnouncementsRpcScopes = {
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsList]: AuthOrchestrationReadScope,
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsDetail]: AuthOrchestrationReadScope,
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsCredentials]: AuthOrchestrationReadScope,
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsPost]: AuthOrchestrationOperateScope,
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsWithdraw]: AuthOrchestrationOperateScope,
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsRevokeCredential]: AuthOrchestrationOperateScope,
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsSetWake]: AuthOrchestrationOperateScope,
  [PEER_ANNOUNCEMENTS_METHODS.peerAnnouncementsCreateCredential]: AuthAccessWriteScope,
} as const satisfies Record<
  RpcGroup.Rpcs<typeof AnnouncementsRpcGroup>["_tag"],
  AuthEnvironmentScope
>;
