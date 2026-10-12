import type { PeerPlanItem } from "@t3tools/contracts";
import type { CodeGraph } from "./client/codegraph.ts";
import { NO_NOTES, itemKey, once, type Items, type Notes, type Unresolved } from "./items.ts";

/** How many files one declaration reads the symbols of, and how long the reading may begin for. */
const FILES = 10;
const BEGIN_MS = 3_000;

/** Whether `qualified` is `given` with something before it, set apart by an identifier boundary: `.`, `::` or `#`. */
const endsAt = (qualified: string, given: string) =>
  qualified.length > given.length &&
  qualified.endsWith(given) &&
  /[.:#]/.test(qualified[qualified.length - given.length - 1] ?? "");

/** The last part of a qualified name. */
const last = (name: string) => name.split(/::|[.#]/).at(-1) ?? name;

/**
 * What the symbols an index lists in a file say of a name: it is one of them; or the one whose
 * qualified name ends with it (the name then becomes that symbol's); or it is qualified and the
 * index lists its last part. Otherwise it is kept as written: the symbols that end with it are its
 * candidates, and two or more of them make it ambiguous.
 */
export function resolveName(
  given: string,
  listed: ReadonlyArray<string>,
): { readonly name: string; readonly known: boolean; readonly candidates: ReadonlyArray<string> } {
  if (listed.includes(given)) return { name: given, known: true, candidates: [] };
  const ending = listed.filter((name) => endsAt(name, given));
  const [only] = ending;
  if (ending.length === 1 && only !== undefined) return { name: only, known: true, candidates: [] };
  const known = ending.length === 0 && last(given) !== given && listed.includes(last(given));
  return { name: given, known, candidates: ending };
}

/**
 * A declaration's `path#symbol` items checked against the checkout's code index, read only: a
 * short name becomes the one qualified symbol it ends, and the names the index does not know stay as
 * written and are listed. Without a ready index, or for files it cannot read in time, they stay as
 * written too, and it says only that the index could not be used when it was no use at all.
 */
export async function resolveItems(
  graph: CodeGraph,
  root: string,
  items: Items,
  now: () => number,
): Promise<{ readonly items: Items; readonly notes: Notes }> {
  const named = [...items.changes, ...items.maybes, ...items.uses].filter((item) => item.name);
  if (named.length === 0) return { items, notes: NO_NOTES };
  if (!(await graph.ready(root, now()).catch(() => false)))
    return { items, notes: { index: "unusable", unresolved: [] } };
  const deadline = now() + BEGIN_MS;
  const listed = new Map<string, ReadonlyArray<string>>();
  for (const path of [...new Set(named.map((item) => item.path))].slice(0, FILES)) {
    if (now() > deadline) break;
    const names = await graph.symbols(root, path, now()).catch(() => undefined);
    if (names !== undefined) listed.set(path, names);
  }
  const unresolved = new Map<string, Unresolved>();
  const fix = (item: PeerPlanItem): PeerPlanItem => {
    const symbols = listed.get(item.path);
    if (item.name === undefined || symbols === undefined) return item;
    const found = resolveName(item.name, symbols);
    if (!found.known)
      unresolved.set(itemKey(item), {
        path: item.path,
        name: item.name,
        candidates: found.candidates,
      });
    return found.name === item.name ? item : { path: item.path, name: found.name };
  };
  const fixed = (list: ReadonlyArray<PeerPlanItem>) => once(list.map(fix), itemKey);
  return {
    items: {
      ...items,
      changes: fixed(items.changes),
      maybes: fixed(items.maybes),
      uses: fixed(items.uses),
    },
    notes: { index: "ready", unresolved: [...unresolved.values()] },
  };
}
