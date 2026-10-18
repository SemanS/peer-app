/**
 * The changes plugin's client logic, for web and the phone alike: everyone's Jujutsu changes in
 * flight laid out as `jj log` draws them, the rows and the inspector in words, the Mine filter, a
 * task's stack, review versions, and the honest states of the page. The Hub and the environment
 * hand over facts (ids, parents, files, state); none of this runs jj.
 *
 * @module peer/changes
 */
import {
  WS_METHODS,
  type ChangeRow,
  type ChangeVersion,
  type EnvironmentId,
  type JujutsuState,
  type LandedChange,
  type PeerChangesStatus,
  type ProjectChanges,
  type ReviewDiffInput,
  type ReviewMark,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";
import { agentName, jujutsuProblem, personName, type JujutsuProblemNote } from "./jujutsu.ts";
import { agoInWords } from "./work.ts";

/**
 * The plugin's atoms, spread into the server atoms: a project's changes as the environment keeps
 * them (a view on subscribe, then each time the Hub or this computer moves them), the diff of a
 * review, and the mark. A diff is read whenever it is opened: it depends on this computer's commits.
 */
export function createPeerChangesAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  const reviewDiff = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:changes:review-diff",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: (input: ReviewDiffInput) => request(WS_METHODS.peerChangesReviewDiff, input),
  });
  return {
    peerChangesLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "peer:changes:live",
      tag: WS_METHODS.peerChangesSubscribe,
    }),
    peerChangesReviewDiff: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: ReviewDiffInput;
    }) => reviewDiff({ environmentId: target.environmentId, input: target.input }),
    peerChangesMarkReviewed: createEnvironmentRpcCommand(runtime, {
      label: "peer:changes:mark-reviewed",
      tag: WS_METHODS.peerChangesMarkReviewed,
    }),
  };
}

/** jj shows 8 letters of a change id. */
export const SHORT_CHANGE_ID = 8;

/**
 * A change id split for display: `pre` is its shortest prefix that no other change in the view
 * shares, emphasized; `rest` is the remainder of the 8 letters jj shows. The prefix is at least two
 * letters, as the canvas shows ("ms" + "pqrmyv"), however short jj itself could go.
 */
export interface ChangeIdParts {
  readonly pre: string;
  readonly rest: string;
}

export function changeIdParts(id: string, all: ReadonlyArray<string>): ChangeIdParts {
  const short = id.slice(0, SHORT_CHANGE_ID);
  let length = Math.min(2, short.length);
  while (
    length < short.length &&
    all.some((other) => other !== id && other.startsWith(id.slice(0, length)))
  ) {
    length += 1;
  }
  return { pre: short.slice(0, length), rest: short.slice(length) };
}

/** `ORD-12: loyalty points` is task `ORD-12` and title `loyalty points`. */
const KEYED_SUBJECT = /^([A-Za-z][A-Za-z0-9]*-\d+)[:\s]\s*(.*)$/;

/** The task key and title of a change: its session's task when one reported it, else the subject's. */
export function changeKeyAndTitle(row: ChangeRow): { key: string | undefined; title: string } {
  const task = row.task ?? row.sessions.find((s) => s.working && s.task)?.task ?? undefined;
  const match = KEYED_SUBJECT.exec(row.subject);
  const title = match?.[2] !== undefined && match[2].length > 0 ? match[2] : row.subject;
  const key = task ?? match?.[1];
  const cleaned = title.charAt(0).toUpperCase() + title.slice(1);
  return { key: key ?? undefined, title: match === null ? row.subject : cleaned };
}

const sameEmail = (a: string, b: string | null | undefined) =>
  b != null && a.toLowerCase() === b.toLowerCase();

/** "Bob · Codex"; "Slavo (you) · Claude Code" for the person looking. */
export function personAgentLine(
  person: { readonly email: string; readonly agent: string },
  me?: string | null,
  names?: Readonly<Record<string, string>>,
): string {
  const name = names?.[person.email] ?? personName(person.email);
  return `${name}${sameEmail(person.email, me) ? " (you)" : ""} · ${agentName(person.agent)}`;
}

