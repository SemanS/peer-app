import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  AuthFilesystemReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerOpenSpecLinkInput,
  PeerOpenSpecReadInput,
  PeerOpenSpecReadResult,
  PeerOpenSpecSaveBriefInput,
  PeerOpenSpecUnlinkInput,
} from "./openspec.ts";

export const PEER_OPENSPEC_METHODS = {
  peerOpenSpecRead: "peer.openspec.read",
  peerOpenSpecLink: "peer.openspec.link",
  peerOpenSpecUnlink: "peer.openspec.unlink",
  peerOpenSpecSaveBrief: "peer.openspec.saveBrief",
} as const;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
// Every write answers with the task's source as it now reads, so a client shows the result at once.
export const OpenSpecRpcGroup = RpcGroup.make(
  Rpc.make(PEER_OPENSPEC_METHODS.peerOpenSpecRead, {
    payload: PeerOpenSpecReadInput,
    success: PeerOpenSpecReadResult,
    error,
  }),
  Rpc.make(PEER_OPENSPEC_METHODS.peerOpenSpecLink, {
    payload: PeerOpenSpecLinkInput,
    success: PeerOpenSpecReadResult,
    error,
  }),
  Rpc.make(PEER_OPENSPEC_METHODS.peerOpenSpecUnlink, {
    payload: PeerOpenSpecUnlinkInput,
    success: PeerOpenSpecReadResult,
    error,
  }),
  Rpc.make(PEER_OPENSPEC_METHODS.peerOpenSpecSaveBrief, {
    payload: PeerOpenSpecSaveBriefInput,
    success: PeerOpenSpecReadResult,
    error,
  }),
);
export const OpenSpecRpcScopes = {
  [PEER_OPENSPEC_METHODS.peerOpenSpecRead]: AuthFilesystemReadScope,
  [PEER_OPENSPEC_METHODS.peerOpenSpecLink]: AuthOrchestrationOperateScope,
  [PEER_OPENSPEC_METHODS.peerOpenSpecUnlink]: AuthOrchestrationOperateScope,
  [PEER_OPENSPEC_METHODS.peerOpenSpecSaveBrief]: AuthOrchestrationOperateScope,
} as const;
