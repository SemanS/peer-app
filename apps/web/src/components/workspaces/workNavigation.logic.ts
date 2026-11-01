export function workSearch(search: Record<string, unknown>): { readonly scope?: string } {
  return typeof search.scope === "string" && search.scope.length > 0 ? { scope: search.scope } : {};
}