/** Where a row's data comes from, in the legend's words. */
export function changeSourceLine(row: ChangeRow, now: number): string {
  const ago = (at: string | undefined) => {
    const time = at === undefined ? Number.NaN : Date.parse(at);
    return Number.isFinite(time) ? ` ${agoInWords(time, now)}` : "";
  };
  switch (row.source) {
    case "live":
      return "live on this computer";
    case "shared":
      return `shared${ago(row.sourceAt)}`;
    case "pushed":
      return row.bookmarks[0] === undefined
        ? `pushed${ago(row.sourceAt)}`
        : `pushed as ${row.bookmarks[0]}`;
    default:
      return `reported${ago(row.sourceAt ?? row.lastReportAt)}`;
  }
}

/** "1 file +3", "3 files +41 −2"; a report holds at most 50 paths, so 50 reads as "50+". */
export function changeStat(row: ChangeRow): string {
  const files = row.paths.length;
  if (files === 0) return "";
  const count = files >= 50 ? "50+ files" : `${files} ${files === 1 ? "file" : "files"}`;
  const lines = row.lines;
  const parts = [count];
  if (lines !== undefined && lines.added > 0) parts.push(`+${lines.added}`);
  if (lines !== undefined && lines.removed > 0) parts.push(`−${lines.removed}`);
  return parts.join(" ");
}

/** The change's version times, oldest first; the Hub sends them in the order it received them. */
const startedAt = (row: ChangeRow): number => {
  const first = row.versions.map((v) => Date.parse(v.at)).filter(Number.isFinite);
  const times = first.length > 0 ? first : [Date.parse(row.lastReportAt)];
  const min = Math.min(...times);
  return Number.isFinite(min) ? min : 0;
};

const lastMovedAt = (row: ChangeRow): number => {
  const times = [...row.versions.map((v) => v.at), row.lastReportAt]
    .map((at) => Date.parse(at))
    .filter(Number.isFinite);
  return times.length === 0 ? 0 : Math.max(...times);
};

/**
 * An agent works in the change now. `sessions` also lists the sessions whose work builds on it, so
 * only the row's own `working` says this.
 */
export const changeWorking = (row: ChangeRow): boolean => row.working;

/** jj's shapes: a filled dot (an agent works in it), a ring (nobody), a diamond (landed), a cross (a stored conflict). */
export type ChangeShape = "dot" | "ring" | "diamond" | "cross";

export function changeShape(row: ChangeRow): ChangeShape {
  if (row.conflict) return "cross";
  return changeWorking(row) ? "dot" : "ring";
}

/** A line from this row's node to a lane it merges into (drawn in the gap below the node). */
export interface GraphJoin {
  readonly from: number;
  readonly to: number;
}

/**
 * One row of the graph, newest first. Lanes are columns counted from 0. `through` are the other
 * lanes whose line passes this row; `closing` are lanes whose line ends at this node from above
 * (two changes built on it); `continues` says this node's own line goes on to its parent, and
 * `joins` where the lines of a node that sits beside an already open lane end.
 */
export interface GraphRow {
  readonly id: string;
  readonly kind: "change" | "landed";
  readonly shape: ChangeShape;
  readonly lane: number;
  /** The lane has a line coming in from above: some change builds on this one. */
  readonly fromAbove: boolean;
  readonly through: ReadonlyArray<number>;
  readonly closing: ReadonlyArray<number>;
  readonly continues: boolean;
  readonly joins: ReadonlyArray<GraphJoin>;
  /** The row's change; absent on the landed row. */
  readonly change?: ChangeRow;
  readonly landed?: LandedChange;
}

export interface ChangeGraph {
  readonly rows: ReadonlyArray<GraphRow>;
  /** How many lanes the widest row needs. */
  readonly lanes: number;
}

const TRUNK = "\u0000trunk";

/**
 * Lays the changes out as `jj log` draws them. Order is topo-grouped, newest first: the newest
 * started head goes first and its stack follows it down before the next head, as jj groups a
 * branch. A head takes the lowest free lane; a node continues in the lane of the child that
 * reached it first, and a head or merge whose parent another lane already waits for joins that lane
 * at once instead of holding its own. Parents that are not changes in flight are trunk, which the
 * landed row ends the graph on (omitted when the environment sent none).
 */
