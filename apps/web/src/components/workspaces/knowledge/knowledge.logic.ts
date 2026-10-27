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

/**
 * What a drift challenge shows of what changed: the first paths and commits (by subject, when this
 * checkout has the commit), how many more of each, and the short head it was found at.
 */
export function driftSummary(
  drift: {
    readonly head: string;
    readonly commits: ReadonlyArray<string>;
    readonly paths: ReadonlyArray<string>;
  },
  subjects: ReadonlyArray<{ readonly sha: string; readonly subject: string }> = [],
  shown = 5,
): {
  readonly head: string;
  readonly paths: ReadonlyArray<string>;
  readonly morePaths: number;
  readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string | null }>;
  readonly moreCommits: number;
} {
  const subjectOf = new Map(subjects.map((commit) => [commit.sha, commit.subject]));
  return {
    head: drift.head.slice(0, 8),
    paths: drift.paths.slice(0, shown),
    morePaths: Math.max(0, drift.paths.length - shown),
    commits: drift.commits
      .slice(0, shown)
      .map((sha) => ({ sha: sha.slice(0, 8), subject: subjectOf.get(sha) ?? null })),
    moreCommits: Math.max(0, drift.commits.length - shown),
  };
}

/** Words a heading only names a part with; a summary starts after them. */
const SECTION_HEADING =
  /^#{1,6}\s+(?:overview|summary|context|background|description|decision|rationale|details|notes|why|what)\b:?\s*/i;

/**
 * Markdown as plain prose people read: headings, code marks, links, emphasis and list marks
 * removed, cut at a sentence or word near `max`. Agents keep the Markdown; this is only its gist.
 */
