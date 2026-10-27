import {
  WS_METHODS,
  type PeerChallengeAction,
  type PeerChallengeRow,
  type PeerKnowledgeChallenge,
} from "@t3tools/contracts";
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
    /** A project's challenges of its knowledge; `waiting` in the input reads them again. */
    peerKnowledgeChallenges: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-knowledge:challenges",
      tag: WS_METHODS.peerKnowledgeChallenges,
    }),
    peerKnowledgeEntry: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-knowledge:entry",
      tag: WS_METHODS.peerKnowledgeEntry,
      staleTimeMs: 0,
    }),
    peerKnowledgeOpenChallenge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-knowledge:open-challenge",
      tag: WS_METHODS.peerKnowledgeOpenChallenge,
    }),
    peerKnowledgeDecideChallenge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-knowledge:decide-challenge",
      tag: WS_METHODS.peerKnowledgeDecideChallenge,
    }),
    peerKnowledgeDraftReplacement: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-knowledge:draft-replacement",
      tag: WS_METHODS.peerKnowledgeDraftReplacement,
    }),
    /** Runs an entry's own check and records the outcome in kontext's ledger. */
    peerKnowledgeVerifyEntry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-knowledge:verify-entry",
      tag: WS_METHODS.peerKnowledgeVerifyEntry,
    }),
    /** How a candidate relates to kept entries, asked once per candidate. */
    peerKnowledgeRelated: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-knowledge:related",
      tag: WS_METHODS.peerKnowledgeRelated,
    }),
  };
}

/** The knowledge feature's revision that serves challenges; an older Hub shows none. */
export const CHALLENGES_REVISION = 2;

/** Whether the signed-in Hub takes challenges, as the status says of its catalog. */
export const servesChallenges = (status: {
  readonly hub?: { readonly features?: Readonly<Record<string, number>> | undefined } | undefined;
}) => (status.hub?.features?.knowledge ?? 0) >= CHALLENGES_REVISION;

/** `2 agents on their own · 1 person`: who says the entry may no longer hold. */
export function challengeWho(challenge: PeerKnowledgeChallenge): string {
  const agents = challenge.finders;
  const people = challenge.people.length;
  const parts = [
    ...(challenge.drift === undefined ? [] : ["Its code changed"]),
    ...(agents > 0 ? [`${agents} ${agents === 1 ? "agent" : "agents"} on their own`] : []),
    ...(people > 0 ? [`${people} ${people === 1 ? "person" : "people"}`] : []),
  ];
  return parts.length === 0 ? "An agent that had heard of it" : parts.join(" · ");
}

/** Still to be decided, or waiting for its change to be committed. */
export const challengeActive = (challenge: PeerKnowledgeChallenge) =>
  challenge.status === "open" || challenge.status === "resolving";

/** What a resolving challenge waits for: the commit of what was staged. */
export const challengeStaged = (challenge: PeerKnowledgeChallenge) =>
  challenge.resolvedAs?.kind === "confirmed" ? "Confirmation staged" : "Replacement staged";

export type ChallengeActionId =
  | "confirm"
  | "second"
  | "dismiss"
  | "reopen"
  | "replace"
  | "retire"
  | "resolve";

export interface ChallengeActionOffer {
  readonly id: ChallengeActionId;
  /** Null when it can be taken; why not otherwise. */
  readonly unavailable: string | null;
}

/**
 * What a person can do with a challenge row. Web and desktop stage a replacement or a retirement
 * into this computer's checkout, and for a drift challenge first a confirmation that the entry
 * still holds (where the Hub takes one, `can.confirm`); the phone seconds, dismisses and resolves.
 * An entry the checkout does not have can only be resolved (a person knows it went), and a
 * resolved challenge is done.
 */
export function challengeOffers(
  row: PeerChallengeRow,
  can: {
    readonly replace: PeerChallengeAction;
    readonly retire: PeerChallengeAction;
    readonly confirm?: PeerChallengeAction | undefined;
  },
  options: { readonly surface: "web" | "mobile"; readonly me?: string | undefined },
): ReadonlyArray<ChallengeActionOffer> {
  const { challenge, current } = row;
  const web = options.surface === "web";
  const seconded =
    options.me !== undefined && challenge.people.includes(options.me) ? "You seconded it." : null;
  switch (challenge.status) {
    case "resolved":
      return [];
    case "dismissed":
      return web ? [{ id: "reopen", unavailable: null }] : [];
    case "resolving":
      return [
        ...(web ? [{ id: "reopen" as const, unavailable: null }] : []),
        { id: "dismiss", unavailable: null },
        { id: "resolve", unavailable: null },
      ];
    case "open":
      if (current === null) return [{ id: "resolve", unavailable: null }];
      return [
        ...(web && challenge.drift !== undefined && can.confirm !== undefined
          ? [{ id: "confirm" as const, unavailable: can.confirm.reason }]
          : []),
        { id: "second", unavailable: seconded },
        { id: "dismiss", unavailable: null },
        ...(web
          ? [
              { id: "replace" as const, unavailable: can.replace.reason },
              { id: "retire" as const, unavailable: can.retire.reason },
            ]
          : []),
        { id: "resolve", unavailable: null },
      ];
  }
}