export function changeGraph(input: {
  readonly changes: ReadonlyArray<ChangeRow>;
  readonly landed?: LandedChange | undefined;
}): ChangeGraph {
  const byId = new Map(input.changes.map((row) => [row.changeId, row]));
  const parentsOf = (row: ChangeRow): string[] => {
    const parents = row.parents.map((parent) => (byId.has(parent) ? parent : TRUNK));
    return parents.length === 0 ? [TRUNK] : [...new Set(parents)];
  };
  const children = new Map<string, string[]>();
  for (const row of input.changes) {
    for (const parent of parentsOf(row)) {
      children.set(parent, [...(children.get(parent) ?? []), row.changeId]);
    }
  }

  // Topo-grouped order.
  const order: ChangeRow[] = [];
  const done = new Set<string>();
  const waiting = new Set(input.changes.map((row) => row.changeId));
  const ready = (row: ChangeRow) =>
    (children.get(row.changeId) ?? []).every((child) => done.has(child));
  const newest = (a: ChangeRow, b: ChangeRow) =>
    startedAt(b) - startedAt(a) || a.changeId.localeCompare(b.changeId);
  let next: ChangeRow | undefined;
  while (waiting.size > 0) {
    const candidates = [...waiting].map((id) => byId.get(id) as ChangeRow);
    next ??= candidates.filter(ready).sort(newest)[0] ?? candidates.sort(newest)[0];
    if (next === undefined) break;
    order.push(next);
    done.add(next.changeId);
    waiting.delete(next.changeId);
    const emitted: ChangeRow = next;
    next = parentsOf(emitted)
      .map((parent) => byId.get(parent))
      .find(
        (parent): parent is ChangeRow =>
          parent !== undefined && waiting.has(parent.changeId) && ready(parent),
      );
  }

  // Lanes: each open lane waits for the id of the node that will sit in it next.
  const lanes: Array<string | undefined> = [];
  const rows: GraphRow[] = [];
  let widest = 0;
  const free = () => {
    const index = lanes.findIndex((waitingFor) => waitingFor === undefined);
    return index === -1 ? lanes.length : index;
  };
  const place = (
    id: string,
    parents: ReadonlyArray<string>,
  ): Pick<GraphRow, "lane" | "fromAbove" | "through" | "closing" | "continues" | "joins"> => {
    const waitingLanes = lanes.flatMap((waitingFor, index) => (waitingFor === id ? [index] : []));
    const lane = waitingLanes[0] ?? free();
    const closing = waitingLanes.slice(1);
    for (const index of waitingLanes) lanes[index] = undefined;
    const through = lanes.flatMap((waitingFor, index) => (waitingFor === undefined ? [] : [index]));
    const joins: GraphJoin[] = [];
    let continues = false;
    for (const [position, parent] of parents.entries()) {
      const open = lanes.indexOf(parent);
      if (open !== -1) {
        joins.push({ from: lane, to: open });
      } else if (position === 0) {
        lanes[lane] = parent;
        continues = true;
      } else {
        const extra = free();
        lanes[extra] = parent;
        joins.push({ from: lane, to: extra });
      }
    }
    widest = Math.max(widest, lane + 1, lanes.length);
    return { lane, fromAbove: waitingLanes.length > 0, through, closing, continues, joins };
  };

  for (const row of order) {
    rows.push({
      id: row.changeId,
      kind: "change",
      shape: changeShape(row),
      change: row,
      ...place(row.changeId, parentsOf(row)),
    });
  }
  if (input.landed !== undefined) {
    rows.push({
      id: input.landed.changeId,
      kind: "landed",
      shape: "diamond",
      landed: input.landed,
      ...place(TRUNK, []),
    });
  }
  return { rows, lanes: Math.max(widest, rows.length === 0 ? 0 : 1) };
}

