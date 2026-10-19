import { isCandidateKept, type PeerKnowledgeCandidate } from "@t3tools/contracts";

/**
 * The kontext command that records a knowledge candidate in a project's
 * repository: a learning by default, titled by its first sentence, without
 * people's names (knowledge is for the team, as kontext writes it).
 */
export function kontextCaptureCommand(candidate: {
  readonly text: string;
  readonly finders: number;
}): string {
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  const sentence = /^(.+?[.!?])(\s|$)/.exec(candidate.text)?.[1] ?? candidate.text;
  const title = sentence.length > 90 ? `${sentence.slice(0, 89).trimEnd()}…` : sentence;
  const found =
    candidate.finders > 1
      ? `${candidate.finders} agents found it on their own, on different work.`
      : "An agent marked it as holding beyond its task.";
  const body = `${candidate.text}\n\n${found} Proposed in Peer.`;
  return `kontext capture --kind learning --title ${quote(title)} --body ${quote(body)}`;
}

/**
 * How people decided on a project's candidates, and how often they kept what
 * agents marked for the project: the measure the agents' guidance improves on.
 */
export function decisionStats(
  candidates: ReadonlyArray<{
    readonly status: PeerKnowledgeCandidate["status"];
    readonly sources: ReadonlyArray<{
      readonly tagged: boolean;
      readonly origin?: string | undefined;
    }>;
  }>,
): {
  readonly decided: number;
  readonly kept: number;
  readonly marked: number;
  readonly markedKept: number;
} {
  const decided = candidates.filter((candidate) => candidate.status !== "proposed");
  const marked = decided.filter((candidate) =>
    candidate.sources.some((source) => source.tagged && source.origin === undefined),
  );
  return {
    decided: decided.length,
    kept: decided.filter((candidate) => isCandidateKept(candidate.status)).length,
    marked: marked.length,
    markedKept: marked.filter((candidate) => isCandidateKept(candidate.status)).length,
  };
}

/** Challenges people decided (dismissed, or resolved by a commit), newest decision first. */
export function decidedChallenges<
  R extends {
    readonly challenge: {
      readonly status: string;
      readonly decidedAt?: string | undefined;
      readonly lastAt: string;
    };
  },
>(rows: ReadonlyArray<R>): ReadonlyArray<R> {
  return rows
    .filter((row) => row.challenge.status === "dismissed" || row.challenge.status === "resolved")
    .toSorted((a, b) =>
      (b.challenge.decidedAt ?? b.challenge.lastAt).localeCompare(
        a.challenge.decidedAt ?? a.challenge.lastAt,
      ),
    );
}

/**
 * The queue of proposed candidates and the ones nobody found again for 60 days, which the Hub marks
 * stale and the page folds under "Older": triage, not a verdict, and a new finding brings one back.
 */
export function candidateGroups<
  C extends { readonly status: string; readonly stale?: boolean | undefined },
>(
  candidates: ReadonlyArray<C>,
): { readonly current: ReadonlyArray<C>; readonly older: ReadonlyArray<C> } {
  const proposed = candidates.filter((candidate) => candidate.status === "proposed");
  return {
    current: proposed.filter((candidate) => candidate.stale !== true),
    older: proposed.filter((candidate) => candidate.stale === true),
  };
}

/**
 * How a candidate card names a kept entry it relates to, and what it offers: a possible conflict
 * offers (never prefills) replacing it, the same offers dismissing as already kept, and extending
 * or merely reading alike offer nothing.
 */
export function relationOffer(relation: string): {
  readonly label: string;
  readonly offer: "supersede" | "dismiss" | null;
} {
  switch (relation) {
    case "conflicts":
      return { label: "Possible conflict with", offer: "supersede" };
    case "same":
      return { label: "Possibly the same as", offer: "dismiss" };
    case "extends":
      return { label: "Extends", offer: null };
    default:
      return { label: "Related to", offer: null };
  }
}
