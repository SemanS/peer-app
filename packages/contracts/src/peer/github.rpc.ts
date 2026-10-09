/**
 * GitHub's WebSocket RPCs. They keep the names they had before plugins.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubStatus } from "../peerHub.ts";
import { PeerHubError } from "./base.ts";

export const PEER_GITHUB_METHODS = {
  peerHubConnectGitHub: "peerHub.connectGitHub",
  peerHubCancelGitHubSignIn: "peerHub.cancelGitHubSignIn",
} as const;

/** Starts signing GitHub CLI in to GitHub; the status carries the code to enter. */
const WsPeerHubConnectGitHubRpc = Rpc.make(PEER_GITHUB_METHODS.peerHubConnectGitHub, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubCancelGitHubSignInRpc = Rpc.make(PEER_GITHUB_METHODS.peerHubCancelGitHubSignIn, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const GitHubRpcGroup = RpcGroup.make(
  WsPeerHubConnectGitHubRpc,
  WsPeerHubCancelGitHubSignInRpc,
);

export const GitHubRpcScopes = {
  [PEER_GITHUB_METHODS.peerHubConnectGitHub]: AuthOrchestrationOperateScope,
  [PEER_GITHUB_METHODS.peerHubCancelGitHubSignIn]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof GitHubRpcGroup>["_tag"], AuthEnvironmentScope>;
