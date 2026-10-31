/**
 * How a room's messages meet the diff: a selected line becomes an anchor, and an anchor finds its
 * line again, or says why it cannot. A comment on an older version is never pinned to a line that
 * may have changed.
 */
import type { AnnotationSide, SelectedLineRange } from "@pierre/diffs";
import { anchorState, anchorText } from "@t3tools/client-runtime/peer/rooms";
import type { PeerRoomAnchor, PeerRoomDiff, PeerRoomMessage } from "@t3tools/contracts";

import type { WorkOpen, WorkThreadNode } from "../workTree.logic";

/** What the anchor mapping reads of a parsed file. */
export interface DiffFileLines {
  readonly path: string;
  readonly hunks: ReadonlyArray<{
    readonly additionStart: number;
    readonly additionCount: number;
    readonly deletionStart: number;
    readonly deletionCount: number;
  }>;
}

/** An anchor names `old` or `new`; the viewer calls them deletions and additions. */
export const viewerSide = (side: string): AnnotationSide =>
  side === "old" ? "deletions" : "additions";

/**
 * The anchor of a selected range. A selection across both sides keeps only the line it ended on,
 * since old and new line numbers do not make a range.
 */
export function anchorFromSelection(
  path: string,
  range: SelectedLineRange,
  head: string | undefined,
): PeerRoomAnchor {
  const endSide = range.endSide ?? range.side;
  const side = endSide === "deletions" ? "old" : "new";
  const across = (range.side ?? endSide) !== endSide;
  const line = across ? range.end : Math.min(range.start, range.end);
  const end = across ? range.end : Math.max(range.start, range.end);
  return {
    path,
    line,
    ...(end === line ? {} : { endLine: end }),
    side,
    ...(head === undefined ? {} : { commit: head }),
  };
}

/** A comment on a file whose diff is not here: the Hub takes a line, and the path is what counts. */
export const pathAnchor = (path: string): PeerRoomAnchor => ({ path, line: 1, side: "new" });

/** Whether this diff shows the line: on its side, within one of the hunks. */
export function lineInDiff(file: DiffFileLines, side: AnnotationSide, line: number) {
  return file.hunks.some((hunk) => {
    const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
    const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
    return line >= start && line < start + count;
  });
}

export interface PinnedLine {
  readonly path: string;
  readonly side: AnnotationSide;
  readonly lineNumber: number;
  readonly messages: ReadonlyArray<PeerRoomMessage>;
}

/** An anchored message with no place on this diff, and why. */
export interface ApartAnchor {
  readonly message: PeerRoomMessage;
  readonly where: string;
  readonly why: "on an earlier version" | "not in this diff";
}

/**
 * Sorts anchored messages for a diff: those whose line it shows sit at that line, the last of a
 * range, several on one line together; the rest are listed apart.
 */
export function placeAnchors(
  messages: ReadonlyArray<PeerRoomMessage>,
  files: ReadonlyArray<DiffFileLines>,
  head: string | undefined,
): { readonly pinned: ReadonlyArray<PinnedLine>; readonly apart: ReadonlyArray<ApartAnchor> } {
  const pinned = new Map<string, PinnedLine>();
  const apart: ApartAnchor[] = [];
  for (const message of messages) {
    const anchor = message.anchor;
    if (anchor === undefined) continue;
    const where = anchorText(anchor);
    if (anchorState(anchor, head) === "earlier") {
      apart.push({ message, where, why: "on an earlier version" });
      continue;
    }
    const side = viewerSide(anchor.side);
    const lineNumber = anchor.endLine ?? anchor.line;
    const file = files.find((candidate) => candidate.path === anchor.path);
    if (file === undefined || !lineInDiff(file, side, lineNumber)) {
      apart.push({ message, where, why: "not in this diff" });
      continue;
    }
    const key = `${anchor.path}\0${side}\0${lineNumber}`;
    const known = pinned.get(key);
    pinned.set(key, {
      path: anchor.path,
      side,
      lineNumber,
      messages: [...(known?.messages ?? []), message],
    });
  }
  return { pinned: [...pinned.values()], apart };
}

/** Where the diff came from, in a line over it. */
export function diffSourceText(diff: Extract<PeerRoomDiff, { state: "here" }>) {
  const from =
    diff.source === "run"
      ? "Your run's checkout"
      : diff.source === "snapshot"
        ? "Kept snapshot"
        : "The pushed branch";
  return `${from} · ${diff.head.slice(0, 8)}`;
}

/** What Watch opens where the work is not here: a colleague's thread they share, if any. */
export function watchable(
  threads: ReadonlyArray<Pick<WorkThreadNode, "mine" | "open" | "observable">>,
): WorkOpen | undefined {
  return threads.find(
    (thread) => !thread.mine && thread.observable && thread.open?.kind === "observe",
  )?.open;
}
