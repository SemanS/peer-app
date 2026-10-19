/**
 * What the history of a workspace's settings shows of each revision, apart from how it draws: how
 * the source reads, whether the person may revert it, which of its lines show, and how the pages
 * read so far join.
 */
import type { PeerSettingsRevisionEntry } from "@t3tools/contracts";

import { lineSummary } from "./reviewChanges.logic";

/** Revisions asked for at a time (the Hub takes up to 50). */
export const HISTORY_PAGE = 20;

/** Lines of a revision shown before "Show all". */
export const LINES_SHOWN = 4;

/**
 * The badge for where a revision came from; the app's own saves, the usual case, have none. The
 * values are the Hub's: `proposal` (an owner saved an agent's proposal), `import` (YAML), `revert`,
 * `cli` (`peerhub workspace apply`), `seed` (the history's first revision) and `gap` (the
 * configuration was applied while the history was off).
 */
export function sourceLabel(source: string): string | null {
  switch (source) {
    case "app":
      return null;
    case "proposal":
      return "Proposal";
    case "import":
      return "Import";
    case "revert":
      return "Revert";
    case "cli":
      return "CLI";
    case "seed":
      return "Start";
    case "gap":
      return "Gap";
    default:
      return `${source.charAt(0).toUpperCase()}${source.slice(1)}`;
  }
}

/**
 * Whether the person is offered "Revert…" on a revision: it has changes, it is not the history's
 * first (nothing came before it to go back to), and they may change at least one of its lines. The
 * Hub reverts the lines that are visible and theirs to change, and the review lists them.
 */
export function canRevert(
  entry: Pick<PeerSettingsRevisionEntry, "source" | "lines">,
  canChange: (path: ReadonlyArray<string>) => boolean,
): boolean {
  return (
    entry.source !== "seed" &&
    entry.lines.length > 0 &&
    entry.lines.some((line) => canChange(line.path))
  );
}

/** How many of a revision's lines the person may not revert, which stay as they are. */
export function lockedLines(
  entry: Pick<PeerSettingsRevisionEntry, "lines">,
  canChange: (path: ReadonlyArray<string>) => boolean,
): number {
  return entry.lines.filter((line) => !canChange(line.path)).length;
}

/**
 * The reason a revision was saved, when there is one: a revision saved without one has none, or
 * (from an older Hub) the first line of its summary, which is shown with the others.
 */
export function reasonOf(
  entry: Pick<PeerSettingsRevisionEntry, "message" | "lines">,
): string | null {
  const message = entry.message?.trim() ?? "";
  if (message === "" || entry.lines.some((line) => lineSummary(line) === message)) return null;
  return message;
}

/**
 * Who proposed a revision saved from a proposal, or which agent saved it for its author, as the
 * Hub's `Peer-Proposed-By` names them (`Codex for ana@acme.dev`), with the person's name for their
 * address; null for any other revision.
 */
export function proposedByOf(
  entry: Pick<PeerSettingsRevisionEntry, "proposal">,
  nameOf: (person: { readonly email: string; readonly name?: string | undefined }) => string,
): string | null {
  const proposal = entry.proposal?.trim() ?? "";
  if (proposal === "") return null;
  const agent = / for (\S+@\S+)$/.exec(proposal);
  const email = agent?.[1] ?? (proposal.includes("@") ? proposal : null);
  if (email === null) return proposal;
  const name = nameOf({ email });
  return agent === null ? name : `${proposal.slice(0, agent.index)} for ${name}`;
}

/** The lines to show, and how many are held back. */
export function shownLines<T>(lines: ReadonlyArray<T>, expanded: boolean) {
  return expanded || lines.length <= LINES_SHOWN
    ? { shown: lines, hidden: 0 }
    : { shown: lines.slice(0, LINES_SHOWN), hidden: lines.length - LINES_SHOWN };
}

/** The pages read so far, newest first, each revision once. */
export function joinPages(
  ...pages: ReadonlyArray<ReadonlyArray<PeerSettingsRevisionEntry>>
): ReadonlyArray<PeerSettingsRevisionEntry> {
  const seen = new Set<number>();
  return pages
    .flat()
    .filter((entry) => !seen.has(entry.seq) && seen.add(entry.seq))
    .toSorted((a, b) => b.seq - a.seq);
}

/**
 * The revision to ask before for the next page: the oldest one read so far. It is the same whether
 * the Hub's `before` leaves that revision out or includes it again (a revision read twice is kept
 * once), so no revision falls between two pages.
 */
export function oldestSeq(
  revisions: ReadonlyArray<Pick<PeerSettingsRevisionEntry, "seq">>,
): number | null {
  return revisions.reduce<number | null>(
    (oldest, entry) => (oldest === null || entry.seq < oldest ? entry.seq : oldest),
    null,
  );
}
