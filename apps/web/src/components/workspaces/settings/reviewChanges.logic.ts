/**
 * What the review of a change shows and sends, apart from how it draws: the operations a review
 * runs, the call each one makes as a dry run and as a save, the step an answer leads to, the notes
 * under "Before you save", and the sentences of the conflict and saved views (design artboard 03).
 */
import type {
  PeerSettingsApplyProposalInput,
  PeerSettingsApplies,
  PeerSettingsChangeInput,
  PeerSettingsChangeResult,
  PeerSettingsConflict,
  PeerSettingsDiagnostic,
  PeerSettingsGatewayOutcome,
  PeerSettingsImportInput,
  PeerSettingsLine,
  PeerSettingsPath,
  PeerSettingsPreview,
  PeerSettingsRefusal,
  PeerSettingsRevertInput,
  PeerSettingsSaved,
  PeerSettingsSet,
} from "@t3tools/contracts";

import { setAt } from "@t3tools/client-runtime/peer-settings";

import type { SettingsDocument } from "./settingsView.logic";

type Path = ReadonlyArray<string>;

/**
 * What a review is of. Every one is a change on the Hub's head that the review first runs as a dry
 * run: a draft's sets against the revision it started from, the inverse of a revision, YAML files, or
 * a proposal an owner applies.
 */
export type ReviewOperation =
  | {
      readonly kind: "save";
      readonly workspace: string;
      readonly base: number;
      readonly set: ReadonlyArray<PeerSettingsSet>;
    }
  | { readonly kind: "revert"; readonly workspace: string; readonly seq: number }
  | {
      readonly kind: "import";
      readonly workspace: string;
      /** File path → YAML, as `exportYaml` gives them. */
      readonly files: Readonly<Record<string, string>>;
      readonly base?: number | undefined;
    }
  | { readonly kind: "proposal"; readonly workspace: string; readonly id: string };

/** How conflicts were settled: `force` takes my value, `drop` keeps theirs. */
export interface Settle {
  readonly force: ReadonlyArray<PeerSettingsPath>;
  readonly drop: ReadonlyArray<PeerSettingsPath>;
}

export const NO_SETTLE: Settle = { force: [], drop: [] };

/**
 * What a save did with the changes it came from: `dropped` when some were given up for what others
 * saved ("Discard mine"), so the page's draft is not what the settings are now.
 */
export interface SavedOutcome {
  readonly dropped: boolean;
}

/** The longest reason the Hub takes. */
export const WHY_MAX = 300;

/** A dry run, or the save itself. */
export type ReviewMode = "preview" | "save";

/** The command to run and the input to give it. */
export type ChangeCall =
  | { readonly command: "preview"; readonly input: PeerSettingsChangeInput }
  | { readonly command: "save"; readonly input: PeerSettingsChangeInput }
  | { readonly command: "revert"; readonly input: PeerSettingsRevertInput }
  | { readonly command: "importYaml"; readonly input: PeerSettingsImportInput }
  | { readonly command: "applyProposal"; readonly input: PeerSettingsApplyProposalInput };

/**
 * The call an operation makes. A draft's changes have a command for each mode; the others are the
 * save's own command with `dryRun` for the preview. The reason and how conflicts were settled go
 * with both, so the preview after "Discard mine" shows what the save will do.
 */
export function changeCall(
  operation: ReviewOperation,
  mode: ReviewMode,
  extras: { readonly message: string; readonly settle: Settle },
): ChangeCall {
  const message = extras.message.trim();
  const settling = {
    ...(message === "" ? {} : { message }),
    ...(extras.settle.force.length === 0 ? {} : { force: extras.settle.force }),
    ...(extras.settle.drop.length === 0 ? {} : { drop: extras.settle.drop }),
  };
  const dry = mode === "preview" ? { dryRun: true } : {};
  switch (operation.kind) {
    case "save":
      return {
        command: mode,
        input: {
          workspace: operation.workspace,
          base: operation.base,
          set: operation.set,
          ...settling,
        },
      };
    case "revert":
      return {
        command: "revert",
        input: { workspace: operation.workspace, seq: operation.seq, ...dry, ...settling },
      };
    case "import":
      return {
        command: "importYaml",
        input: {
          workspace: operation.workspace,
          files: operation.files,
          ...(operation.base === undefined ? {} : { base: operation.base }),
          ...dry,
          ...settling,
        },
      };
    case "proposal":
      return {
        command: "applyProposal",
        input: { workspace: operation.workspace, id: operation.id, ...dry, ...settling },
      };
  }
}

