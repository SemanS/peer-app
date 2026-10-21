import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { AuthFilesystemReadScope, EnvironmentAuthorizationError } from "../auth.ts";
import { PeerHubError } from "./base.ts";
import { PeerOpenSpecReadInput, PeerOpenSpecReadResult } from "./openspec.ts";

export const PEER_OPENSPEC_METHODS = { peerOpenSpecRead: "peer.openspec.read" } as const;
export const OpenSpecRpcGroup = RpcGroup.make(
  Rpc.make(PEER_OPENSPEC_METHODS.peerOpenSpecRead, {
    payload: PeerOpenSpecReadInput,
    success: PeerOpenSpecReadResult,
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  }),
);
export const OpenSpecRpcScopes = {
  [PEER_OPENSPEC_METHODS.peerOpenSpecRead]: AuthFilesystemReadScope,
} as const;