/** The version number of a commit among a change's versions (1-based), or null when it was dropped. */
const versionOfCommit = (versions: ReadonlyArray<ChangeVersion>, commit: string): number | null => {
  const index = versions.findIndex((version) => version.commit === commit);
  return index === -1 ? null : index + 1;
};

/** What the person's mark says about the change now. */
export interface ReviewState {
  readonly mark: ReviewMark;
  /** The number of versions the change has. */
  readonly versions: number;
  /** Versions newer than the marked one. */
  readonly since: number;
}

/** The mark counts from its commit when the Hub still lists it, else from the version it was given. */
export function reviewState(
  row: ChangeRow,
  marks: ReadonlyArray<ReviewMark>,
): ReviewState | undefined {
  const mark = marks.find((candidate) => candidate.changeId === row.changeId);
  if (mark === undefined) return undefined;
  const marked = versionOfCommit(row.versions, mark.commit) ?? mark.version;
  return {
    mark,
    versions: row.versions.length,
    since: Math.max(0, row.versions.length - marked),
  };
}

export interface MineInput {
  /** The signed-in person's email. */
  readonly me: string | null | undefined;
  readonly marks?: ReadonlyArray<ReviewMark> | undefined;
  /** Change ids that wait for this person's first review, which the work tree knows (its reviewer). */
  readonly awaitingReview?: ReadonlySet<string> | undefined;
}

/** A change waits for the person's review: a first review the tasks name, or a newer version than the marked one. */
export function awaitsReview(row: ChangeRow, input: MineInput): boolean {
  if (input.awaitingReview?.has(row.changeId) === true) return true;
  return (reviewState(row, input.marks ?? [])?.since ?? 0) > 0;
}

/**
 * Whether the Mine filter keeps a change bright: the person runs it (a session of theirs works in
 * or on it), owns it (its author) or reviews it. Everything else is dimmed and still listed.
 */
export function isMine(row: ChangeRow, input: MineInput): boolean {
  return (
    sameEmail(row.author.email, input.me) ||
    row.sessions.some((session) => sameEmail(session.email, input.me)) ||
    awaitsReview(row, input)
  );
}

/** A row as the graph shows it under a filter. */
export type ChangesScope = "everyone" | "mine";

export interface ScopedRow {
  readonly row: GraphRow;
  /** Mine dims what the person does not run, own or review; trunk is never dimmed. */
  readonly dimmed: boolean;
}

export function scopeRows(
  graph: ChangeGraph,
  scope: ChangesScope,
  input: MineInput,
): ReadonlyArray<ScopedRow> {
  return graph.rows.map((row) => ({
    row,
    dimmed: scope === "mine" && row.change !== undefined && !isMine(row.change, input),
  }));
}

/** Changes that hold a conflict or two versions: the project navigation row's count. */
export const needAttentionCount = (changes: ReadonlyArray<ChangeRow>): number =>
  changes.filter((row) => row.conflict || row.divergent).length;

/** One thing that waits for the person, as the phone lists it. */
export interface WaitsForYou {
  readonly kind: "review" | "conflict" | "twoVersions";
  readonly changeId: string;
  readonly key: string | undefined;
  readonly text: string;
  /** For a review: the versions and files that moved since the mark. */
  readonly moved?: { readonly versions: number; readonly paths: ReadonlyArray<string> };
}

/**
 * What waits for the person: a change they own with a conflict or two versions, and a change to
 * review again (or for the first time). Nothing else is listed, so the list stays short.
 */
export function waitsForYou(changes: ReadonlyArray<ChangeRow>, input: MineInput): WaitsForYou[] {
  const result: WaitsForYou[] = [];
  for (const row of changes) {
    const { key } = changeKeyAndTitle(row);
    const name = key ?? row.changeId.slice(0, SHORT_CHANGE_ID);
    if (sameEmail(row.author.email, input.me)) {
      if (row.conflict) {
        result.push({
          kind: "conflict",
          changeId: row.changeId,
          key,
          text: `Resolve ${name}'s conflict`,
        });
      }
      if (row.divergent) {
        result.push({
          kind: "twoVersions",
          changeId: row.changeId,
          key,
          text: `Converge ${name}'s two versions`,
        });
      }
    }
    const state = reviewState(row, input.marks ?? []);
    if (state !== undefined && state.since > 0) {
      result.push({
        kind: "review",
        changeId: row.changeId,
        key,
        text: `Review ${name} again`,
        moved: { versions: state.since, paths: row.paths },
      });
    } else if (state === undefined && input.awaitingReview?.has(row.changeId) === true) {
      result.push({ kind: "review", changeId: row.changeId, key, text: `Review ${name}` });
    }
  }
  return result;
}