/** The document a draft's sets make of `document`: a `null` value removes the node. */
export function applySets(
  document: SettingsDocument,
  set: ReadonlyArray<PeerSettingsSet>,
): SettingsDocument {
  return set.reduce<SettingsDocument>(
    (current, { path, value }) => setAt(current, path, value === null ? undefined : value),
    document,
  );
}

/** Where the review stands. A save that fails stays on the view it was made from, with its message. */
export type Step =
  | { readonly kind: "previewing" }
  | { readonly kind: "review"; readonly preview: PeerSettingsPreview }
  | { readonly kind: "conflict"; readonly preview: PeerSettingsPreview }
  | { readonly kind: "forbidden"; readonly refused: ReadonlyArray<PeerSettingsRefusal> }
  | { readonly kind: "invalid"; readonly diagnostics: ReadonlyArray<PeerSettingsDiagnostic> }
  | { readonly kind: "saved"; readonly saved: PeerSettingsSaved }
  /** The dry run could not be made: the Hub could not be asked, or failed. */
  | { readonly kind: "failed"; readonly message: string };

/**
 * The step an answer leads to. A dry run that finds conflicts answers 200 with them listed, a save
 * that meets them answers 409; both are the conflict view, since a save of either would be refused.
 */
export function stepFor(result: PeerSettingsChangeResult): Step {
  switch (result.kind) {
    case "preview":
      return result.conflicts.length > 0
        ? { kind: "conflict", preview: result }
        : { kind: "review", preview: result };
    case "conflict":
      return { kind: "conflict", preview: result };
    case "forbidden":
      return { kind: "forbidden", refused: result.refused };
    case "invalid":
      return { kind: "invalid", diagnostics: result.diagnostics };
    case "saved":
      return { kind: "saved", saved: result };
  }
}

/** Nothing would change: the draft is what the head already is. */
export const isNoop = (preview: PeerSettingsPreview): boolean =>
  preview.noop || preview.lines.length === 0;

export const saveLabel = (count: number): string =>
  `Save ${count} ${count === 1 ? "change" : "changes"}`;

/**
 * What a line is about in the table of a review of `scope`: its label, with the scope's name in
 * front when it is not the one the review is of ("Tool catalog · Postgres staging").
 */
export const lineWhere = (line: PeerSettingsLine, scope: string): string =>
  line.scope.name === scope ? line.label : `${line.scope.name} · ${line.label}`;

/** A line as one sentence, as the Hub writes its summary: `Booking · Coordination: notify → coordinate`. */
export const lineSummary = (line: PeerSettingsLine): string =>
  `${line.scope.name} · ${line.label}: ${line.from} → ${line.to}`;

/**
 * The lines with a key each, for a list that draws them: a line's path and words, and a counter for
 * the rare line that repeats another's exactly, so rows keep their identity without their index.
 */
export function lineKeys(
  lines: ReadonlyArray<PeerSettingsLine>,
): ReadonlyArray<{ readonly key: string; readonly line: PeerSettingsLine }> {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = `${line.path.join("/")}|${line.label}|${line.from}|${line.to}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: count === 0 ? base : `${base}#${count}`, line };
  });
}

/** What a review of lines in several scopes is "to": their names, or how many there are. */
export function scopeNameOf(lines: ReadonlyArray<PeerSettingsLine>, fallback: string): string {
  const names = [...new Set(lines.map((line) => line.scope.name))];
  if (names.length === 0) return fallback;
  return names.length <= 2 ? names.join(" and ") : `${names.length} places`;
}

// ---- before you save -----------------------------------------------------------------------------

export interface Note {
  /** A warning has an amber dot, a note a blue one. */
  readonly tone: "warning" | "info";
  readonly text: string;
}

/** The Hub's `warning`s are amber; what is not one it knows by name (`info`) is blue. */
export const diagnosticTone = (severity: string): Note["tone"] =>
  severity === "info" ? "info" : "warning";

export interface ToolNoteContext {
  readonly document: SettingsDocument | null;
  /** The workspace's members, for a project that takes all of them. */
  readonly workspacePeople: number;
}

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textsOf = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** A project's tool as the document lists it: the tool's id, or the id with the project's own environment. */
const toolIdOf = (entry: unknown): string | undefined =>
  typeof entry === "string" ? entry : isMapping(entry) ? stringOf(entry.tool) : undefined;

/** The people on a project entry: all of the workspace for `["*"]`, else its members and leads. */
function peopleOf(entry: Readonly<Record<string, unknown>>): ReadonlySet<string> | "everyone" {
  const members = textsOf(entry.members);
  if (members.includes("*")) return "everyone";
  return new Set([...members, ...textsOf(entry.leads)].map((address) => address.toLowerCase()));
}

