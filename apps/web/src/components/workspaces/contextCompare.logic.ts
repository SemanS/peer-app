/**
 * What a link to a task's context page can ask of it: `?compare=3` puts version 3 beside the latest
 * (the review's Compare, for the version a handoff was built from).
 */
export interface ContextCompareSearch {
  readonly compare?: number | undefined;
}

/** The search as the route keeps it: `compare` only when it is a version number. */
export function parseContextCompare(search: Record<string, unknown>): ContextCompareSearch {
  const compare = search.compare;
  return typeof compare === "number" && Number.isSafeInteger(compare) && compare > 0
    ? { compare }
    : {};
}

/**
 * The two versions to show side by side: the one asked for and the latest. None when nothing was
 * asked, no context exists, or the version asked for is not older than the latest.
 */
export function contextComparison(
  compare: number | undefined,
  latest: number | undefined,
): { readonly from: number; readonly to: number } | null {
  return compare === undefined || latest === undefined || compare >= latest
    ? null
    : { from: compare, to: latest };
}