/** "2 versions since you marked v5 reviewed · order.js" for the phone's reminder. */
export function reviewAgainLine(row: ChangeRow, marks: ReadonlyArray<ReviewMark>): string | null {
  const state = reviewState(row, marks);
  if (state === undefined || state.since === 0) return null;
  const files = row.paths.length === 0 ? "" : ` · ${row.paths.slice(0, 3).join(", ")}`;
  return `${state.since} ${state.since === 1 ? "version" : "versions"} since you marked v${state.mark.version} reviewed${files}`;
}

export type BadgeTone = "info" | "warn" | "plain";

export interface ChangeBadge {
  readonly id: "working" | "conflict" | "twoVersions" | "review" | "buildsOn" | "empty";
  readonly label: string;
  readonly tone: BadgeTone;
  /** For "Builds on": the change it links to. */
  readonly link?: string;
}

export interface ChangeRowModel {
  readonly changeId: string;
  readonly id: ChangeIdParts;
  readonly key: string | undefined;
  readonly title: string;
  readonly who: string;
  readonly source: string;
  readonly stat: string;
  readonly badges: ReadonlyArray<ChangeBadge>;
}

/** The first parent of a change that is another change in flight: what the row says it builds on. */
const buildsOnRows = (row: ChangeRow, all: ReadonlyArray<ChangeRow>): ChangeRow[] =>
  row.parents.flatMap((parent) => all.find((other) => other.changeId === parent) ?? []);

export function changeRowModel(
  row: ChangeRow,
  all: ReadonlyArray<ChangeRow>,
  context: MineInput & { readonly now: number; readonly names?: Readonly<Record<string, string>> },
): ChangeRowModel {
  const { key, title } = changeKeyAndTitle(row);
  const badges: ChangeBadge[] = [];
  if (changeWorking(row)) badges.push({ id: "working", label: "Working", tone: "info" });
  if (awaitsReview(row, context)) {
    badges.push({ id: "review", label: "Waiting for your review", tone: "warn" });
  }
  if (row.conflict) badges.push({ id: "conflict", label: "Conflict", tone: "warn" });
  if (row.divergent) badges.push({ id: "twoVersions", label: "Two versions", tone: "warn" });
  for (const parent of buildsOnRows(row, all)) {
    const parentKey = changeKeyAndTitle(parent).key ?? parent.changeId.slice(0, SHORT_CHANGE_ID);
    badges.push({
      id: "buildsOn",
      label: `Builds on ${parentKey}`,
      tone: "plain",
      link: parent.changeId,
    });
  }
  return {
    changeId: row.changeId,
    id: changeIdParts(
      row.changeId,
      all.map((other) => other.changeId),
    ),
    key,
    title,
    who: personAgentLine(row.author, context.me, context.names),
    source: changeSourceLine(row, context.now),
    stat: changeStat(row),
    badges,
  };
}

export interface ChangeInspectorModel {
  readonly changeId: string;
  readonly state: { readonly label: string; readonly tone: BadgeTone };
  readonly key: string | undefined;
  readonly title: string;
  readonly who: string;
  /** The computers whose sessions work in it, as the Hub names their environments. */
  readonly environments: ReadonlyArray<string>;
  readonly bookmark: string | undefined;
  /** "6 versions since 14:40": count and the first and newest times, for the page to format. */
  readonly versions: {
    readonly count: number;
    readonly since: string | undefined;
    readonly lastAgo: string | undefined;
    readonly marked: number | undefined;
    readonly sinceMark: number;
  };
  /** Who can rewrite it: the author and agent, and the person in a terminal. */
  readonly rewriters: { readonly person: string; readonly agent: string; readonly mine: boolean };
  readonly files: ReadonlyArray<string>;
  /** Changes that build on this one. */
  readonly buildsOnIt: ReadonlyArray<string>;
  /** The changes this one builds on, in flight. */
  readonly buildsOn: ReadonlyArray<string>;
  readonly conflict: boolean;
  readonly twoVersions: boolean;
  /** For two versions: `mspqrmyv/0` and `mspqrmyv/1`. */
  readonly versionIds: ReadonlyArray<string>;
}

