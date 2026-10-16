/**
 * The owner map editor's draft, as pure functions: the rows a lead edits (an owner for each area,
 * and for each path pattern whether the owner decides), what each edit comes to, what the Hub
 * would refuse and what an edit changes in who decides (a more specific pattern takes paths from
 * a wider one). A save names the map version it was made from, and the Hub refuses it when the
 * map changed since; the draft then rebases onto the map that is saved now, keeping every edit
 * the person made and taking what others changed in the rest, so saving again never undoes
 * someone else's save.
 */
import {
  comparePatterns,
  matchesPattern,
  validatePathPattern,
} from "@t3tools/client-runtime/peer-settings";
import { ownerName, type ProjectOwnership } from "@t3tools/client-runtime/peer/ownership";
import {
  PEER_OWNERSHIP_LIMITS,
  type PeerOwnerMap,
  type PeerOwnershipSetMapInput,
} from "@t3tools/contracts";

/** What of an owner map the editor edits; the rest (version, who saved it) is the Hub's. */
export type MapParts = Pick<PeerOwnerMap, "areas" | "paths" | "decide">;

/** An area of the draft: who owns it, as the person sets it (null: nobody). */
export interface DraftArea {
  readonly area: string;
  readonly owner: string | null;
  /** The project does not list this area any more: the map still holds its owner. */
  readonly stale: boolean;
}

/** A path pattern of the draft, with its owner and whether the owner decides changes by others. */
export interface DraftPath {
  /** Stays while the person types in the row, so the row keeps its place and its focus. */
  readonly id: string;
  readonly pattern: string;
  readonly owner: string | null;
  readonly decides: boolean;
}

export interface OwnerMapDraft {
  /** The saved map the draft was made from: a save names its version. */
  readonly base: PeerOwnerMap;
  readonly areas: ReadonlyArray<DraftArea>;
  readonly paths: ReadonlyArray<DraftPath>;
  /** How many row ids were handed out. */
  readonly serial: number;
}

const compareCodePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const ownerOf = (record: Readonly<Record<string, string>>, key: string): string | null =>
  Object.hasOwn(record, key) ? (record[key] ?? null) : null;

/** The patterns of a map, in alphabetical order: those with an owner and those where one decides. */
const patternsOf = (parts: MapParts): ReadonlyArray<string> =>
  [...new Set([...Object.keys(parts.paths), ...parts.decide])].toSorted(compareCodePoints);

/** The draft of a saved map: the project's areas in its order, then those the map holds that it does not. */
export function draftOf(map: PeerOwnerMap, projectAreas: ReadonlyArray<string>): OwnerMapDraft {
  const known = new Set(projectAreas);
  const stale = Object.keys(map.areas)
    .filter((area) => !known.has(area))
    .toSorted(compareCodePoints);
  const patterns = patternsOf(map);
  return {
    base: map,
    areas: [
      ...projectAreas.map((area) => ({ area, owner: ownerOf(map.areas, area), stale: false })),
      ...stale.map((area) => ({ area, owner: ownerOf(map.areas, area), stale: true })),
    ],
    paths: patterns.map((pattern, index) => ({
      id: `p${index + 1}`,
      pattern,
      owner: ownerOf(map.paths, pattern),
      decides: map.decide.includes(pattern),
    })),
    serial: patterns.length,
  };
}

/** A row with nothing in it: a row just added, which a save leaves out. */
const blank = (row: DraftPath) => row.pattern.trim() === "" && row.owner === null && !row.decides;

/** The map the draft would save: every row that says something, patterns trimmed. */
export function draftMap(draft: OwnerMapDraft): MapParts {
  const paths: Record<string, string> = {};
  const decide = new Set<string>();
  for (const row of draft.paths) {
    const pattern = row.pattern.trim();
    if (pattern === "") continue;
    if (row.owner !== null) paths[pattern] = row.owner;
    if (row.decides) decide.add(pattern);
  }
  return {
    areas: Object.fromEntries(
      draft.areas.flatMap(({ area, owner }) => (owner === null ? [] : [[area, owner] as const])),
    ),
    paths,
    decide: [...decide].toSorted(compareCodePoints),
  };
}

