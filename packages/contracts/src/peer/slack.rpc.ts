import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerSlackAdminResult,
  PeerSlackChannels,
  PeerSlackMe,
  PeerSlackSaveSecretsInput,
  PeerSlackSetChannelsInput,
  PeerSlackSetMineInput,
  PeerSlackTestResult,
  PeerSlackUnlinkMemberInput,
  PeerSlackWorkspaceInput,
} from "./slack.ts";

/** The first four are every member's; the rest are an owner's or admin's, which the Hub checks. */
export const PEER_SLACK_METHODS = {
  peerSlackMe: "peer.slack.me",
  peerSlackSetMine: "peer.slack.setMine",
  peerSlackLink: "peer.slack.link",
  peerSlackUnlink: "peer.slack.unlink",
  peerSlackAdmin: "peer.slack.admin",
  peerSlackSaveSecrets: "peer.slack.saveSecrets",
  peerSlackVerify: "peer.slack.verify",
  peerSlackChannels: "peer.slack.channels",
  peerSlackSetChannels: "peer.slack.setChannels",
  peerSlackTest: "peer.slack.test",
  peerSlackUnlinkMember: "peer.slack.unlinkMember",
  peerSlackDisconnect: "peer.slack.disconnect",
} as const;

const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const SlackRpcGroup = RpcGroup.make(
  Rpc.make(PEER_SLACK_METHODS.peerSlackMe, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackMe,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackSetMine, {
    payload: PeerSlackSetMineInput,
    success: PeerSlackMe,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackLink, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackMe,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackUnlink, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackMe,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackAdmin, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackAdminResult,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackSaveSecrets, {
    payload: PeerSlackSaveSecretsInput,
    success: PeerSlackAdminResult,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackVerify, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackAdminResult,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackChannels, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackChannels,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackSetChannels, {
    payload: PeerSlackSetChannelsInput,
    success: PeerSlackAdminResult,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackTest, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackTestResult,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackUnlinkMember, {
    payload: PeerSlackUnlinkMemberInput,
    success: PeerSlackAdminResult,
    error,
  }),
  Rpc.make(PEER_SLACK_METHODS.peerSlackDisconnect, {
    payload: PeerSlackWorkspaceInput,
    success: PeerSlackAdminResult,
    error,
  }),
);

/** Reading is access-read; anything that changes a link, a setting or the connection is access-write. */
export const SlackRpcScopes = {
  [PEER_SLACK_METHODS.peerSlackMe]: AuthAccessReadScope,
  [PEER_SLACK_METHODS.peerSlackSetMine]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackLink]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackUnlink]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackAdmin]: AuthAccessReadScope,
  [PEER_SLACK_METHODS.peerSlackSaveSecrets]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackVerify]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackChannels]: AuthAccessReadScope,
  [PEER_SLACK_METHODS.peerSlackSetChannels]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackTest]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackUnlinkMember]: AuthAccessWriteScope,
  [PEER_SLACK_METHODS.peerSlackDisconnect]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof SlackRpcGroup>["_tag"], AuthEnvironmentScope>;
