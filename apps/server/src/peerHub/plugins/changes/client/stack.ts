/**
 * What jj says of a session's workspace, as the report needs it: which changes of the stack between
 * trunk and `@` are the session's own, how each differs from the version reported before, and which
 * of someone else's a change sits on. Facts only: paths, ids, counts.
 *
 * @module peerHub/plugins/changes/client/stack
 */
import {
  PEER_CHANGES_LIMITS,
  type ChangeRow,
  type PeerChangeVersionKind,
  type ReportedChange,
} from "@t3tools/contracts";

import { plain } from "../../../peerText.ts";
import * as Jj from "./jj.ts";

/** A change as an earlier report of the session described it. */
export interface Known {
  readonly commit: string;
  readonly parents: ReadonlyArray<string>;
  readonly parentCommits: ReadonlyArray<string>;
  readonly subject: string;
  readonly paths: ReadonlyArray<string>;
  readonly kind: PeerChangeVersionKind;
}

const isOwn = (entry: Jj.StackEntry, me: string | undefined) =>
  !entry.immutable && entry.author === me && (!entry.empty || entry.described);

/**
 * The stack from `@` to trunk, and the session's own changes in it: mutable ones its author wrote,
 * the working-copy change among them once it has a description or edits. A teammate's change below
 * the session's own, tracked or not, is not the session's.
 */
export async function readOwn(cwd: string) {
  const stack = await Jj.readStack(cwd);
  const me = stack.find((entry) => entry.working)?.author;
  return { stack, own: stack.filter((entry) => isOwn(entry, me)) };
}

/**
 * How a change differs from the version the session reported before: its own diff (`edit`), only
 * the subject (`description`), only the parents (`rebase`). A first sight is an edit. The parents
 * are compared by commit too: a move onto a newer version of the same parent change (what a
 * teammate's amend or a follow fetch does) is a rebase, not an edit.
 */
async function kindOf(
  cwd: string,
  entry: Jj.StackEntry,
  before: Known | undefined,
  paths: ReadonlyArray<string>,
): Promise<PeerChangeVersionKind> {
  if (before === undefined) return "edit";
  if (before.commit === entry.commitId) return before.kind;
  const moved = await Jj.interdiffPaths(cwd, before.commit, entry.commitId).catch(() => null);
  const edited = moved === null ? paths.join("\n") !== before.paths.join("\n") : moved.length > 0;
  if (edited) return "edit";
  if (before.subject !== entry.subject) return "description";
  const rebased =
    before.parents.join() !== entry.parents.join() ||
    before.parentCommits.join() !== entry.parentCommits.join();
  return rebased ? "rebase" : "edit";
}

const lines = new Map<string, { readonly added: number; readonly removed: number }>();
/** The lines a commit adds and removes, as far as they were read. */
export const linesOf = (commit: string) => lines.get(commit);

/**
 * The reported form of the session's own changes, newest first, within the Hub's limits. `known`
 * is what the session reported before and becomes what it reports now.
 */
export async function reportedChanges(
  cwd: string,
  own: ReadonlyArray<Jj.StackEntry>,
  known: Map<string, Known>,
): Promise<ReadonlyArray<ReportedChange>> {
  const changes: ReportedChange[] = [];
  for (const entry of own) {
    // A divergent change shows twice in a stack; the Hub keeps one row per change id.
    if (changes.length >= PEER_CHANGES_LIMITS.changes) break;
    if (changes.some((change) => change.changeId === entry.changeId)) continue;
    const paths = entry.paths.slice(0, PEER_CHANGES_LIMITS.paths);
    const kind = await kindOf(cwd, entry, known.get(entry.changeId), paths);
    known.set(entry.changeId, {
      commit: entry.commitId,
      parents: entry.parents,
      parentCommits: entry.parentCommits,
      subject: entry.subject,
      paths,
      kind,
    });
    if (!lines.has(entry.commitId)) {
      const stat = await Jj.lineStat(cwd, entry.commitId).catch(() => undefined);
      if (stat !== undefined) lines.set(entry.commitId, stat);
    }
    changes.push({
      changeId: entry.changeId,
      commitId: entry.commitId,
      parents: entry.parents.slice(0, 20),
      parentCommits: entry.parentCommits.slice(0, 20),
      subject: plain(entry.subject, PEER_CHANGES_LIMITS.subject),
      paths,
      bookmarks: entry.bookmarks.slice(0, PEER_CHANGES_LIMITS.bookmarks),
      conflict: entry.conflict,
      empty: entry.empty,
      divergent: entry.divergent,
      working: entry.working,
      kind,
    });
  }
  if (lines.size > 1_000) lines.clear();
  return changes;
}

/** The first row that is not the session's own, found below a change of the stack. */
export function foreignBelow(
  stack: ReadonlyArray<Jj.StackEntry>,
  from: string,
  own: ReadonlySet<string>,
  rows: ReadonlyArray<ChangeRow>,
): ChangeRow | undefined {
  const byId = new Map(stack.map((entry) => [entry.changeId, entry]));
  const queue = [...(byId.get(from)?.parents ?? [])];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (!own.has(id)) {
      const row = rows.find((candidate) => candidate.changeId === id);
      if (row !== undefined) return row;
    }
    queue.push(...(byId.get(id)?.parents ?? []));
  }
  return undefined;
}

/** For each of the session's own changes (and its working copy), the row of someone else's it sits on. */
export function buildsOn(
  stack: ReadonlyArray<Jj.StackEntry>,
  own: ReadonlySet<string>,
  rows: ReadonlyArray<ChangeRow>,
): Map<string, ChangeRow> {
  const found = new Map<string, ChangeRow>();
  const working = stack.find((entry) => entry.working)?.changeId;
  for (const id of new Set([...own, ...(working === undefined ? [] : [working])])) {
    const below = foreignBelow(stack, id, own, rows);
    if (below !== undefined) found.set(id, below);
  }
  return found;
}