/** What a save sends: the whole map the person wants, from the version they opened. */
export function saveInput(
  draft: OwnerMapDraft,
  ids: { readonly workspace: string; readonly project: string },
): PeerOwnershipSetMapInput {
  return { ...ids, version: draft.base.version, ...draftMap(draft) };
}

export function setAreaOwner(
  draft: OwnerMapDraft,
  area: string,
  owner: string | null,
): OwnerMapDraft {
  return {
    ...draft,
    areas: draft.areas.map((row) => (row.area === area ? { ...row, owner } : row)),
  };
}

export function editPath(
  draft: OwnerMapDraft,
  id: string,
  edit: Partial<Pick<DraftPath, "pattern" | "owner" | "decides">>,
): OwnerMapDraft {
  return { ...draft, paths: draft.paths.map((row) => (row.id === id ? { ...row, ...edit } : row)) };
}

/** Adds an empty row at the end; a map holds only so many patterns. */
export function addPath(draft: OwnerMapDraft): OwnerMapDraft {
  if (draft.paths.length >= PEER_OWNERSHIP_LIMITS.patterns) return draft;
  const serial = draft.serial + 1;
  return {
    ...draft,
    serial,
    paths: [...draft.paths, { id: `p${serial}`, pattern: "", owner: null, decides: false }],
  };
}

export function removePath(draft: OwnerMapDraft, id: string): OwnerMapDraft {
  return { ...draft, paths: draft.paths.filter((row) => row.id !== id) };
}

/** Whether another row fits: an owner map names at most 50 patterns. */
export const canAddPath = (draft: OwnerMapDraft): boolean =>
  draft.paths.length < PEER_OWNERSHIP_LIMITS.patterns;

/** An area whose owner changed. */
interface AreaChange {
  readonly kind: "area";
  readonly area: string;
  readonly from: string | null;
  readonly to: string | null;
}

/** What a pattern comes to: an owner and whether they decide; absent where it has neither. */
interface PatternEntry {
  readonly owner: string | null;
  readonly decides: boolean;
}

/** A pattern that was added, taken out or changed. */
interface PathChange {
  readonly kind: "path";
  readonly pattern: string;
  readonly from: PatternEntry | null;
  readonly to: PatternEntry | null;
}

export type MapChange = AreaChange | PathChange;

const entryOf = (parts: MapParts, pattern: string): PatternEntry | null => {
  const owner = ownerOf(parts.paths, pattern);
  const decides = parts.decide.includes(pattern);
  return owner === null && !decides ? null : { owner, decides };
};

const sameEntry = (a: PatternEntry | null, b: PatternEntry | null): boolean =>
  a === null || b === null ? a === b : a.owner === b.owner && a.decides === b.decides;

/** What `to` changes in `from`: each area whose owner differs and each pattern added, taken out or changed. */
export function mapChanges(from: MapParts, to: MapParts): ReadonlyArray<MapChange> {
  const changes: MapChange[] = [];
  const areas = [...new Set([...Object.keys(from.areas), ...Object.keys(to.areas)])].toSorted(
    compareCodePoints,
  );
  for (const area of areas) {
    const [before, after] = [ownerOf(from.areas, area), ownerOf(to.areas, area)];
    if (before !== after) changes.push({ kind: "area", area, from: before, to: after });
  }
  const patterns = [...new Set([...patternsOf(from), ...patternsOf(to)])].toSorted(
    compareCodePoints,
  );
  for (const pattern of patterns) {
    const [before, after] = [entryOf(from, pattern), entryOf(to, pattern)];
    if (!sameEntry(before, after)) changes.push({ kind: "path", pattern, from: before, to: after });
  }
  return changes;
}

/** How many changes the draft makes to the map it was made from. */
export const changeCount = (draft: OwnerMapDraft): number =>
  mapChanges(draft.base, draftMap(draft)).length;

/**
 * One change in words, after a name: "made Cyril owner of the area Menu", "made Cyril the owner of
 * src/menu/**", "took the owner off src/menu/**", "set src/payments/** to owner decides". `name`
 * says who an address is.
 */