export function changeInspector(
  row: ChangeRow,
  all: ReadonlyArray<ChangeRow>,
  context: MineInput & { readonly now: number; readonly names?: Readonly<Record<string, string>> },
): ChangeInspectorModel {
  const { key, title } = changeKeyAndTitle(row);
  const review = reviewState(row, context.marks ?? []);
  const waiting = awaitsReview(row, context);
  const state = row.conflict
    ? { label: "Conflict", tone: "warn" as const }
    : row.divergent
      ? { label: "Two versions", tone: "warn" as const }
      : waiting
        ? { label: "Waiting for your review", tone: "warn" as const }
        : changeWorking(row)
          ? { label: "Working", tone: "info" as const }
          : { label: "Idle", tone: "plain" as const };
  const short = row.changeId.slice(0, SHORT_CHANGE_ID);
  const first = row.versions.at(0);
  const last = lastMovedAt(row);
  const keyOf = (other: ChangeRow) =>
    changeKeyAndTitle(other).key ?? other.changeId.slice(0, SHORT_CHANGE_ID);
  return {
    changeId: row.changeId,
    state,
    key,
    title,
    who: personAgentLine(row.author, context.me, context.names),
    environments: [
      ...new Set(
        row.sessions
          .filter((s) => s.working && sameEmail(s.email, row.author.email))
          .map((s) => s.environment),
      ),
    ],
    bookmark: row.bookmarks[0],
    versions: {
      count: row.versions.length,
      since: first?.at,
      lastAgo: last > 0 ? agoInWords(last, context.now) : undefined,
      marked: review?.mark.version,
      sinceMark: review?.since ?? 0,
    },
    rewriters: {
      person: personName(row.author.email),
      agent: agentName(row.author.agent),
      mine: sameEmail(row.author.email, context.me),
    },
    files: row.paths,
    buildsOnIt: all.filter((other) => other.parents.includes(row.changeId)).map(keyOf),
    buildsOn: buildsOnRows(row, all).map(keyOf),
    conflict: row.conflict,
    twoVersions: row.divergent,
    versionIds: row.divergent ? [`${short}/0`, `${short}/1`] : [],
  };
}

export interface TaskStackEntry {
  readonly change: ChangeRow;
  readonly shape: ChangeShape;
  /** The task's own person owns it; a teammate's change is read-only to the task's agent. */
  readonly yours: boolean;
  readonly readOnly: boolean;
  readonly versions: number;
  /** When it last moved, in words. */
  readonly movedAgo: string | undefined;
}

export interface TaskStack {
  /** From the task's own change down to the last change in flight below it. */
  readonly entries: ReadonlyArray<TaskStackEntry>;
  readonly landed: LandedChange | undefined;
}

/**
 * The stack of a task, in jj's shapes down to trunk: its newest working change and the changes in
 * flight it builds on, following the first parents. Empty when no change reports the task.
 */
export function taskStack(
  view: Pick<ProjectChanges, "changes" | "landed">,
  task: string,
  context: { readonly me: string | null | undefined; readonly now: number },
): TaskStack {
  const own = view.changes
    .filter((row) => changeKeyAndTitle(row).key === task)
    .sort(
      (a, b) =>
        Number(changeWorking(b)) - Number(changeWorking(a)) || lastMovedAt(b) - lastMovedAt(a),
    )[0];
  const entries: TaskStackEntry[] = [];
  const seen = new Set<string>();
  for (let row = own; row !== undefined && !seen.has(row.changeId);) {
    seen.add(row.changeId);
    const yours = sameEmail(row.author.email, context.me) || row === own;
    const moved = lastMovedAt(row);
    entries.push({
      change: row,
      shape: changeShape(row),
      yours,
      readOnly: row !== own && !sameEmail(row.author.email, context.me),
      versions: row.versions.length,
      movedAgo: moved > 0 ? agoInWords(moved, context.now) : undefined,
    });
    const parent = row.parents[0];
    row = view.changes.find((other) => other.changeId === parent);
  }
  return { entries, landed: entries.length > 0 ? view.landed : undefined };
}