/** How many people are on a project; null where the document does not have it. */
function projectPeople(context: ToolNoteContext, id: string): number | null {
  const projects = context.document?.projects;
  const entry = isMapping(projects) && Object.hasOwn(projects, id) ? projects[id] : undefined;
  if (!isMapping(entry)) return null;
  const people = peopleOf(entry);
  return people === "everyone" ? context.workspacePeople : people.size;
}

/** How many people are on a project that uses the tool. */
function toolUsers(context: ToolNoteContext, toolId: string): number {
  const projects = context.document?.projects;
  if (!isMapping(projects)) return 0;
  const users = new Set<string>();
  for (const entry of Object.values(projects)) {
    if (!isMapping(entry) || !Array.isArray(entry.tools)) continue;
    if (!entry.tools.some((tool) => toolIdOf(tool) === toolId)) continue;
    const people = peopleOf(entry);
    if (people === "everyone") return context.workspacePeople;
    for (const address of people) users.add(address);
  }
  return users.size;
}

const peopleText = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;
const APPROVES = "on their own computer before their agents get it";
const ADDED = /^(.+) added$/;

/**
 * The notes a tool change comes with: a tool added to a project is new for the people on it, and a
 * tool of the catalog that changes is to be approved again by everyone whose project uses it. Each
 * person approves on their own computer, and the Hub says so only as "after each person approves
 * it", so the count comes from the document.
 */
export function toolApprovalNotes(
  lines: ReadonlyArray<PeerSettingsLine>,
  applies: ReadonlyArray<PeerSettingsApplies>,
  context: ToolNoteContext,
): ReadonlyArray<Note> {
  const notes = new Map<string, string>();
  for (const line of lines) {
    const [section, id, field] = line.path;
    if (section === "projects" && field === "tools" && id !== undefined) {
      const added = ADDED.exec(line.to)?.[1];
      if (added === undefined) continue;
      const people = projectPeople(context, id);
      notes.set(
        `${id}/${added}`,
        people === null
          ? `${added} is new. Each person approves it ${APPROVES}.`
          : `${added} is new for ${peopleText(people)}. Each approves it ${APPROVES}.`,
      );
    } else if (section === "tools" && id !== undefined) {
      const users = toolUsers(context, id);
      if (users > 0) {
        notes.set(
          `tool/${id}`,
          `${line.label} changes for ${peopleText(users)}. Each approves it again ${APPROVES}.`,
        );
      }
    }
  }
  if (notes.size === 0 && applies.some((entry) => entry.kind === "after-approval")) {
    notes.set("any", `Each person approves a new or changed tool ${APPROVES}.`);
  }
  return [...notes.values()].map((text) => ({ tone: "info" as const, text }));
}

/** Everything under "Before you save": the tool notes, then what the check found. */
export function checkNotes(
  preview: Pick<PeerSettingsPreview, "lines" | "applies" | "diagnostics">,
  context: ToolNoteContext,
): ReadonlyArray<Note> {
  const notes = [
    ...toolApprovalNotes(preview.lines, preview.applies, context),
    ...preview.diagnostics.map((diagnostic) => ({
      tone: diagnosticTone(diagnostic.severity),
      text: diagnostic.message,
    })),
  ];
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = `${note.tone}|${note.text}`;
    return !seen.has(key) && seen.add(key);
  });
}

/**
 * What the review says when settings were saved after the revision the changes are based on and none
 * of it conflicts with them: that the head moved, who saved last, and that both stay. The head is
 * the workspace's latest revision, so this does not say what was saved where, only that it is
 * compatible with the changes.
 */
export function mergedNote(
  preview: Pick<PeerSettingsPreview, "base" | "head" | "conflicts">,
  input: { readonly name: string; readonly now: number },
): Note | null {
  if (preview.conflicts.length > 0 || preview.head.seq <= preview.base) return null;
  const when = agoText(preview.head.at, input.now);
  return {
    tone: "info",
    text: `Settings were saved after revision ${preview.base}: the latest, revision ${preview.head.seq}, by ${input.name} ${when}. None of it conflicts with these changes, so both stay.`,
  };
}

/** "When it applies": what each kind of change waits for, on one line. */
export const appliesText = (applies: ReadonlyArray<PeerSettingsApplies>): string =>
  [...new Set(applies.map((entry) => entry.text))].join(" · ");

// ---- conflicts -----------------------------------------------------------------------------------

export type Choice = "mine" | "theirs";

export const conflictKey = (path: Path): string => JSON.stringify(path);