export function changeWords(change: MapChange, name: (email: string) => string): string {
  if (change.kind === "area") {
    return change.to === null
      ? `took the owner off the area ${change.area}`
      : `made ${name(change.to)} owner of the area ${change.area}`;
  }
  const { pattern, from, to } = change;
  if (to === null) return `took ${pattern} off the owner map`;
  const owner = to.owner === null ? undefined : name(to.owner);
  if (from === null) {
    if (owner === undefined) return `set ${pattern} to owner decides`;
    return `made ${owner} the owner of ${pattern}${to.decides ? ", where the owner decides" : ""}`;
  }
  const parts: string[] = [];
  if (from.owner !== to.owner) {
    parts.push(
      owner === undefined
        ? `took the owner off ${pattern}`
        : `made ${owner} the owner of ${pattern}`,
    );
  }
  if (from.decides !== to.decides) {
    parts.push(
      to.decides ? `set ${pattern} to owner decides` : `took owner decides off ${pattern}`,
    );
  }
  return parts.join(" and ");
}

/** Whether the person set this area's owner: it differs from the map the draft was made from. */
export const areaEdited = (draft: OwnerMapDraft, row: DraftArea): boolean =>
  row.owner !== ownerOf(draft.base.areas, row.area);

/**
 * Whether the person added or changed this pattern's row: it is not as the map the draft was made
 * from has it. A row with nothing in it is not an edit yet.
 */
export function pathEdited(draft: OwnerMapDraft, row: DraftPath): boolean {
  if (blank(row)) return false;
  const pattern = row.pattern.trim();
  return (
    pattern === "" ||
    !sameEntry(entryOf(draft.base, pattern), { owner: row.owner, decides: row.decides })
  );
}

/** The characters coordination path patterns do not take. */
const UNSUPPORTED = "?[]{}!";

/**
 * A guess at the pattern the person meant, for one that uses what patterns cannot: each group or
 * mark that is not `/`, `*` or `**` becomes a `*`, and a run of them one. Undefined where the
 * guess is no better.
 */
function suggestion(pattern: string): string | undefined {
  const guess = pattern
    .replace(/\[[^\]]*\]|\{[^}]*\}/gu, "*")
    .replace(/[?![\]{}]/gu, "*")
    .split("/")
    .map((segment) => (segment === "**" ? segment : segment.replace(/\*+/gu, "*")))
    .join("/");
  return guess !== pattern && validatePathPattern(guess) === null ? guess : undefined;
}

/**
 * Why a pattern would be refused, in a sentence for the row; null for a good one. The words of the
 * Hub's own rule, which `validatePathPattern` mirrors, with the characters it does not take named
 * and, where there is a likely fix, a pattern to try.
 */
export function patternProblem(pattern: string): string | null {
  const refused = validatePathPattern(pattern);
  if (refused === null) return null;
  const found = [...new Set([...pattern].filter((char) => UNSUPPORTED.includes(char)))];
  if (found.length > 0) {
    // A pair of brackets is one thing that is not allowed, not two.
    const pair = ["[]", "{}"].includes(found.toSorted().join(""));
    const guess = suggestion(pattern);
    return `Patterns use /, * and ** only: ${found.join(" ")} ${found.length === 1 || pair ? "is" : "are"} not allowed.${
      guess === undefined ? "" : ` Try ${guess}.`
    }`;
  }
  return `${refused.charAt(0).toUpperCase()}${refused.slice(1)}.`;
}

/**
 * What stops each row of the draft from being saved, by row id: a pattern the Hub would refuse, one
 * listed twice, a pattern without an owner, an owner with no pattern. A row with nothing in it is
 * left out of a save, so it stops nothing.
 */