export interface ReviewVersionRow {
  readonly n: number;
  readonly at: string;
  readonly kind: string;
  /** "first edit", "edit", "description", "rebased onto main"; "edit · now" for the newest. */
  readonly label: string;
  readonly marked: boolean;
  readonly now: boolean;
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  edit: "edit",
  description: "description",
  rebase: "rebased onto main",
};

/** The versions as Ana's computer reported them, oldest first, with the person's mark and the newest marked. */
export function reviewVersions(
  row: ChangeRow,
  mark: ReviewMark | undefined,
): ReadonlyArray<ReviewVersionRow> {
  const markedAt =
    mark === undefined ? null : (versionOfCommit(row.versions, mark.commit) ?? mark.version);
  return row.versions.map((version, index) => {
    const n = index + 1;
    const newest = n === row.versions.length;
    const word =
      n === 1 && version.kind === "edit"
        ? "first edit"
        : (KIND_WORDS[version.kind] ?? version.kind);
    return {
      n,
      at: version.at,
      kind: version.kind,
      label: newest ? `${word} · now` : word,
      marked: markedAt === n,
      now: newest,
    };
  });
}

/** The button: "Mark v7 reviewed"; null when there is nothing newer than the mark to mark. */
export function markReviewedLabel(
  row: ChangeRow,
  mark: ReviewMark | undefined,
): { readonly label: string; readonly version: number; readonly commit: string } | null {
  const newest = row.versions.at(-1);
  if (newest === undefined) return null;
  const state = reviewState(row, mark === undefined ? [] : [mark]);
  if (state !== undefined && state.since === 0) return null;
  return {
    label: `Mark v${row.versions.length} reviewed`,
    version: row.versions.length,
    commit: newest.commit,
  };
}

/** A teammate on Git works by branch, without change ids: the work tree knows them. */
export interface GitTeammate {
  readonly email: string;
  readonly agent?: string | undefined;
  readonly task?: string | undefined;
  readonly branch: string;
}

export type ChangesPageModel =
  | { readonly kind: "jj"; readonly note: JujutsuProblemNote }
  | { readonly kind: "hubOlder"; readonly title: string; readonly body: string }
  | { readonly kind: "loading"; readonly title: string; readonly body: string }
  | {
      readonly kind: "failed";
      readonly title: string;
      readonly message: string;
      readonly footnote: string;
    }
  | {
      readonly kind: "empty";
      readonly title: string;
      readonly body: string;
      readonly action: string;
      readonly byBranch: ReadonlyArray<GitTeammateRow>;
    }
  | {
      readonly kind: "ready";
      readonly graph: ChangeGraph;
      readonly summary: string;
      readonly byBranch: ReadonlyArray<GitTeammateRow>;
      /** Changes that hold two versions, with the words the page says them in. */
      readonly twoVersions: ReadonlyArray<{
        readonly changeId: string;
        readonly title: string;
        readonly versionIds: ReadonlyArray<string>;
      }>;
      /** jj failed in some workspaces while the rest loaded. */
      readonly problems: ReadonlyArray<{ readonly workspace: string; readonly message: string }>;
    };

export interface GitTeammateRow {
  readonly email: string;
  readonly who: string;
  readonly key: string | undefined;
  readonly branch: string;
  readonly note: string;
}

const gitTeammateRow = (
  teammate: GitTeammate,
  context: {
    readonly me: string | null | undefined;
    readonly names?: Readonly<Record<string, string>> | undefined;
  },
): GitTeammateRow => ({
  email: teammate.email,
  who:
    teammate.agent === undefined
      ? `${context.names?.[teammate.email] ?? personName(teammate.email)}${sameEmail(teammate.email, context.me) ? " (you)" : ""}`
      : personAgentLine(
          { email: teammate.email, agent: teammate.agent },
          context.me,
          context.names,
        ),
  key: teammate.task,
  branch: teammate.branch,
  note: "Git: shown by branch, without change ids or versions",
});

