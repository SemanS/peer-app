import type { ChangeRow } from "@t3tools/contracts";

export const NOW = Date.parse("2026-10-18T15:00:00Z");
export const at = (hhmm: string) => `2026-10-18T${hhmm}:00Z`;
export const changeId = (head: string) => head.padEnd(32, "k");
export const commit = (head: string) => head.padEnd(40, "0");

export function row(
  head: string,
  overrides: Partial<ChangeRow> & { readonly versionCount?: number } = {},
): ChangeRow {
  const { versionCount = 1, ...rest } = overrides;
  return {
    project: "ordering",
    changeId: changeId(head),
    commitId: commit(`${head}${versionCount}`),
    parents: [],
    subject: "ORD-1: something",
    paths: ["a.js"],
    bookmarks: [],
    conflict: false,
    empty: false,
    divergent: false,
    working: true,
    author: { email: "ana@acme.dev", agent: "claude-code" },
    versions: Array.from({ length: versionCount }, (_, index) => ({
      commit: commit(`${head}${index + 1}`),
      at: at(`14:${String(30 + index).padStart(2, "0")}`),
      kind: index === 0 ? "edit" : "edit",
    })),
    sessions: [],
    lastReportAt: at("14:59"),
    ...rest,
  };
}
