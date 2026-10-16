import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** What agents found that a project may keep, deciding on it, and keeping it in the project's knowledge. */
export function createPeerKnowledgeAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    /** A project's knowledge candidates; the count waiting in the input reads them again. */
    peerHubKnowledgeCandidates: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:knowledge-candidates",
      tag: WS_METHODS.peerHubKnowledgeCandidates,
    }),
    peerHubDecideCandidate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:decide-candidate",
      tag: WS_METHODS.peerHubDecideCandidate,
    }),
    /** A project's knowledge on this computer; `waiting` in the input reads it again. */
    peerHubKnowledgeStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:knowledge-status",
      tag: WS_METHODS.peerHubKnowledgeStatus,
    }),
    peerHubSetupKnowledge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:setup-knowledge",
      tag: WS_METHODS.peerHubSetupKnowledge,
    }),
    peerHubKeepCandidate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:keep-candidate",
      tag: WS_METHODS.peerHubKeepCandidate,
    }),
    peerHubHarvestContext: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:harvest-context",
      tag: WS_METHODS.peerHubHarvestContext,
    }),
    peerHubImproveGuidance: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:improve-guidance",
      tag: WS_METHODS.peerHubImproveGuidance,
    }),
  };
}