/** Every conflict starts on my value, as the design's radio buttons do. */
export function defaultChoices(
  conflicts: ReadonlyArray<PeerSettingsConflict>,
): Readonly<Record<string, Choice>> {
  return Object.fromEntries(conflicts.map((conflict) => [conflictKey(conflict.path), "mine"]));
}

/** The settlement of the choices: my value is forced where picked, theirs kept where not. */
export function settlement(
  conflicts: ReadonlyArray<PeerSettingsConflict>,
  choices: Readonly<Record<string, Choice>>,
): Settle {
  const picked = (conflict: PeerSettingsConflict): Choice =>
    choices[conflictKey(conflict.path)] ?? "mine";
  return {
    force: conflicts.filter((conflict) => picked(conflict) === "mine").map(({ path }) => path),
    drop: conflicts.filter((conflict) => picked(conflict) === "theirs").map(({ path }) => path),
  };
}

/** "Discard mine": every conflicting change is dropped and theirs stays. */
export const discardMine = (conflicts: ReadonlyArray<PeerSettingsConflict>): Settle => ({
  force: [],
  drop: conflicts.map(({ path }) => path),
});

/**
 * What was decided so far with what is decided now: a path decided again takes the newer decision,
 * so a second round of conflicts does not forget the first round's.
 */
export function mergeSettle(previous: Settle, next: Settle): Settle {
  const decided = new Set([...next.force, ...next.drop].map(conflictKey));
  const kept = (paths: ReadonlyArray<PeerSettingsPath>) =>
    paths.filter((path) => !decided.has(conflictKey(path)));
  return {
    force: [...kept(previous.force), ...next.force],
    drop: [...kept(previous.drop), ...next.drop],
  };
}

/** Whether one path is the other or below it: a change there and a change at the other conflict. */
export const related = (a: Path, b: Path): boolean =>
  (a.length <= b.length ? a : b).every((key, i) => a[i] === b[i]);

/** How many of my changes do not touch what anyone saved meanwhile. */
export function untouchedCount(
  lines: ReadonlyArray<PeerSettingsLine>,
  conflicts: ReadonlyArray<PeerSettingsConflict>,
): number {
  return lines.filter((line) => !conflicts.some((conflict) => related(conflict.path, line.path)))
    .length;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
/** A small count in words, as the design writes it ("Four of your changes"); larger ones in digits. */
export const countInWords = (count: number): string => WORDS[count] ?? String(count);

/** "Eva", "Eva and Bob", "Eva, Bob and Ana". */
export function joinNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Who saved what I conflict with, once each, in the order the conflicts name them. */
export function theirNames(
  conflicts: ReadonlyArray<PeerSettingsConflict>,
  nameOf: (person: { readonly email: string; readonly name: string }) => string,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const { theirsBy } of conflicts) {
    const key = theirsBy.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(nameOf(theirsBy));
  }
  return names;
}

/** The latest time anyone I conflict with saved. */
export const latestTheirs = (conflicts: ReadonlyArray<PeerSettingsConflict>): string | undefined =>
  conflicts
    .map(({ theirsAt }) => theirsAt)
    .filter((at) => !Number.isNaN(Date.parse(at)))
    .toSorted((a, b) => Date.parse(b) - Date.parse(a))[0];

/** "2 minutes ago", for a headline that a short "2m ago" would shrink. */
export function agoText(iso: string | undefined, now: number): string {
  const time = iso === undefined ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(time)) return "meanwhile";
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** "Eva saved Booking 2 minutes ago": the conflict view's title. */
export const conflictTitle = (names: ReadonlyArray<string>, scope: string, when: string) =>
  `${joinNames(names)} saved ${scope} ${when}`;

/**
 * The words of a review that depend on what is under review: a draft is "yours" and goes back to
 * editing, a proposal, a revert or imported files belong to someone or something else and are
 * cancelled or kept at theirs.
 */
export interface ReviewWords {
  /** The button that leaves the review without saving. */
  readonly back: string;
  /** What the changes under review are called beside "theirs" in the conflict view. */
  readonly mine: string;
  /** The conflict view's button that gives the changes up. */
  readonly discard: string;
  /** How the conflict view says where the changes started. */
  readonly started: string;
  /** Whose the changes are, in lower case: "your changes", "the proposal’s changes". */
  readonly owner: string;
  /** What to do about paths that are not the person's to change. */
  readonly forbidden: string;
}

