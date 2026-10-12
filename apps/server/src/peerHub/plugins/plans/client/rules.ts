import type { Items } from "./hub.ts";

/** The Hub's rules for what a plan may hold, which a declaration meets before it is sent. */
export const MAX_CHANGES = 40;
export const MAX_USES = 40;
export const MAX_PROVIDES = 10;
export const NAME_CHARS = 200;
const PATH_CHARS = 300;

// oxlint-disable-next-line eslint/no-control-regex -- Controls are never part of a path or a name.
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

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

export const validName = (name: string) =>
  name.trim() !== "" && [...name].length <= NAME_CHARS && !CONTROL.test(name);

/** What names an item: its path and its symbol. */
export const itemKey = (item: { readonly path: string; readonly name?: string | undefined }) =>
  `${item.path}\u0000${item.name ?? ""}`;

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