export function plainSummary(markdown: string, max = 220): string {
  const text = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    // A heading on its own line names a part; the prose under it says what it holds.
    .filter((line, _index, lines) => !(/^#{1,6}\s/.test(line) && lines.length > 1))
    .join(" ")
    .replace(SECTION_HEADING, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/(^|\s)(?:[-*+]|\d+[.)])\s+/g, "$1")
    .replace(/(^|\s)>\s+/g, "$1")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.search(/[.!?](?=\s)[^.!?]*$/);
  if (sentence >= max / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return `${(word >= max / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** A title that is a file or slug name ("server-architecture.md") as words people read. */
export function entryTitle(title: string): string {
  const name = title.trim().replace(/\.mdx?$/i, "");
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(name)) return title.trim();
  const words = name.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Folders whose children are the parts of a project (apps/server, packages/contracts). */
const CONTAINERS = new Set([
  "apps",
  "packages",
  "libs",
  "crates",
  "services",
  "modules",
  "plugins",
  "cmd",
  "internal",
  "src",
]);

/**
 * The part of the project an entry is about, from the first path it applies to: `apps/server`
 * for `apps/server/src/**`, `deploy` for `deploy/run.sh`; "" when it applies to the whole project.
 */
export function knowledgeArea(paths: ReadonlyArray<string> | undefined): string {
  const first = paths?.find((path) => path.trim() !== "");
  if (first === undefined) return "";
  const parts = first
    .trim()
    .replace(/^\.?\//, "")
    .split(/[*?[{]/)[0]!
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  // A file directly in a folder belongs to the folder; one at the root to the whole project.
  if (parts.length > 0 && parts.at(-1)!.includes(".") && !first.trim().endsWith("/")) parts.pop();
  if (parts.length === 0) return "";
  return CONTAINERS.has(parts[0]!) && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

/** Entries by the part of the project they are about, largest first, the whole project last. */
export function knowledgeAreas<
  T extends { readonly kind: string; readonly paths?: ReadonlyArray<string> | undefined },
>(
  entries: ReadonlyArray<T>,
): { readonly area: string; readonly entries: T[]; readonly kinds: string[] }[] {
  const byArea = new Map<string, T[]>();
  for (const entry of entries) {
    const area = knowledgeArea(entry.paths);
    byArea.set(area, [...(byArea.get(area) ?? []), entry]);
  }
  return [...byArea.entries()]
    .map(([area, list]) => ({
      area,
      entries: list,
      kinds: [...new Set(list.map((entry) => entry.kind))].sort(),
    }))
    .sort(
      (a, b) =>
        Number(a.area === "") - Number(b.area === "") ||
        b.entries.length - a.entries.length ||
        a.area.localeCompare(b.area),
    );
}

const KIND_PLURAL: Readonly<Record<string, string>> = {
  architecture: "Architecture",
  convention: "Conventions",
  decision: "Decisions",
  learning: "Learnings",
  incident: "Incidents",
};

/** A kind as a filter names it ("Decisions"); one it does not know, capitalized. */
export function kindPlural(kind: string): string {
  return KIND_PLURAL[kind.toLowerCase()] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** A kind as one entry names it ("Decision"). */
export function kindLabel(kind: string): string {
  const lower = kind.toLowerCase();
  return lower === "architecture"
    ? "Architecture"
    : KIND_PLURAL[lower] !== undefined
      ? KIND_PLURAL[lower]!.slice(0, -1)
      : kind.charAt(0).toUpperCase() + kind.slice(1);
}

export type EntryValidity = "current" | "needs-review" | "challenged";

/**
 * Whether an entry still holds as far as Peer knows: challenged when someone said it may not,
 * needs review when only the code it governs changed since it was checked, current otherwise.
 */
export function entryValidities(
  rows: ReadonlyArray<{
    readonly challenge: {
      readonly entry: string;
      readonly status: string;
      readonly drift?: unknown;
      readonly sources: ReadonlyArray<{ readonly origin?: string | undefined }>;
    };
  }>,
): ReadonlyMap<string, EntryValidity> {
  const validity = new Map<string, EntryValidity>();
  for (const { challenge } of rows) {
    if (challenge.status !== "open" && challenge.status !== "resolving") continue;
    const drift =
      challenge.drift !== undefined &&
      challenge.sources.every((source) => source.origin === "drift");
    if (drift && validity.get(challenge.entry) !== "challenged")
      validity.set(challenge.entry, "needs-review");
    else if (!drift) validity.set(challenge.entry, "challenged");
  }
  return validity;
}

/**
 * Whether people can trust an entry, apart from whether it is current: verified when someone
 * confirmed it still holds and nothing questions it since, unverified when nobody ever confirmed
 * it, needs review when the code it governs changed or someone said it may no longer hold.
 */
export type EntryHealth = "verified" | "unverified" | "needs-review";

export function entryHealth(
  entry: { readonly checked?: string | undefined },
  validity: EntryValidity,
): EntryHealth {
  if (validity !== "current") return "needs-review";
  return entry.checked === undefined ? "unverified" : "verified";
}

/** How many entries are verified, unverified and need review, counted from the entries. */
export function knowledgeHealth(
  entries: ReadonlyArray<{ readonly id: string; readonly checked?: string | undefined }>,
  validityOf: (entry: string) => EntryValidity,
): Readonly<Record<EntryHealth, number>> {
  const counts = { verified: 0, unverified: 0, "needs-review": 0 };
  for (const entry of entries) counts[entryHealth(entry, validityOf(entry.id))] += 1;
  return counts;
}

/** The files whose changes put each entry up for review, from its open drift challenges. */
export function driftedPaths(
  rows: ReadonlyArray<{
    readonly challenge: {
      readonly entry: string;
      readonly status: string;
      readonly drift?: { readonly paths: ReadonlyArray<string> } | undefined;
    };
  }>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const paths = new Map<string, Set<string>>();
  for (const { challenge } of rows) {
    if (challenge.drift === undefined) continue;
    if (challenge.status !== "open" && challenge.status !== "resolving") continue;
    const set = paths.get(challenge.entry) ?? new Set<string>();
    for (const path of challenge.drift.paths) set.add(path);
    paths.set(challenge.entry, set);
  }
  return new Map([...paths].map(([entry, set]) => [entry, [...set].sort()]));
}

/**
 * An entry's body without what the reader already saw: its own title as a heading and a first
 * paragraph that only repeats the summary.
 */
export function bodyBeyondSummary(body: string, title: string, summary: string): string {
  const blocks = body.trim().split(/\n\s*\n/);
  const same = (a: string, b: string) =>
    plainSummary(a, 10_000).toLocaleLowerCase() === plainSummary(b, 10_000).toLocaleLowerCase();
  while (blocks.length > 0) {
    const first = blocks[0]!.trim();
    if (/^#\s/.test(first) && same(first.replace(/^#\s+/, ""), title)) blocks.shift();
    else if (summary.trim() !== "" && same(first, summary)) blocks.shift();
    else break;
  }
  return blocks.join("\n\n");
}
