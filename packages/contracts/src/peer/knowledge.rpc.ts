/**
 * Knowledge's WebSocket RPCs. They keep the names they had before plugins.
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
import { PeerHubError } from "./base.ts";
import {
  PeerHubCandidatesInput,
  PeerHubDecideCandidateInput,
  PeerHubHarvestInput,
  PeerHubKeepCandidateInput,
  PeerKeptCandidate,
  PeerKnowledgeCandidate,
  PeerKnowledgeStatus,
  PeerStagedEntry,
} from "./knowledge.ts";

export const PEER_KNOWLEDGE_METHODS = {
  peerHubKnowledgeCandidates: "peerHub.knowledgeCandidates",
  peerHubDecideCandidate: "peerHub.decideCandidate",
  peerHubKnowledgeStatus: "peerHub.knowledgeStatus",
  peerHubSetupKnowledge: "peerHub.setupKnowledge",
  peerHubKeepCandidate: "peerHub.keepCandidate",
  peerHubHarvestContext: "peerHub.harvestContext",
  peerHubImproveGuidance: "peerHub.improveGuidance",
} as const;

/**
 * A project's knowledge candidates: proposed first, most independent finders first. A call that
 * could not be answered fails with a `PeerHubError` whose `kind`, `status`, `hubUrl` and `request`
 * say where it stopped, and `unsupported` is a Hub without the route: none of them is ever an empty
 * list. A project with no candidates is an empty list.
 */
const WsPeerHubKnowledgeCandidatesRpc = Rpc.make(
  PEER_KNOWLEDGE_METHODS.peerHubKnowledgeCandidates,
  {
    payload: PeerHubCandidatesInput,
    success: Schema.Array(PeerKnowledgeCandidate),
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  },
);

/** A person dismisses a knowledge candidate, promotes it, or proposes it again. */
const WsPeerHubDecideCandidateRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerHubDecideCandidate, {
  payload: PeerHubDecideCandidateInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A project's knowledge on this computer: its checkout, kontext there, its guidance for agents. */
const WsPeerHubKnowledgeStatusRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerHubKnowledgeStatus, {
  payload: PeerHubCandidatesInput,
  success: PeerKnowledgeStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** Runs `kontext init` in the project's checkout here. */
const WsPeerHubSetupKnowledgeRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerHubSetupKnowledge, {
  payload: PeerHubCandidatesInput,
  success: PeerKnowledgeStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** Writes a candidate into the project's knowledge, staged, and marks it kept for everyone. */
const WsPeerHubKeepCandidateRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerHubKeepCandidate, {
  payload: PeerHubKeepCandidateInput,
  success: PeerKeptCandidate,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** Reads a shared context with kontext for what the project should keep; proposes it. */
const WsPeerHubHarvestContextRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerHubHarvestContext, {
  payload: PeerHubHarvestInput,
  success: Schema.Struct({ proposed: Schema.Number }),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** Proposes the project's guidance for its agents from what people kept and dismissed, staged. */
const WsPeerHubImproveGuidanceRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerHubImproveGuidance, {
  payload: PeerHubCandidatesInput,
  success: PeerStagedEntry,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const KnowledgeRpcGroup = RpcGroup.make(
  WsPeerHubKnowledgeCandidatesRpc,
  WsPeerHubDecideCandidateRpc,
  WsPeerHubKnowledgeStatusRpc,
  WsPeerHubSetupKnowledgeRpc,
  WsPeerHubKeepCandidateRpc,
  WsPeerHubHarvestContextRpc,
  WsPeerHubImproveGuidanceRpc,
);

/** Reading knowledge only reads; deciding, writing and proposing it is operating on shared work. */
export const KnowledgeRpcScopes = {
  [PEER_KNOWLEDGE_METHODS.peerHubKnowledgeCandidates]: AuthOrchestrationReadScope,
  [PEER_KNOWLEDGE_METHODS.peerHubDecideCandidate]: AuthOrchestrationOperateScope,
  [PEER_KNOWLEDGE_METHODS.peerHubKnowledgeStatus]: AuthOrchestrationReadScope,
  [PEER_KNOWLEDGE_METHODS.peerHubSetupKnowledge]: AuthOrchestrationOperateScope,
  [PEER_KNOWLEDGE_METHODS.peerHubKeepCandidate]: AuthOrchestrationOperateScope,
  [PEER_KNOWLEDGE_METHODS.peerHubHarvestContext]: AuthOrchestrationOperateScope,
  [PEER_KNOWLEDGE_METHODS.peerHubImproveGuidance]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof KnowledgeRpcGroup>["_tag"], AuthEnvironmentScope>;
