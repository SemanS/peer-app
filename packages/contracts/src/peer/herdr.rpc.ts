/**
 * herdr's WebSocket RPCs. They keep the names they had before plugins. Starting an agent on a task
 * (`peerHub.startAgent`) stays core's: core checks the task and puts the agent on it, whichever
 * plugin launches it.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubStatus } from "../peerHub.ts";
import { PeerAgentView, PeerHubError } from "./base.ts";
import { PeerHubAgentInput, PeerHubFocusAgentInput, PeerHubPromptAgentInput } from "./herdr.ts";

export const PEER_HERDR_METHODS = {
  peerHubFocusAgent: "peerHub.focusAgent",
  peerHubWatchAgent: "peerHub.watchAgent",
  peerHubPromptAgent: "peerHub.promptAgent",
} as const;

const WsPeerHubFocusAgentRpc = Rpc.make(PEER_HERDR_METHODS.peerHubFocusAgent, {
  payload: PeerHubFocusAgentInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A herdr agent's work as it happens: a view on subscribe, then each change. */
const WsPeerHubWatchAgentRpc = Rpc.make(PEER_HERDR_METHODS.peerHubWatchAgent, {
  payload: PeerHubAgentInput,
  success: PeerAgentView,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsPeerHubPromptAgentRpc = Rpc.make(PEER_HERDR_METHODS.peerHubPromptAgent, {
  payload: PeerHubPromptAgentInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const HerdrRpcGroup = RpcGroup.make(
  WsPeerHubFocusAgentRpc,
  WsPeerHubWatchAgentRpc,
  WsPeerHubPromptAgentRpc,
);

/** Watching an agent only reads; bringing it forward or prompting it operates it. */
export const HerdrRpcScopes = {
  [PEER_HERDR_METHODS.peerHubFocusAgent]: AuthOrchestrationOperateScope,
  [PEER_HERDR_METHODS.peerHubWatchAgent]: AuthOrchestrationReadScope,
  [PEER_HERDR_METHODS.peerHubPromptAgent]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof HerdrRpcGroup>["_tag"], AuthEnvironmentScope>;
