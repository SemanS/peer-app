import {
  isCandidateKept,
  type PeerKnowledgeCandidate,
  type PeerKnowledgePremise,
} from "@t3tools/contracts";
import {
  provenanceLine,
  sinceLine,
  type EntryProvenance,
} from "@t3tools/client-runtime/peer/knowledge";

export { provenanceLine, sinceLine, type EntryProvenance };

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
 * How a finding may be kept: added into an existing entry (`add`), kept as a new entry linked to
 * the entries it builds on (`new-linked`) or on its own (`new`), replacing an entry (`supersede`),
 * or dismissed. The relation kontext named only picks which one is offered first.
 */
export type KeepOperationId = "add" | "new-linked" | "new" | "supersede" | "dismiss";

/** Kinds an addition may amend in place; a decision changes only by supersession. */
const AMENDABLE_KINDS = new Set(["convention", "learning", "incident"]);

export const amendable = (kind: string | undefined) =>
  kind !== undefined && AMENDABLE_KINDS.has(kind.toLowerCase());

/**
 * How a candidate card names a kept entry it relates to, what it offers beside the operations (a
 * possible conflict offers, never prefills, replacing it; the same offers dismissing as already
 * kept), and the operation the relation selects: adding into a convention, learning or incident it
 * extends, a new entry linked to a decision it extends (never amending or superseding one), and
 * nothing for a possible conflict, which the person decides.
 */
export function relationOffer(
  relation: string,
  kind?: string,
): {
  readonly label: string;
  readonly offer: "supersede" | "dismiss" | null;
  readonly operation: KeepOperationId | null;
} {
  switch (relation) {
    case "conflicts":
      return { label: "Possible conflict with", offer: "supersede", operation: null };
    case "same":
      return { label: "Possibly the same as", offer: "dismiss", operation: "dismiss" };
    case "extends":
      return {
        label: "Extends",
        offer: null,
        operation: amendable(kind) ? "add" : "new-linked",
      };
    case "uncertain":
      return { label: "Related to", offer: null, operation: "new-linked" };
    default:
      return { label: "Related to", offer: null, operation: "new" };
  }
}

interface RelationLike {
  readonly entry: string;
  readonly title: string;
  readonly relation: string;
  readonly reason: string;
  readonly revision?: string | undefined;
  readonly kind?: string | undefined;
}

/** The most a new entry links to, as kontext takes `extends`. */
const LINKS_MAX = 5;

/**
 * What one finding's card offers, primary first: Add to an entry it extends (the first such entry
 * with a revision to check, the others to choose from), Keep as a new entry (linked to the entries
 * it extends or may relate to), Replace for each possible conflict, and Dismiss. A possible conflict
 * makes nothing primary; the same entry makes Dismiss primary; then adding, then a linked entry.
 */
export function findingOperations<R extends RelationLike>(
  relations: ReadonlyArray<R>,
): {
  readonly primary: KeepOperationId | null;
  readonly offered: ReadonlyArray<KeepOperationId>;
  readonly addTargets: ReadonlyArray<R>;
  readonly links: ReadonlyArray<R>;
  readonly replaceable: ReadonlyArray<R>;
  readonly same: R | null;
} {
  const operations = relations.map((relation) => ({
    relation,
    operation: relationOffer(relation.relation, relation.kind).operation,
  }));
  // Adding re-checks the revision it was compared with; without one it cannot be offered.
  const addTargets = operations
    .filter(({ operation, relation }) => operation === "add" && relation.revision !== undefined)
    .map(({ relation }) => relation);
  const links = relations
    .filter((relation) => relation.relation === "extends" || relation.relation === "uncertain")
    .slice(0, LINKS_MAX);
  const replaceable = relations.filter((relation) => relation.relation === "conflicts");
  const same = relations.find((relation) => relation.relation === "same") ?? null;
  const primary: KeepOperationId | null =
    replaceable.length > 0
      ? null
      : same !== null
        ? "dismiss"
        : addTargets.length > 0
          ? "add"
          : links.length > 0
            ? "new-linked"
            : "new";
  const keepNew: KeepOperationId = links.length > 0 ? "new-linked" : "new";
  const all: ReadonlyArray<KeepOperationId> = [
    ...(addTargets.length > 0 ? (["add"] as const) : []),
    keepNew,
    ...(replaceable.length > 0 ? (["supersede"] as const) : []),
    "dismiss",
  ];
  return {
    primary,
    offered:
      primary === null || primary === "new-linked" || primary === "new"
        ? all
        : [primary, ...all.filter((operation) => operation !== primary)],
    addTargets,
    links,
    replaceable,
    same,
  };
}

