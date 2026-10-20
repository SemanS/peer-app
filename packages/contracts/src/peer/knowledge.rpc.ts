/**
 * Knowledge's WebSocket RPCs. Those from before plugins keep their names; later ones are
 * `peer.knowledge.<name>`.
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
  PeerChallengeDecided,
  PeerChallengeDrafted,
  PeerChallengedEntry,
  PeerHubCandidateInput,
  PeerHubCandidatesInput,
  PeerHubChallengeInput,
  PeerHubDecideChallengeInput,
  PeerHubOpenChallengeInput,
  PeerKnowledgeChallenge,
  PeerKnowledgeChallenges,
  PeerKnowledgeEntryInput,
  PeerKnowledgeRelations,
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
  peerKnowledgeChallenges: "peer.knowledge.challenges",
  peerKnowledgeEntry: "peer.knowledge.entry",
  peerKnowledgeOpenChallenge: "peer.knowledge.openChallenge",
  peerKnowledgeDecideChallenge: "peer.knowledge.decideChallenge",
  peerKnowledgeDraftReplacement: "peer.knowledge.draftReplacement",
  peerKnowledgeRelated: "peer.knowledge.related",
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

const failures = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

/**
 * A project's challenges of its knowledge, open first, with the entry each names as this computer's
 * checkout has it. Fails as `unsupported` on a Hub that serves knowledge before revision 2.
 */
const WsPeerKnowledgeChallengesRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerKnowledgeChallenges, {
  payload: PeerHubCandidatesInput,
  success: PeerKnowledgeChallenges,
  error: failures,
});

/** Reads one saved entry from the project's checkout without changing it. */
const WsPeerKnowledgeEntryRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerKnowledgeEntry, {
  payload: PeerKnowledgeEntryInput,
  success: Schema.NullOr(PeerChallengedEntry),
  error: failures,
});

/** A person opens a challenge of an entry with a reason, or seconds the one it has. */
const WsPeerKnowledgeOpenChallengeRpc = Rpc.make(
  PEER_KNOWLEDGE_METHODS.peerKnowledgeOpenChallenge,
  { payload: PeerHubOpenChallengeInput, success: PeerKnowledgeChallenge, error: failures },
);

/** Dismiss, reopen or resolve a challenge, or stage the entry's retirement or replacement. */
const WsPeerKnowledgeDecideChallengeRpc = Rpc.make(
  PEER_KNOWLEDGE_METHODS.peerKnowledgeDecideChallenge,
  { payload: PeerHubDecideChallengeInput, success: PeerChallengeDecided, error: failures },
);

/** kontext's draft of a replacement for the challenged entry; writes nothing. */
const WsPeerKnowledgeDraftReplacementRpc = Rpc.make(
  PEER_KNOWLEDGE_METHODS.peerKnowledgeDraftReplacement,
  { payload: PeerHubChallengeInput, success: PeerChallengeDrafted, error: failures },
);

/** How a candidate relates to entries already kept, as kontext here judges it. */
const WsPeerKnowledgeRelatedRpc = Rpc.make(PEER_KNOWLEDGE_METHODS.peerKnowledgeRelated, {
  payload: PeerHubCandidateInput,
  success: PeerKnowledgeRelations,
  error: failures,
});

export const KnowledgeRpcGroup = RpcGroup.make(
  WsPeerHubKnowledgeCandidatesRpc,
  WsPeerHubDecideCandidateRpc,
  WsPeerHubKnowledgeStatusRpc,
  WsPeerHubSetupKnowledgeRpc,
  WsPeerHubKeepCandidateRpc,
  WsPeerHubHarvestContextRpc,
  WsPeerHubImproveGuidanceRpc,
  WsPeerKnowledgeChallengesRpc,
  WsPeerKnowledgeEntryRpc,
  WsPeerKnowledgeOpenChallengeRpc,
  WsPeerKnowledgeDecideChallengeRpc,
  WsPeerKnowledgeDraftReplacementRpc,
  WsPeerKnowledgeRelatedRpc,
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
  [PEER_KNOWLEDGE_METHODS.peerKnowledgeChallenges]: AuthOrchestrationReadScope,
  [PEER_KNOWLEDGE_METHODS.peerKnowledgeEntry]: AuthOrchestrationReadScope,
  [PEER_KNOWLEDGE_METHODS.peerKnowledgeOpenChallenge]: AuthOrchestrationOperateScope,
  [PEER_KNOWLEDGE_METHODS.peerKnowledgeDecideChallenge]: AuthOrchestrationOperateScope,
  [PEER_KNOWLEDGE_METHODS.peerKnowledgeDraftReplacement]: AuthOrchestrationOperateScope,
  [PEER_KNOWLEDGE_METHODS.peerKnowledgeRelated]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof KnowledgeRpcGroup>["_tag"], AuthEnvironmentScope>;