export function rowProblems(draft: OwnerMapDraft): ReadonlyMap<string, string> {
  const problems = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const row of draft.paths) {
    if (blank(row)) continue;
    const pattern = row.pattern.trim();
    if (pattern === "") {
      problems.set(row.id, "Type a pattern, or remove the row.");
      continue;
    }
    const refused = patternProblem(pattern);
    if (refused !== null) {
      problems.set(row.id, refused);
      continue;
    }
    if (seen.has(pattern)) {
      problems.set(row.id, `${pattern} is already listed above.`);
      continue;
    }
    seen.set(pattern, row.id);
    if (row.owner === null) problems.set(row.id, "Choose an owner.");
  }
  return problems;
}

/** Whether the draft can be saved: it changes something and nothing stops it. */
export const canSave = (draft: OwnerMapDraft): boolean =>
  changeCount(draft) > 0 && rowProblems(draft).size === 0;

/** "3 changes from version 7 · 1 pattern needs fixing": what the bar under the editor says. */
export function footerText(draft: OwnerMapDraft): string {
  const changes = changeCount(draft);
  const problems = rowProblems(draft).size;
  const changed =
    changes === 0
      ? `No changes from version ${draft.base.version}`
      : `${changes} ${changes === 1 ? "change" : "changes"} from version ${draft.base.version}`;
  return problems === 0
    ? changed
    : `${changed} · ${problems} ${problems === 1 ? "pattern needs" : "patterns need"} fixing`;
}

/** A path the pattern matches, to ask which wider patterns match it too: each wildcard stands for one word. */
function sampleOf(pattern: string): string {
  return pattern
    .split("/")
    .map((segment) => (segment === "**" ? "x" : segment.replace(/\*/gu, "x")))
    .join("/");
}

/**
 * What a pattern names, for a sentence: "refunds" for `src/payments/refunds/**` (a folder, said in
 * the plural), "fees.ts" for `src/payments/fees.ts` (one file), "paths matching it" for a pattern
 * with a wildcard in its last name.
 */
function nounOf(pattern: string): { readonly text: string; readonly plural: boolean } {
  const segments = pattern.split("/");
  const folder = segments.at(-1) === "**";
  if (folder) segments.pop();
  const last = segments.at(-1);
  return last === undefined || last === "" || last.includes("*")
    ? { text: "paths matching it", plural: true }
    : { text: last, plural: folder };
}

/**
 * For each row the person added or changed, what it does to the wider pattern that covers it: it is
 * the more specific, so the paths it matches become its owner's and the wider owner no longer
 * decides them. "More specific than src/payments/**: refunds become Bob’s, and Ana no longer decides
 * them." A row that changes neither who owns nor who decides says nothing. By row id.
 */
export function rowNotes(
  draft: OwnerMapDraft,
  ownership: Pick<ProjectOwnership, "people">,
): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  const problems = rowProblems(draft);
  const rows = draft.paths.filter(
    (row) =>
      !blank(row) && row.pattern.trim() !== "" && patternProblem(row.pattern.trim()) === null,
  );
  const base = draft.base;
  for (const row of rows) {
    const pattern = row.pattern.trim();
    if (problems.has(row.id) || row.owner === null) continue;
    // Only what the person did: a row as the saved map has it explains nothing new.
    if (sameEntry(entryOf(base, pattern), { owner: row.owner, decides: row.decides })) continue;
    const sample = sampleOf(pattern);
    const wider = rows
      .filter(
        (other) =>
          other.id !== row.id &&
          other.owner !== null &&
          other.pattern.trim() !== pattern &&
          comparePatterns(pattern, other.pattern.trim()) < 0 &&
          matchesPattern(other.pattern.trim(), sample),
      )
      .toSorted((a, b) => comparePatterns(a.pattern.trim(), b.pattern.trim()))[0];
    if (wider === undefined || wider.owner === null) continue;
    const [mine, theirs] = [ownerName(ownership, row.owner), ownerName(ownership, wider.owner)];
    const sameOwner = row.owner === wider.owner;
    const what = nounOf(pattern);
    const clauses = [
      sameOwner
        ? `${what.text} ${what.plural ? "stay" : "stays"} ${mine}’s`
        : `${what.text} ${what.plural ? "become" : "becomes"} ${mine}’s`,
      ...(wider.decides && !row.decides
        ? [`${theirs} no longer decides ${what.plural ? "them" : "it"}`]
        : []),
      ...(!wider.decides && row.decides ? [`${mine} decides changes by others there`] : []),
    ];
    if (sameOwner && clauses.length === 1) continue;
    notes.set(row.id, `More specific than ${wider.pattern.trim()}: ${clauses.join(", and ")}.`);
  }
  return notes;
}

