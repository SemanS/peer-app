/**
 * What the review section says about a change's versions and the person's mark: which comparison it
 * opens on, the labels of the two views, and the notes that keep a comparison honest.
 */
import type { ReviewState, ReviewVersionRow } from "@t3tools/client-runtime/peer/changes";
import { personName } from "@t3tools/client-runtime/peer/jujutsu";
import type { ChangeRow, ReviewDiff, ReviewDiffMode, ReviewMark } from "@t3tools/contracts";

/** Since the mark when there is something newer than it, else the whole change. */
export function defaultMode(state: ReviewState | undefined): ReviewDiffMode {
  return state !== undefined && state.since > 0 ? "since" : "whole";
}

export function compareLabels(row: ChangeRow, mark: ReviewMark | undefined) {
  const newest = row.versions.length;
  return {
    since:
      mark === undefined
        ? "Since your review"
        : `Since your review · v${mark.version} → v${newest}`,
    whole: `Whole change · main → v${newest}`,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 edit and 1 rebase onto main": what the versions after the mark were; other kinds count as versions. */
export function sinceMarkWords(
  versions: ReadonlyArray<ReviewVersionRow>,
  markedVersion: number,
): string {
  const after = versions.filter((version) => version.n > markedVersion);
  const count = (kind: string) => after.filter((version) => version.kind === kind).length;
  const known = count("edit") + count("description") + count("rebase");
  return [
    ...(count("edit") > 0 ? [plural(count("edit"), "edit", "edits")] : []),
    ...(count("description") > 0
      ? [plural(count("description"), "description change", "description changes")]
      : []),
    ...(count("rebase") > 0
      ? [plural(count("rebase"), "rebase onto main", "rebases onto main")]
      : []),
    ...(after.length > known
      ? [plural(after.length - known, "other version", "other versions")]
      : []),
  ].join(" and ");
}

/** Where the person stands, in the "Your review" box. */
export function reviewStanding(
  row: ChangeRow,
  state: ReviewState | undefined,
  versions: ReadonlyArray<ReviewVersionRow>,
  clock: (at: string) => string,
): string {
  if (state === undefined) {
    return "You have not marked a version of this change reviewed yet.";
  }
  const marked = `You marked v${state.mark.version} reviewed at ${clock(state.mark.at)}.`;
  if (state.since === 0) return `${marked} Nothing has moved since.`;
  const moved = sinceMarkWords(versions, state.mark.version);
  return `${marked} Since then: ${moved === "" ? plural(state.since, "version", "versions") : moved}.`;
}

/** What a comparison cannot say for itself: a newest version that is not here, a cut, a left-out base. */
export function diffNotes(diff: ReviewDiff, row: ChangeRow): ReadonlyArray<string> {
  const person = personName(row.author.email);
  if (diff.state === "notHere") {
    return [`${person}'s newest version is not pushed or shared yet. Nothing is compared.`];
  }
  return [
    ...(diff.state === "partial" && diff.toVersion !== undefined
      ? [
          `${person}'s newest version is not pushed or shared yet. This compares up to v${diff.toVersion}, the newest this computer has.`,
        ]
      : []),
    ...(diff.mode === "since" && diff.leftOut !== undefined && diff.leftOut > 0
      ? [
          `Main gained ${plural(diff.leftOut, "commit", "commits")} between ${diff.fromVersion === undefined ? "the two versions" : `v${diff.fromVersion} and v${diff.toVersion ?? row.versions.length}`}, which ${diff.leftOut === 1 ? "is" : "are"} not part of ${person}'s change, so ${diff.leftOut === 1 ? "it is" : "they are"} left out here.`,
        ]
      : []),
  ];
}

/** Diff lines with a key that stays with the line: its kind, number and text, and which repeat of it. */
export function keyedLines<
  T extends { readonly kind: string; readonly n?: number | undefined; readonly text: string },
>(lines: ReadonlyArray<T>): ReadonlyArray<T & { readonly key: string }> {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = `${line.kind}:${line.n ?? ""}:${line.text}`;
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    return { ...line, key: `${base}#${repeat}` };
  });
}