/**
 * The review page's count of waiting findings by their primary operation: "3 would change existing
 * entries · 2 would be new · 2 already known", and possible conflicts left to the person.
 */
export function operationSummary(primaries: ReadonlyArray<KeepOperationId | null>): string | null {
  const count = (match: (operation: KeepOperationId | null) => boolean) =>
    primaries.filter(match).length;
  const change = count((operation) => operation === "add" || operation === "supersede");
  const fresh = count((operation) => operation === "new" || operation === "new-linked");
  const known = count((operation) => operation === "dismiss");
  const open = count((operation) => operation === null);
  const parts = [
    ...(change === 0
      ? []
      : [`${change} would change ${change === 1 ? "an existing entry" : "existing entries"}`]),
    ...(fresh === 0 ? [] : [`${fresh} would be new`]),
    ...(known === 0 ? [] : [`${known} already known`]),
    ...(open === 0 ? [] : [`${open} ${open === 1 ? "needs" : "need"} your decision`]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Past this many words an entry reads better split: a hint under the diff, never a gate. */
export const LONG_ENTRY_WORDS = 400;

export function longEntryHint(words: number): string | null {
  return words > LONG_ENTRY_WORDS
    ? `This entry is already long (${words} words); a new entry linked to it may read better`
    : null;
}

/**
 * Why an operation is the card's default and what evidence the finding has, in one line: kontext's
 * relation and its reason, where it was found, how many agents found it on their own, and whether
 * its agent ran a check that passed. A waiting finding is never called verified: that word belongs
 * to kept entries with a verification in kontext's ledger.
 */
export function whyLine(input: {
  readonly relation: RelationLike | null;
  readonly sources: ReadonlyArray<{
    readonly session: string;
    readonly task?: string | undefined;
    readonly check?: { readonly command: string; readonly passed: boolean } | undefined;
  }>;
  readonly finders: number;
  /** How people name a task. */
  readonly taskName: (task: string | undefined) => string;
}): string {
  const { relation } = input;
  const said =
    relation === null
      ? "Nothing kept says this yet"
      : `${relationOffer(relation.relation, relation.kind).label} “${relation.title}”${relation.reason === "" ? "" : `: ${relation.reason}`}`;
  const first = input.sources[0];
  const found =
    first === undefined
      ? null
      : `found in ${input.taskName(first.task)} (session ${first.session.slice(0, 8)})`;
  const finders =
    input.finders > 1 ? `${input.finders} agents found it on their own` : "1 agent found it";
  const passed = input.sources.find((source) => source.check?.passed === true)?.check;
  const check =
    passed === undefined ? "no check" : `its agent ran \`${passed.command}\` and it passed`;
  return [said, found, finders, check].filter((part) => part !== null).join(" · ");
}

/** One line of a line diff: kept as it was, added, or removed. */
export interface DiffLine {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
}

/**
 * The lines `after` adds to and removes from `before`, in order (a longest common subsequence of
 * lines): enough to show what an addition changes in an entry's body.
 */
export function lineDiff(before: string, after: string): ReadonlyArray<DiffLine> {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  // lengths[i][j]: the common lines of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lengths[i]![j] =
        a[i] === b[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      lines.push({ kind: "removed", text: a[i]! });
      i += 1;
    } else {
      lines.push({ kind: "added", text: b[j]! });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) lines.push({ kind: "removed", text: a[i]! });
  for (; j < b.length; j += 1) lines.push({ kind: "added", text: b[j]! });
  return lines;
}

/** Relations that say something about meaning; `related` and `uncertain` only share words. */
const MEANINGFUL_RELATIONS = new Set(["conflicts", "extends", "same"]);

export function meaningfulRelations<R extends { readonly relation: string }>(
  relations: ReadonlyArray<R>,
): ReadonlyArray<R> {
  return relations.filter((relation) => MEANINGFUL_RELATIONS.has(relation.relation));
}

export type TopicSuggestion = "conflicts" | "same" | "extends" | "new";

/**
 * The review queue as topics: findings that kontext ties to the same kept entry, or that govern
 * the same directory, read as one topic with one suggested decision. Grouping is for reading
 * only; each finding is still kept or dismissed as its own entry, with its own conditions.
 */
export function knowledgeTopics<
  C extends {
    readonly id: string;
    readonly text: string;
    readonly paths?: ReadonlyArray<string> | undefined;
  },
>(
  candidates: ReadonlyArray<C>,
  relationsOf: ReadonlyMap<
    string,
    ReadonlyArray<{
      readonly entry: string;
      readonly title: string;
      readonly relation: string;
      readonly reason: string;
    }>
  >,
): ReadonlyArray<{
  readonly key: string;
  readonly title: string;
  readonly candidates: ReadonlyArray<C>;
  readonly suggestion: TopicSuggestion;
  /** The kept entry the topic is about, when kontext tied it to one. */
  readonly entry: string | null;
  readonly reasons: ReadonlyArray<string>;
}> {
  const parent = candidates.map((_, index) => index);
  const root = (index: number): number =>
    parent[index] === index ? index : (parent[index] = root(parent[index]!));
  const join = (a: number, b: number) => {
    parent[root(a)] = root(b);
  };
  const firstBy = new Map<string, number>();
  const link = (key: string, index: number) => {
    const first = firstBy.get(key);
    if (first === undefined) firstBy.set(key, index);
    else join(index, first);
  };
  candidates.forEach((candidate, index) => {
    for (const relation of meaningfulRelations(relationsOf.get(candidate.id) ?? []))
      link(`entry:${relation.entry}`, index);
    for (const path of candidate.paths ?? [])
      link(`dir:${path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path}`, index);
  });
  const members = new Map<number, C[]>();
  candidates.forEach((candidate, index) => {
    const key = root(index);
    members.set(key, [...(members.get(key) ?? []), candidate]);
  });
  const ORDER: Record<TopicSuggestion, number> = { conflicts: 0, extends: 1, new: 2, same: 3 };
  return [...members.values()]
    .map((group) => {
      const relations = group.map((candidate) =>
        meaningfulRelations(relationsOf.get(candidate.id) ?? []),
      );
      const all = relations.flat();
      const suggestion: TopicSuggestion = all.some((r) => r.relation === "conflicts")
        ? "conflicts"
        : relations.every((own) => own.some((r) => r.relation === "same"))
          ? "same"
          : all.length > 0
            ? "extends"
            : "new";
      const shared = all.find((relation) =>
        relations.every((own) => own.some((r) => r.entry === relation.entry)),
      );
      const first = group[0]!;
      const sentence = /^(.+?[.!?])(\s|$)/.exec(first.text)?.[1] ?? first.text;
      return {
        key: first.id,
        title:
          shared?.title ??
          (sentence.length > 80 ? `${sentence.slice(0, 79).trimEnd()}…` : sentence),
        candidates: group,
        suggestion,
        entry: shared?.title ?? null,
        reasons: [
          ...new Set(
            all.map(
              (relation) =>
                `${relationOffer(relation.relation).label} “${relation.title}”${relation.reason === "" ? "" : `: ${relation.reason}`}`,
            ),
          ),
        ],
      };
    })
    .toSorted(
      (a, b) =>
        ORDER[a.suggestion] - ORDER[b.suggestion] || b.candidates.length - a.candidates.length,
    );
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

/** Lines past which a failed check's output starts folded. */
const OUTPUT_FOLDED_LINES = 6;

/**
 * What a drift challenge says of the entry's own check when Peer ran it before filing and it did not
 * pass: a headline ("Its check failed at a7a72ec: `cargo test money` exited 101"), the end of its
 * output, and whether that output is long enough to start folded. Null when no check failed.
 */
export function failedCheckSummary(drift: {
  readonly verify?:
    | {
        readonly passed: boolean;
        readonly command: string;
        readonly exitCode: number | null;
        readonly outputTail: string;
        readonly commit: string | null;
      }
    | undefined;
}): { readonly headline: string; readonly output: string; readonly folded: boolean } | null {
  const check = drift.verify;
  if (check === undefined || check.passed) return null;
  const at = check.commit === null ? "" : ` at ${check.commit.slice(0, 7)}`;
  const end = check.exitCode === null ? "did not finish" : `exited ${check.exitCode}`;
  const output = check.outputTail.trimEnd();
  return {
    headline: `Its check failed${at}: \`${check.command}\` ${end}`,
    output,
    folded: output.split("\n").length > OUTPUT_FOLDED_LINES,
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
 * Whether people can trust an entry, apart from whether it is current: verified when a person
 * confirmed it or its own check passed at a commit nothing on its paths changed since, stamped when
 * the latest confirmation was an agent's or one of many at once (a look, not a check), needs review
 * when its code changed since, its check failed or someone questioned it, unverified when nothing
 * was ever recorded. A kontext before the verification ledger gives only a date, which counts as
 * verified as it always did.
 */
export type EntryHealth = "verified" | "stamped" | "needs-review" | "unverified";

export function entryHealth(entry: EntryProvenance, validity: EntryValidity): EntryHealth {
  if (validity !== "current" || (entry.since?.commits ?? 0) > 0) return "needs-review";
  const verification = entry.verification;
  if (verification === undefined) return entry.checked === undefined ? "unverified" : "verified";
  switch (verification.kind) {
    case "read":
      return "verified";
    case "cache":
      // kontext 0.10.0: a `checked:` date nobody recorded in the ledger is a look, not a verification.
      return "stamped";
    case "verify":
      return verification.passed === true
        ? "verified"
        : verification.passed === false
          ? "needs-review"
          : "stamped";
    default:
      return "stamped";
  }
}

/** How many entries are in each health state, counted from the entries. */
export function knowledgeHealth(
  entries: ReadonlyArray<EntryProvenance & { readonly id: string }>,
  validityOf: (entry: string) => EntryValidity,
): Readonly<Record<EntryHealth, number>> {
  const counts = { verified: 0, stamped: 0, "needs-review": 0, unverified: 0 };
  for (const entry of entries) counts[entryHealth(entry, validityOf(entry.id))] += 1;
  return counts;
}

/** Entries an entry builds on that no longer stand, as a question to review, not a verdict. */
export function premiseNotices(entry: {
  readonly premises?: ReadonlyArray<PeerKnowledgePremise> | undefined;
}): ReadonlyArray<string> {
  return (entry.premises ?? []).map(
    (premise) =>
      `Builds on ${premise.id}, which is ${premise.status}: review whether this still holds.`,
  );
}

/** What changed under each entry, from its open drift challenge: the first paths and commits. */
export function driftSummaries(
  rows: ReadonlyArray<{
    readonly challenge: {
      readonly entry: string;
      readonly status: string;
      readonly drift?:
        | {
            readonly head: string;
            readonly commits: ReadonlyArray<string>;
            readonly paths: ReadonlyArray<string>;
          }
        | undefined;
    };
    readonly commits?:
      | ReadonlyArray<{ readonly sha: string; readonly subject: string }>
      | undefined;
  }>,
): ReadonlyMap<string, ReturnType<typeof driftSummary>> {
  const summaries = new Map<string, ReturnType<typeof driftSummary>>();
  for (const row of rows) {
    const { challenge } = row;
    if (challenge.drift === undefined || summaries.has(challenge.entry)) continue;
    if (challenge.status !== "open" && challenge.status !== "resolving") continue;
    summaries.set(challenge.entry, driftSummary(challenge.drift, row.commits ?? []));
  }
  return summaries;
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
