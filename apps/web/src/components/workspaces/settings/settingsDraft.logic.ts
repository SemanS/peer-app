/**
 * A page's draft of the settings document: what it has changed so far, how many changes that is,
 * and the sets that save it. The draft starts from the document at one revision and keeps that base
 * until it is saved or discarded, so the Hub can merge it with what others saved meanwhile; a draft
 * with no change in it has no base and follows the view.
 */
import { getAt, jsonEqual, setAt, setsFor } from "@t3tools/client-runtime/peer-settings";
import type { PeerSettingsSet } from "@t3tools/contracts";

import type { SettingsDocument } from "./settingsView.logic";

type Path = ReadonlyArray<string>;

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const own = (mapping: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(mapping, key) ? mapping[key] : undefined;

// ---- what changed -----------------------------------------------------------------------------------

/** One change at the granularity the Hub merges at: the node, and how many leaves of it changed. */
export interface Change {
  readonly path: Path;
  readonly leaves: number;
}

type ListKind = "set" | "keyed";

/**
 * The lists the Hub merges element by element (design H1): sets of strings (members, leads, a
 * shared model list, a model's harnesses) and lists keyed by a field (repositories and models by
 * `id`, tools by tool id). Every other list is one value. `path` is the list's place in the
 * document, a keyed list's elements being addressed by their key.
 */
function listKindAt(path: Path): ListKind | undefined {
  const [section, , field, shared, last] = path;
  if (section === "projects") {
    if (path.length === 3) {
      if (field === "members" || field === "leads") return "set";
      if (field === "repositories" || field === "tools") return "keyed";
    }
    if (path.length === 5 && field === "capacity" && shared === "shared" && last === "models") {
      return "set";
    }
  }
  if (section === "capacity") {
    if (path.length === 3 && field === "models") return "keyed";
    if (path.length === 5 && field === "models" && last === "harness") return "set";
  }
  return undefined;
}

/** How a keyed list names its elements: a tool by its id (a bare string is its own), the rest by `id`. */
function keyOf(path: Path, element: unknown): string | undefined {
  if (path[0] === "projects" && path[2] === "tools") {
    if (typeof element === "string") return element;
    return isMapping(element) && typeof element.tool === "string" ? element.tool : undefined;
  }
  return isMapping(element) && typeof element.id === "string" ? element.id : undefined;
}

/** A keyed list as a mapping, or undefined where an element has no key or two share one. */
function indexed(path: Path, list: ReadonlyArray<unknown>) {
  const entries = new Map<string, unknown>();
  for (const element of list) {
    const key = keyOf(path, element);
    if (key === undefined || entries.has(key)) return undefined;
    entries.set(key, element);
  }
  return entries;
}

const strings = (list: ReadonlyArray<unknown>): ReadonlyArray<string> | undefined =>
  list.every((item): item is string => typeof item === "string") ? list : undefined;

/**
 * How many people the draft adds to or takes from a set: each is one change. Switching between the
 * whole workspace (`*`) and named people is one change, not a set of them.
 */
function setLeaves(base: ReadonlyArray<string>, draft: ReadonlyArray<string>): number {
  if (base.includes("*") !== draft.includes("*")) return 1;
  if (base.includes("*")) return 0;
  const before = new Set(base);
  const after = new Set(draft);
  return (
    [...after].filter((item) => !before.has(item)).length +
    [...before].filter((item) => !after.has(item)).length
  );
}

function diff(base: unknown, draft: unknown, path: Path): ReadonlyArray<Change> {
  if (jsonEqual(base, draft)) return [];
  if (isMapping(base) && isMapping(draft)) {
    const keys = [...new Set([...Object.keys(base), ...Object.keys(draft)])];
    return keys.flatMap((key) => diff(own(base, key), own(draft, key), [...path, key]));
  }
  if (Array.isArray(base) && Array.isArray(draft)) {
    const kind = listKindAt(path);
    if (kind === "set") {
      const before = strings(base);
      const after = strings(draft);
      if (before !== undefined && after !== undefined) {
        const leaves = setLeaves(before, after);
        return leaves === 0 ? [] : [{ path, leaves }];
      }
    }
    if (kind === "keyed") {
      const before = indexed(path, base);
      const after = indexed(path, draft);
      if (before !== undefined && after !== undefined) {
        // An element is addressed by its key inside the list, but a set can only name the list.
        const leaves = [...new Set([...before.keys(), ...after.keys()])]
          .flatMap((key) => diff(before.get(key), after.get(key), [...path, key]))
          .reduce((sum, change) => sum + change.leaves, 0);
        return leaves === 0 ? [] : [{ path, leaves }];
      }
    }
  }
  return [{ path, leaves: 1 }];
}

/**
 * What changed between two documents below `slice`: one change for each node the Hub would see
 * change, at the node itself for a mapping's key and at the list for a list's elements.
 */
export function changesBetween(
  base: SettingsDocument,
  draft: SettingsDocument,
  slice: Path = [],
): ReadonlyArray<Change> {
  return diff(getAt(base, slice), getAt(draft, slice), slice);
}

/** The number of changed leaves, which is what a draft's bar counts. */
export const countChanges = (
  base: SettingsDocument,
  draft: SettingsDocument,
  slice: Path = [],
): number => changesBetween(base, draft, slice).reduce((sum, change) => sum + change.leaves, 0);

const within = (outer: Path, inner: Path) =>
  outer.length <= inner.length && outer.every((key, i) => key === inner[i]);

/**
 * The sets that turn `base` into `draft` below `slice`: the draft's whole value at each changed node.
 * A page that edits at a coarser granularity names the nodes whose whole value it wants sent when
 * anything beneath them changed (`coarse`, absolute paths): a changed leaf below one is sent as that
 * node, so nothing is lost and nothing is sent twice.
 */
export function draftSets(
  base: SettingsDocument,
  draft: SettingsDocument,
  slice: Path = [],
  coarse: ReadonlyArray<Path> = [],
): PeerSettingsSet[] {
  const paths = changesBetween(base, draft, slice).map(
    ({ path }) => coarse.find((node) => within(node, path)) ?? path,
  );
  return setsFor(base, draft, paths);
}

// ---- the draft over time ----------------------------------------------------------------------------

/** What the view says now. */
export interface Live {
  readonly revision: number;
  readonly document: SettingsDocument;
}

/**
 * A draft with changes in it. `base` is the document at `revision`, which the draft started from and
 * keeps; `document` is it with the changes. A draft that was saved stands in for the revision it
 * became (`landed`) until the view reaches that revision, so what the page shows does not flicker
 * back to the values it had before the save.
 */
export interface DraftState {
  /** The page and slice the draft belongs to. */
  readonly key: string;
  readonly revision: number;
  readonly base: SettingsDocument;
  readonly document: SettingsDocument;
  readonly landed: number | null;
}

/** The draft that stands now: none for another page's, or one whose save the view has caught up with. */
export function standing(
  state: DraftState | null,
  key: string,
  live: Live | null,
): DraftState | null {
  if (state === null || state.key !== key) return null;
  if (state.landed !== null && live !== null && live.revision >= state.landed) return null;
  return state;
}

/**
 * The draft after setting `path` (below `slice`) to `value`; `undefined` removes the node. A draft
 * with no change left in it is null again, so it follows the view. Without a view there is nothing
 * to edit, and the draft stays as it was.
 */
export function edit(
  state: DraftState | null,
  key: string,
  live: Live | null,
  slice: Path,
  path: Path,
  value: unknown,
): DraftState | null {
  const current = standing(state, key, live);
  const start: DraftState | null =
    current === null
      ? live === null
        ? null
        : {
            key,
            revision: live.revision,
            base: live.document,
            document: live.document,
            landed: null,
          }
      : current.landed === null
        ? current
        : // Edits after a save are against what the save made.
          {
            key,
            revision: current.landed,
            base: current.document,
            document: current.document,
            landed: null,
          };
  if (start === null) return state;
  const document = setAt(start.document, [...slice, ...path], value);
  return countChanges(start.base, document, slice) === 0 ? null : { ...start, document };
}

/** After a save: the draft stands in for revision `seq` until the view reaches it. */
export function landed(state: DraftState | null, seq: number | undefined): DraftState | null {
  if (state === null || seq === undefined) return null;
  return { ...state, landed: seq };
}

/** How many changes a draft has not saved. */
export function unsaved(state: DraftState | null, slice: Path = []): number {
  return state === null || state.landed !== null
    ? 0
    : countChanges(state.base, state.document, slice);
}

/**
 * The settings changed under the draft since it started: the view is at a later revision and its
 * part of the document is no longer the draft's base. A revision is the whole workspace's, so a save
 * elsewhere (another project, the tool catalog) is not a change to this draft's part.
 */
export function isStale(state: DraftState | null, live: Live | null, slice: Path = []): boolean {
  return (
    state !== null &&
    state.landed === null &&
    live !== null &&
    live.revision > state.revision &&
    !jsonEqual(getAt(state.base, slice), getAt(live.document, slice))
  );
}

/** "3 unsaved changes to Booking · People" (the bar's text), or "1 unsaved change". */
export function changesText(count: number, scope?: string): string {
  const what = `${count} unsaved ${count === 1 ? "change" : "changes"}`;
  return scope === undefined || scope === "" ? what : `${what} to ${scope}`;
}