export interface ChangesPageInput {
  readonly project: string;
  readonly now: number;
  readonly me: string | null | undefined;
  readonly names?: Readonly<Record<string, string>> | undefined;
  /** The status field `jujutsu`; undefined while the plugin is off or the status is not read yet. */
  readonly jujutsu?: JujutsuState | undefined;
  /** The status field `changes`: whether the signed-in Hub serves the feature. */
  readonly hubSupport?: PeerChangesStatus["hubSupport"] | undefined;
  /** The subscription's latest value; undefined until it arrives. */
  readonly view?: ProjectChanges | undefined;
  readonly gitTeammates?: ReadonlyArray<GitTeammate> | undefined;
}

/**
 * What the Changes page shows, honest about every state: jj missing, too old or not colocated (the
 * cause and the fix, and nothing written), an older Hub, loading (what is being read), a jj failure
 * with Peer retrying at the agent's next step, nothing in flight, and the graph, with teammates on
 * Git listed by branch and changes with two versions called out.
 */
export function changesPage(input: ChangesPageInput): ChangesPageModel {
  const note = jujutsuProblem(input.jujutsu, input.project);
  if (note !== null) return { kind: "jj", note };
  if (input.hubSupport === "unsupported") {
    return {
      kind: "hubOlder",
      title: "The Hub does not know changes yet",
      body: "Changes needs a newer Peer Hub. Snapshots, protection, following and undo keep working: they need no Hub feature.",
    };
  }
  const byBranch = (input.gitTeammates ?? []).map((teammate) => gitTeammateRow(teammate, input));
  const view = input.view;
  if (view === undefined) {
    const workspaces = input.jujutsu?.agentWorkspaces;
    return {
      kind: "loading",
      title: "Reading the repository",
      body:
        workspaces === undefined
          ? "Reading the operation log on this computer, then asking the Hub for teammates' changes."
          : `Reading the operation log and ${workspaces} ${workspaces === 1 ? "workspace" : "workspaces"} on this computer, then asking the Hub for teammates' changes.`,
    };
  }
  if (view.changes.length === 0) {
    const first = view.problems[0];
    if (first !== undefined) {
      return {
        kind: "failed",
        title: `jj failed in ${first.workspace}`,
        message: first.message,
        footnote: "Peer retries at the agent's next tool step.",
      };
    }
    return {
      kind: "empty",
      title: "No changes in flight",
      body: "Start an agent on a task and its change shows here as it works. Landed changes stay on main.",
      action: "Start an agent…",
      byBranch,
    };
  }
  const attention = needAttentionCount(view.changes);
  const people = new Set(view.changes.map((row) => row.author.email.toLowerCase())).size;
  const read = view.readAt === undefined ? Number.NaN : Date.parse(view.readAt);
  return {
    kind: "ready",
    graph: changeGraph({ changes: view.changes, landed: view.landed }),
    summary: [
      `${view.changes.length} ${view.changes.length === 1 ? "change" : "changes"} in flight`,
      `${people} ${people === 1 ? "person" : "people"}`,
      ...(attention > 0 ? [`${attention} need${attention === 1 ? "s" : ""} you`] : []),
      ...(Number.isFinite(read) ? [`checked ${agoInWords(read, input.now)}`] : []),
    ].join(" · "),
    byBranch,
    twoVersions: view.changes
      .filter((row) => row.divergent)
      .map((row) => ({
        changeId: row.changeId,
        title: `${changeKeyAndTitle(row).key ?? row.changeId.slice(0, SHORT_CHANGE_ID)} has two versions at once`,
        versionIds: [
          `${row.changeId.slice(0, SHORT_CHANGE_ID)}/0`,
          `${row.changeId.slice(0, SHORT_CHANGE_ID)}/1`,
        ],
      })),
    problems: view.problems,
  };
}
