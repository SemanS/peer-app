import { agoInWords } from "@t3tools/client-runtime/peer/work";
import { personName } from "@t3tools/client-runtime/peer/jujutsu";
import { forecastPairKey } from "@t3tools/client-runtime/peer-forecast";
import {
  PEER_FORECAST_CHECK_COMMAND_MAX,
  type PeerForecast,
  type PeerForecastPair,
  type PeerForecastSide,
} from "@t3tools/contracts";

/** What the preview says about a pair: the card it gets, or the line it joins. */
export type PairKind =
  /** The merge conflicts. */
  | "conflict"
  /** One side builds on a change in flight and meets that change's conflict, shown on its own pair. */
  | "meets"
  /** Merges clean, and the check command failed, timed out or could not be read. */
  | "check-fails"
  /** Merges clean, and the check passed or none is set. */
  | "clean";

export function pairKind(pair: PeerForecastPair): PairKind {
  if (pair.inheritedFrom !== undefined) return "meets";
  if (pair.files.length > 0 || pair.more > 0) return "conflict";
  const state = pair.check?.state;
  return state === undefined || state === "passed" ? "clean" : "check-fails";
}

export interface PreviewCounts {
  readonly conflicts: number;
  readonly failing: number;
  readonly clean: number;
  /** Whether any clean pair carries a check result; without one a clean pair is not "passing". */
  readonly checked: boolean;
}