/**
 * The draft on top of the map that is saved now, after a save found the map changed since the
 * draft was made. Every edit of the person stays (an owner they set, a pattern they added, edited
 * or took out), and everything they left alone follows the saved map, so what the other save
 * changed is not undone by saving again. The draft is then made from the new version.
 */
export function rebase(
  draft: OwnerMapDraft,
  current: PeerOwnerMap,
  projectAreas: ReadonlyArray<string>,
): OwnerMapDraft {
  const was = draft.base;
  // Areas: what the person set stays; the rest is the saved map's.
  const extra = [...new Set([...Object.keys(current.areas), ...Object.keys(was.areas)])]
    .filter((area) => !projectAreas.includes(area))
    .toSorted(compareCodePoints);
  const areaNames = [...projectAreas, ...extra];
  const areas: DraftArea[] = areaNames.map((area) => {
    const row = draft.areas.find((candidate) => candidate.area === area);
    const edited = row !== undefined && row.owner !== ownerOf(was.areas, area);
    return {
      area,
      owner: edited ? row.owner : ownerOf(current.areas, area),
      stale: !projectAreas.includes(area),
    };
  });
  // Patterns: a row the person added or changed stays as it is; a row they left alone follows the
  // saved map, and goes where that took it out; a pattern they took out stays out.
  let serial = draft.serial;
  const paths: DraftPath[] = [];
  const named = new Set<string>();
  for (const row of draft.paths) {
    const pattern = row.pattern.trim();
    if (pattern === "") {
      paths.push(row);
      continue;
    }
    named.add(pattern);
    const before = entryOf(was, pattern);
    const edited =
      !sameEntry(before, { owner: row.owner, decides: row.decides }) || before === null;
    if (edited) {
      paths.push(row);
      continue;
    }
    const after = entryOf(current, pattern);
    if (after !== null) paths.push({ ...row, owner: after.owner, decides: after.decides });
  }
  for (const pattern of patternsOf(current)) {
    // Taken out by the person, who named it in the map they started from.
    if (named.has(pattern) || entryOf(was, pattern) !== null) continue;
    serial += 1;
    const after = entryOf(current, pattern);
    paths.push({
      id: `p${serial}`,
      pattern,
      owner: after?.owner ?? null,
      decides: after?.decides ?? false,
    });
  }
  return { base: current, areas, paths, serial };
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/**
 * What the editor says when a save found the map changed: who saved the version that is there now
 * and what they changed, and that the person's edits are kept for them to review. `by` is the name
 * of the person who saved it (undefined where the Hub does not say), `lead` whether they lead the
 * project, `theirs` what they changed in words (`changeWords`), `edits` how many edits the draft
 * still makes on top of their version.
 */
export function conflictText(input: {
  readonly version: number;
  readonly by: string | undefined;
  readonly lead: boolean;
  readonly theirs: ReadonlyArray<string>;
  readonly edits: number;
}): { readonly title: string; readonly body: string } {
  const { version, by, edits } = input;
  const who = by === undefined ? "Someone" : input.lead ? `${by}, a lead,` : by;
  const [first, ...more] = input.theirs;
  const changed =
    first === undefined
      ? ""
      : `${by ?? "They"} ${first}${more.length === 0 ? "" : ` and ${more.length} more ${more.length === 1 ? "change" : "changes"}`}. `;
  const kept =
    edits === 0
      ? `Version ${version} already has your edits.`
      : edits === 1
        ? `Your edit is kept below; review it against version ${version} and save again.`
        : `Your ${NUMBER_WORDS[edits] ?? edits} edits are kept below; review them against version ${version} and save again.`;
  return {
    title: `${who} saved version ${version} while you were editing`,
    body: `${changed}${kept}`,
  };
}
