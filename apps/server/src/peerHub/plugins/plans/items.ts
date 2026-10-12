import type { PeerPlanItem, PeerPlanProvides } from "@t3tools/contracts";

/** What a plan names, in its four lists: the items a plan changes, may change and uses, and the contracts it provides. */
export interface Items {
  readonly changes: ReadonlyArray<PeerPlanItem>;
  readonly maybes: ReadonlyArray<PeerPlanItem>;
  readonly uses: ReadonlyArray<PeerPlanItem>;
  readonly provides: ReadonlyArray<PeerPlanProvides>;
}

/** The Hub's limits: changes and maybes together, uses, and contract lines. */
export const MAX_CHANGES = 40;
export const MAX_USES = 40;
export const MAX_PROVIDES = 10;
const NAME_CHARS = 200;
const PATH_CHARS = 300;

/** A name the index does not know: why a name stays as written, and what it might have meant. */
export interface Unresolved {
  readonly path: string;
  readonly name: string;
  readonly candidates: ReadonlyArray<string>;
}

/** What the local code index said of a declaration's `path#symbol` items. */
export interface Notes {
  readonly index: "ready" | "unusable" | "unneeded";
  readonly unresolved: ReadonlyArray<Unresolved>;
}
export const NO_NOTES: Notes = { index: "unneeded", unresolved: [] };

/** Why an input is no plan, and what to run instead when the form alone does not say. */
export interface Bad {
  readonly reason: string;
  readonly next?: string;
}

// oxlint-disable-next-line eslint/no-control-regex -- Controls are never part of a path or a name.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * A path as the Hub's coordination paths are: inside the repository, relative to its root, with
 * forward slashes and no `..`; a directory keeps its trailing `/`. An absolute path counts when it
 * lies under `root`. Null for anything else.
 */
export function repositoryPath(root: string, raw: string): string | null {
  let path = raw.trim().replaceAll("\\", "/");
  if (path.startsWith("/")) {
    const base = root.endsWith("/") ? root : `${root}/`;
    if (!path.startsWith(base)) return null;
    path = path.slice(base.length);
  }
  if (path === "" || path.length > PATH_CHARS || path.includes(":") || CONTROL.test(path))
    return null;
  const parts = path.split("/");
  if (parts.includes("..")) return null;
  const normalized = parts.filter((part) => part !== "" && part !== ".").join("/");
  return normalized === "" ? null : path.endsWith("/") ? `${normalized}/` : normalized;
}

const validName = (name: string) =>
  name.trim() !== "" && [...name].length <= NAME_CHARS && !CONTROL.test(name);

/** `<path>`, `<dir>/` or `<path>#<symbol>`: the symbol is whatever follows the first `#`. */
export function parseItem(root: string, raw: string): { item: PeerPlanItem } | Bad {
  const at = raw.indexOf("#");
  const spelled = at < 0 ? raw : raw.slice(0, at);
  const path = repositoryPath(root, spelled);
  if (path === null)
    return { reason: `${spelled.trim() || "an empty path"} is outside the repository` };
  if (at < 0) return { item: { path } };
  const name = raw.slice(at + 1).trim();
  if (path.endsWith("/")) return { reason: `${path} is a directory, which names no symbol` };
  if (!validName(name))
    return { reason: `${raw.trim()} needs a symbol of 1 to ${NAME_CHARS} characters after the #` };
  return { item: { path, name } };
}

/**
 * `<symbol> (<path>): <contract>`: a `## Provides` bullet without its dash, the symbol with or
 * without backticks. The path is a file; the contract is whatever follows the colon.
 */
export function parseProvides(root: string, raw: string): { provides: PeerPlanProvides } | Bad {
  const match = /^\s*(?:-\s+)?`?([^\s`()]+)`?\s*\((.+?)\)\s*:\s*(\S.*)$/s.exec(raw);
  if (match === null)
    return {
      reason: 'a contract names its path: "<symbol> (<path>): <contract>"',
      next: 'pass --provides "Fee.refundCents (src/payments/fees.ts): integer cents"',
    };
  const [, name = "", spelled = "", contract = ""] = match;
  const path = repositoryPath(root, spelled);
  if (path === null) return { reason: `${spelled.trim()} is outside the repository` };
  if (path.endsWith("/")) return { reason: `${path} is a directory: a contract names a file` };
  if (!validName(name))
    return { reason: `${name} is not a symbol of 1 to ${NAME_CHARS} characters` };
  return { provides: { name, path, contract: contract.trim() } };
}

/** The entries once each by `key`, the last of two with one key standing, in the order they were named. */
export const once = <T>(list: ReadonlyArray<T>, key: (entry: T) => string): ReadonlyArray<T> =>
  list.filter((entry, at) => list.findLastIndex((other) => key(other) === key(entry)) === at);

export const isEmpty = (items: Items) =>
  items.changes.length + items.maybes.length + items.uses.length + items.provides.length === 0;

/** Whether a plan of these items is over the Hub's limits. */
export const overLimits = (items: Items) =>
  items.changes.length + items.maybes.length > MAX_CHANGES ||
  items.uses.length > MAX_USES ||
  items.provides.length > MAX_PROVIDES;
