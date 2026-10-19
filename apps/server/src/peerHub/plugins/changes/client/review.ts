/**
 * Review versions (design D10): what moved in a change since the version its reviewer marked, from
 * jj itself. The versions are the commits the author's computer reported, in the order the Hub
 * received them; this computer compares up to the newest it has and says so when that is not the
 * newest, and never fetches.
 *
 * @module peerHub/plugins/changes/review
 */
import type { ChangeVersion, ReviewDiff, ReviewDiffFile, ReviewDiffLine } from "@t3tools/contracts";

import * as Jj from "./jj.ts";

const FILES_MAX = 100;
const LINES_MAX = 400;
const SHORT = 8;

/** Splits `jj diff --git` output into files with numbered lines. */
export function parseGitDiff(text: string): ReadonlyArray<ReviewDiffFile> {
  const files: ReviewDiffFile[] = [];
  let current:
    | { path: string; lines: ReviewDiffLine[]; added: number; removed: number }
    | undefined;
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  const close = () => {
    if (current !== undefined) files.push(current);
    current = undefined;
    inHunk = false;
  };
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (header !== null) {
      close();
      current = { path: header[2]!, lines: [], added: 0, removed: 0 };
      continue;
    }
    if (current === undefined) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    const kind = line[0];
    const keep = current.lines.length < LINES_MAX;
    // A line's kind carries its marker; clients draw the marker from the kind.
    const text = line.slice(1);
    if (kind === "+") {
      current.added += 1;
      if (keep) current.lines.push({ kind: "add", n: newN, text });
      newN += 1;
    } else if (kind === "-") {
      current.removed += 1;
      if (keep) current.lines.push({ kind: "del", n: oldN, text });
      oldN += 1;
    } else if (kind === " ") {
      if (keep) current.lines.push({ kind: "context", n: newN, text });
      oldN += 1;
      newN += 1;
    }
  }
  close();
  return files.slice(0, FILES_MAX);
}

export interface ReviewRequest {
  readonly cwd: string;
  readonly changeId: string;
  readonly mode: "since" | "whole";
  /** The versions the Hub holds, oldest first. */
  readonly versions: ReadonlyArray<ChangeVersion>;
  /** The version the person marked reviewed. */
  readonly mark: { readonly commit: string; readonly version: number } | undefined;
  /** Compare from this commit, when this computer has it, instead of the mark. */
  readonly from?: string | undefined;
}

/** The diff of a change as asked, or why there is none on this computer. */
export async function reviewDiffFor(request: ReviewRequest): Promise<ReviewDiff> {
  const { cwd, changeId, mode, versions } = request;
  const fromHere =
    request.from !== undefined && (await Jj.commitHere(cwd, request.from))
      ? request.from
      : undefined;
  const mark =
    fromHere === undefined
      ? request.mark
      : { commit: fromHere, version: versions.findIndex((v) => v.commit === fromHere) + 1 };
  let at = versions.length - 1;
  while (at >= 0 && !(await Jj.commitHere(cwd, versions[at]!.commit))) at -= 1;
  if (at < 0) return { state: "notHere", mode, files: [] };
  const newest = at === versions.length - 1;
  const commit = versions[at]!.commit;
  const target = newest ? changeId.slice(0, SHORT) : commit.slice(0, SHORT);
  const base = { state: newest ? "ok" : "partial", mode, toVersion: at + 1 } as const;
  if (mode === "whole" && fromHere === undefined) {
    return {
      ...base,
      command: newest ? `jj diff -r ${target}` : `jj diff -r ${commit.slice(0, SHORT)}`,
      files: parseGitDiff(await Jj.gitDiff(cwd, commit)),
    };
  }
  // Nothing was marked: there is no "since" to show.
  if (mark === undefined) return { ...base, files: [] };
  return {
    ...base,
    command: `jj interdiff --from ${mark.commit.slice(0, SHORT)} --to ${target}`,
    ...(mark.version > 0 ? { fromVersion: mark.version } : {}),
    files: mark.commit === commit ? [] : parseGitDiff(await Jj.gitDiff(cwd, commit, mark.commit)),
    leftOut: await Jj.gainedBetween(cwd, mark.commit, commit).catch(() => 0),
  };
}