export function reviewWords(kind: ReviewOperation["kind"]): ReviewWords {
  switch (kind) {
    case "save":
      return {
        back: "Back to editing",
        mine: "Yours",
        discard: "Discard mine",
        started: "You started from",
        owner: "your",
        forbidden: "Undo those changes to save the rest, or ask the people named to make them.",
      };
    case "import":
      return {
        back: "Cancel",
        mine: "Imported",
        discard: "Keep theirs",
        started: "The files started from",
        owner: "the import’s",
        forbidden:
          "Take those changes out of the files to import the rest, or ask the people named to make them.",
      };
    case "proposal":
      return {
        back: "Cancel",
        mine: "Proposed",
        discard: "Keep theirs",
        started: "The proposal started from",
        owner: "the proposal’s",
        forbidden: "Ask the people named to apply it.",
      };
    case "revert":
      return {
        back: "Cancel",
        mine: "Revert",
        discard: "Keep theirs",
        started: "The revert started from",
        owner: "the revert’s",
        forbidden: "Ask the people named to revert them.",
      };
  }
}

/**
 * The conflict view's opening: where the changes started, where the head is, and how many of them
 * touch what others saved ("Four of your changes don’t touch Eva’s. One does:").
 */
export function conflictIntro(input: {
  readonly kind: ReviewOperation["kind"];
  readonly base: number;
  readonly head: number;
  readonly scope: string;
  readonly names: ReadonlyArray<string>;
  readonly untouched: number;
  readonly conflicts: number;
}): string {
  const { untouched, conflicts, names } = input;
  const words = reviewWords(input.kind);
  const where = `${words.started} revision ${input.base}, ${input.scope} is now at ${input.head}.`;
  const theirs = names.length === 1 ? `${names[0]}’s` : "theirs";
  if (untouched === 0) {
    const owner = capital(words.owner);
    return conflicts === 1
      ? `${where} ${owner} change touches the same setting ${joinNames(names)} changed:`
      : `${where} ${owner} ${conflicts} changes touch the same settings ${joinNames(names)} changed:`;
  }
  const rest = conflicts === 1 ? "One does:" : `${capital(countInWords(conflicts))} do:`;
  const some = `${capital(countInWords(untouched))} of ${words.owner} changes ${untouched === 1 ? "doesn’t" : "don’t"} touch ${theirs}.`;
  return `${where} ${some} ${rest}`;
}

/** What a review that comes to nothing says: the settings already read so, or theirs were kept. */
export function noopText(kept: ReadonlyArray<string>): string {
  return kept.length === 0
    ? "Nothing would change: the settings already read this way."
    : `Nothing left to save: the settings keep what ${joinNames(kept)} saved.`;
}

/** What else the conflicting revisions changed, which stays: their lines that touch none of my conflicts. */
export function theirOtherLines(
  revisions: ReadonlyArray<{ readonly lines: ReadonlyArray<PeerSettingsLine> }>,
  conflicts: ReadonlyArray<PeerSettingsConflict>,
): ReadonlyArray<PeerSettingsLine> {
  return revisions
    .flatMap((revision) => revision.lines)
    .filter((line) => !conflicts.some((conflict) => related(conflict.path, line.path)));
}

/** "Eva’s other change stays: Path rule · docs/**: notify → none." */
export function otherChangeText(
  names: ReadonlyArray<string>,
  lines: ReadonlyArray<PeerSettingsLine>,
) {
  if (lines.length === 0) return null;
  const who = names.length === 1 ? `${names[0]}’s` : "Their";
  return `${who} other ${lines.length === 1 ? "change stays" : "changes stay"}: ${lines
    .map((line) => `${line.label}: ${line.from} → ${line.to}`)
    .join("; ")}.`;
}

// ---- saved ---------------------------------------------------------------------------------------

export const savedTitle = (saved: PeerSettingsSaved): string =>
  saved.revision === undefined ? "Saved" : `Saved · revision ${saved.revision.seq}`;

/** How the gateway took a save: nothing to say, it did, or why it did not. */
export type GatewayNote =
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly error: string };

export function gatewayNote(outcome: PeerSettingsGatewayOutcome | undefined): GatewayNote | null {
  if (outcome === undefined) return null;
  if ("error" in outcome) return { kind: "failed", error: outcome.error };
  return outcome.ok
    ? { kind: "ok" }
    : { kind: "failed", error: "the gateway did not take the changes" };
}

/** Who may change what a refused path is, as a sentence for the forbidden view. */
export const refusalText = (refusal: PeerSettingsRefusal): string =>
  `Only ${refusal.owners} can change ${refusal.label}.`;

/** Where an invalid diagnostic is, as the check names it (`projects.booking.leads`), or nothing. */
export const diagnosticAt = (diagnostic: PeerSettingsDiagnostic): string | null =>
  diagnostic.at.trim() === "" ? null : diagnostic.at;