export function previewCounts(pairs: ReadonlyArray<PeerForecastPair>): PreviewCounts {
  const kinds = pairs.map(pairKind);
  return {
    conflicts: kinds.filter((kind) => kind === "conflict").length,
    failing: kinds.filter((kind) => kind === "check-fails").length,
    clean: kinds.filter((kind) => kind === "clean").length,
    checked: pairs.some((pair) => pair.check !== undefined),
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The summary chips, in the order the page reads them; a count of zero says nothing. */
export function previewSummary(counts: PreviewCounts): ReadonlyArray<string> {
  const lines: string[] = [];
  if (counts.conflicts > 0) lines.push(plural(counts.conflicts, "conflict", "conflicts"));
  if (counts.failing > 0)
    lines.push(plural(counts.failing, "merge that fails the check", "merges that fail the check"));
  if (counts.clean > 0) {
    const pairs = counts.clean === 1 ? "1 pair merges clean" : `${counts.clean} pairs merge clean`;
    lines.push(counts.checked ? `${pairs} and ${counts.clean === 1 ? "passes" : "pass"}` : pairs);
  }
  return lines;
}

/** The cards the page opens with: conflicts first, then merges that fail the check. */
export function previewCards(
  pairs: ReadonlyArray<PeerForecastPair>,
): ReadonlyArray<{ readonly pair: PeerForecastPair; readonly kind: "conflict" | "check-fails" }> {
  const cards: Array<{ pair: PeerForecastPair; kind: "conflict" | "check-fails" }> = [];
  for (const kind of ["conflict", "check-fails"] as const)
    for (const pair of pairs) if (pairKind(pair) === kind) cards.push({ pair, kind });
  return cards;
}

export const cleanPairs = (pairs: ReadonlyArray<PeerForecastPair>) =>
  pairs.filter((pair) => pairKind(pair) === "clean");

/** `ORD-11 · Ana`: the task (else the branch) and the person. */
export function sideLabel(side: PeerForecastSide, me: string | null): string {
  return `${side.task ?? side.branch} · ${side.email === me ? "you" : personName(side.email)}`;
}

const possessive = (side: PeerForecastSide, me: string | null) =>
  side.email === me ? "your" : `${personName(side.email)}'s`;

/** The kind of copy a side was read from, in the words the footer uses. */
function sourceNoun(side: PeerForecastSide): string {
  if (side.source === "live") return "live work";
  if (side.source === "shared") return "shared work";
  if (side.source === "pushed") return "pushed version";
  return side.where === "here" ? "work" : "pushed version";
}

/** "checked on this computer against Eva's shared work and Ana's pushed version" */
export function checkedAgainst(pair: PeerForecastPair, me: string | null): string {
  const part = (side: PeerForecastSide) => `${possessive(side, me)} ${sourceNoun(side)}`;
  return `Checked on this computer against ${part(pair.a)} and ${part(pair.b)}`;
}

/** Why a side's newest edits may be missing: a teammate's pushed version is as old as their push. */
export function sideNote(side: PeerForecastSide, me: string | null, now: number): string | null {
  if (side.source !== "pushed" || side.email === me) return null;
  const when = side.readAt === undefined ? "" : ` from ${agoInWords(Date.parse(side.readAt), now)}`;
  return `${personName(side.email)}'s newest edits are not in this check: the preview uses their pushed version${when}.`;
}

/** The side that is not `side`. */
export const otherSide = (pair: PeerForecastPair, side: "a" | "b") =>
  pair[side === "a" ? "b" : "a"];

/** The conflicting file names, as the card heads them. */
export function conflictFiles(pair: PeerForecastPair): string {
  const files = pair.files.join(", ");
  return pair.more > 0 ? `${files} and ${pair.more} more` : files;
}

/** The check's result as one line ("npm test passed", "Check fails", "Check timed out"). */
export function checkResultLine(
  pair: PeerForecastPair,
  command: string | undefined,
): string | null {
  const check = pair.check;
  if (check === undefined) return null;
  const name = command === undefined || command === "" ? "Check" : command;
  switch (check.state) {
    case "passed":
      return `${name} passed`;
    case "fails":
      return command === undefined || command === "" ? "Check fails" : `${command} fails`;
    case "timedOut":
      return "Check timed out after 5 minutes";
    case "couldNotRead":
      return "Check result could not be read";
  }
}

/** The badge on a failing card: what the check said. */
export function checkBadge(pair: PeerForecastPair): string {
  switch (pair.check?.state) {
    case "timedOut":
      return "Check timed out";
    case "couldNotRead":
      return "Check could not be read";
    default:
      return "Check fails";
  }
}

/** "Checked on this computer 2 min ago. npm test passed." for a clean pair. */
export function cleanPairLine(
  pair: PeerForecastPair,
  command: string | undefined,
  now: number,
): string {
  const result = checkResultLine(pair, command);
  const at = pair.check?.at ?? pair.checkedAt;
  const when = Number.isFinite(Date.parse(at)) ? ` ${agoInWords(Date.parse(at), now)}` : "";
  return `Checked on this computer${when}.${result === null ? "" : ` ${result}.`}`;
}

/** One row of the Changes inspector's "With the other changes". */
export interface ChangePairRow {
  readonly key: string;
  readonly pair: PeerForecastPair;
  readonly kind: PairKind;
  /** The selected change's own side. */
  readonly mine: "a" | "b";
  readonly other: PeerForecastSide;
  /** "Meets ORD-11's conflict with ORD-14" for a stacked side. */
  readonly meets: string | null;
}

/**
 * The pairs of the selected change, by its task or any of its bookmarks. A pair that only exists
 * because the other side builds on a change in flight shows to the stacked side alone: the
 * change it builds on has its own pair, and the third change has nothing to do with it.
 */
export function changePairRows(
  forecast: PeerForecast | "unavailable",
  change: { readonly taskId: string | undefined; readonly bookmarks: ReadonlyArray<string> },
  scope: { readonly workspace: string; readonly project: string },
): ReadonlyArray<ChangePairRow> {
  if (forecast === "unavailable" || forecast.state !== "on") return [];
  const isMine = (side: PeerForecastSide) =>
    (change.taskId !== undefined && side.task === change.taskId) ||
    change.bookmarks.includes(side.branch);
  const rows: ChangePairRow[] = [];
  for (const pair of forecast.pairs) {
    if (pair.workspace !== scope.workspace || pair.project !== scope.project) continue;
    const mine = isMine(pair.a) ? "a" : isMine(pair.b) ? "b" : null;
    if (mine === null) continue;
    const inherited = pair.inheritedFrom;
    if (inherited !== undefined && inherited.side !== mine) continue;
    const other = otherSide(pair, mine);
    rows.push({
      key: forecastPairKey(pair),
      pair,
      kind: pairKind(pair),
      mine,
      other,
      meets:
        inherited === undefined
          ? null
          : `Meets ${inherited.task ?? inherited.branch}'s conflict with ${other.task ?? other.branch}`,
    });
  }
  return rows;
}

/** What the check-command row holds after an edit: trimmed, and null when it is not allowed. */
export function checkCommandDraft(text: string): { value: string; error: string | null } {
  const value = text.trim();
  return {
    value,
    error:
      value.length > PEER_FORECAST_CHECK_COMMAND_MAX
        ? `At most ${PEER_FORECAST_CHECK_COMMAND_MAX} characters.`
        : null,
  };
}

/** The local clock time a check finished, as the page header tells it ("14:52"). */
export function clockTime(at: string | undefined): string | null {
  if (at === undefined) return null;
  const time = new Date(at);
  return Number.isNaN(time.getTime())
    ? null
    : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
