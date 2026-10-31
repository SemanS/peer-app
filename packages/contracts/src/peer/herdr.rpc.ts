/**
 * herdr's WebSocket RPCs. They keep the names they had before plugins. Starting an agent on a task
 * (`peerHub.startAgent`) stays core's: core checks the task and puts the agent on it, whichever
 * plugin launches it.
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
import { PeerHubStatus } from "../peerHub.ts";
import { PeerAgentView, PeerHubError } from "./base.ts";
import {
  PeerHerdrOpenTerminalInput,
  PeerHerdrSetIntegrationInput,
  PeerHerdrSetRuntimeInput,
  PeerHubAgentInput,
  PeerHubAnswerAgentTrustInput,
  PeerHubFocusAgentInput,
  PeerHubPromptAgentInput,
} from "./herdr.ts";

export const PEER_HERDR_METHODS = {
  peerHubFocusAgent: "peerHub.focusAgent",
  peerHubWatchAgent: "peerHub.watchAgent",
  peerHubPromptAgent: "peerHub.promptAgent",
  peerHubAnswerAgentTrust: "peerHub.answerAgentTrust",
  peerHerdrSetRuntime: "peer.herdr.setRuntime",
  peerHerdrRestartRuntime: "peer.herdr.restartRuntime",
  peerHerdrOpenTerminal: "peer.herdr.openTerminal",
  peerHerdrSetIntegration: "peer.herdr.setIntegration",
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

const WsPeerHubAnswerAgentTrustRpc = Rpc.make(PEER_HERDR_METHODS.peerHubAnswerAgentTrust, {
  payload: PeerHubAnswerAgentTrustInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** Peer's own herdr: turn it off or on, restart it, open a terminal on it, install its hooks. */
const PeerHerdrSetRuntimeRpc = Rpc.make(PEER_HERDR_METHODS.peerHerdrSetRuntime, {
  payload: PeerHerdrSetRuntimeInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const PeerHerdrRestartRuntimeRpc = Rpc.make(PEER_HERDR_METHODS.peerHerdrRestartRuntime, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const PeerHerdrOpenTerminalRpc = Rpc.make(PEER_HERDR_METHODS.peerHerdrOpenTerminal, {
  payload: PeerHerdrOpenTerminalInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const PeerHerdrSetIntegrationRpc = Rpc.make(PEER_HERDR_METHODS.peerHerdrSetIntegration, {
  payload: PeerHerdrSetIntegrationInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const HerdrRpcGroup = RpcGroup.make(
  WsPeerHubFocusAgentRpc,
  WsPeerHubWatchAgentRpc,
  WsPeerHubPromptAgentRpc,
  WsPeerHubAnswerAgentTrustRpc,
  PeerHerdrSetRuntimeRpc,
  PeerHerdrRestartRuntimeRpc,
  PeerHerdrOpenTerminalRpc,
  PeerHerdrSetIntegrationRpc,
);

/**
 * Watching an agent only reads; bringing it forward or prompting it operates it, and so does
 * changing the herdr that runs it.
 */
export const HerdrRpcScopes = {
  [PEER_HERDR_METHODS.peerHubFocusAgent]: AuthOrchestrationOperateScope,
  [PEER_HERDR_METHODS.peerHubWatchAgent]: AuthOrchestrationReadScope,
  [PEER_HERDR_METHODS.peerHubPromptAgent]: AuthOrchestrationOperateScope,
  [PEER_HERDR_METHODS.peerHubAnswerAgentTrust]: AuthOrchestrationOperateScope,
  [PEER_HERDR_METHODS.peerHerdrSetRuntime]: AuthOrchestrationOperateScope,
  [PEER_HERDR_METHODS.peerHerdrRestartRuntime]: AuthOrchestrationOperateScope,
  [PEER_HERDR_METHODS.peerHerdrOpenTerminal]: AuthOrchestrationOperateScope,
  [PEER_HERDR_METHODS.peerHerdrSetIntegration]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof HerdrRpcGroup>["_tag"], AuthEnvironmentScope>;
