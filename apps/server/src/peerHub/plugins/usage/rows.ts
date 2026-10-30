/**
 * What one computer's day becomes on the wire. Each row is built field by field: the Hub refuses
 * any other field, and this is the point where a session's path and id are left behind.
 *
 * @module peerHub/plugins/usage/rows
 */
import {
  PEER_USAGE_MODEL_PATTERN,
  PEER_USAGE_REPORT_LIMITS,
  type PeerUsageReportRow,
} from "@t3tools/contracts";

import type { UsageSessionTotal } from "../../../usage/usageSessionTotals.ts";

const OTHER_MODEL = "other";
/** Rounding also keeps a sum independent of the order sessions were read in. */
const USD_DIGITS = 1e6;

export type UsageRowInput = Pick<
  UsageSessionTotal,
  "provider" | "model" | "sessionId" | "totals" | "costUsd" | "unpriced"
> & { readonly capacity: PeerUsageReportRow["capacity"] };

interface Fold {
  readonly agent: string;
  readonly model: string;
  readonly capacity: PeerUsageReportRow["capacity"];
  /** Unpriced tokens stay apart from priced ones, or a fold would hide the gap or the money. */
  readonly priced: boolean;
  input: number;
  output: number;
  cached: number;
  usd: number;
  sessions: number;
}

/** Never cut to fit: part of a path is still a path. */
const wireModel = (model: string) => (PEER_USAGE_MODEL_PATTERN.test(model) ? model : OTHER_MODEL);

/** Claude's `<synthetic>` records carry no tokens and no price, and would read as a pricing gap. */
const hasTokens = ({ totals }: UsageRowInput) =>
  totals.uncachedInputTokens +
    totals.cacheCreationTokens +
    totals.cachedInputTokens +
    totals.outputTokens >
  0;

const keyOf = ({ agent, model, capacity, priced }: Omit<Fold, keyof Tallies>) =>
  [agent, model, capacity, priced].join("\0");

type Tallies = Pick<Fold, "input" | "output" | "cached" | "usd" | "sessions">;

const tokensOf = (fold: Fold) => fold.input + fold.output + fold.cached;

const foldSessions = (sessions: ReadonlyArray<UsageRowInput>): ReadonlyArray<Fold> => {
  const folds = new Map<string, Fold & { readonly ids: Set<string> }>();
  for (const session of sessions.filter(hasTokens)) {
    const shape = {
      agent: session.provider,
      model: wireModel(session.model),
      capacity: session.capacity,
      priced: !session.unpriced,
    };
    const key = keyOf(shape);
    const fold = folds.get(key) ?? {
      ...shape,
      input: 0,
      output: 0,
      cached: 0,
      usd: 0,
      sessions: 0,
      ids: new Set<string>(),
    };
    const { totals } = session;
    fold.input += totals.uncachedInputTokens + totals.cacheCreationTokens;
    fold.output += totals.outputTokens;
    fold.cached += totals.cachedInputTokens;
    fold.usd += session.unpriced ? 0 : session.costUsd;
    if (session.sessionId !== "") fold.ids.add(session.sessionId);
    fold.sessions = fold.ids.size;
    folds.set(key, fold);
  }
  return [...folds.values()].map(({ ids: _ids, ...fold }) => fold);
};

/** The list with its smallest named row moved into its `other`; null when none is left. */
const foldSmallest = (folds: ReadonlyArray<Fold>): ReadonlyArray<Fold> | null => {
  const smallest = folds
    .filter((fold) => fold.model !== OTHER_MODEL)
    .toSorted((a, b) => tokensOf(a) - tokensOf(b) || a.model.localeCompare(b.model))[0];
  if (smallest === undefined) return null;
  const shape = { ...smallest, model: OTHER_MODEL };
  const other = folds.find((fold) => keyOf(fold) === keyOf(shape));
  const merged: Fold = {
    ...shape,
    input: smallest.input + (other?.input ?? 0),
    output: smallest.output + (other?.output ?? 0),
    cached: smallest.cached + (other?.cached ?? 0),
    usd: smallest.usd + (other?.usd ?? 0),
    sessions: smallest.sessions + (other?.sessions ?? 0),
  };
  return [...folds.filter((fold) => fold !== smallest && fold !== other), merged];
};

const toRow = (fold: Fold): PeerUsageReportRow => {
  const count = (value: number) =>
    Math.min(PEER_USAGE_REPORT_LIMITS.count, Math.max(0, Math.trunc(value)));
  const usd = Math.round(fold.usd * USD_DIGITS) / USD_DIGITS;
  return {
    agent: fold.agent,
    model: fold.model,
    capacity: fold.capacity,
    input: count(fold.input),
    output: count(fold.output),
    cached: count(fold.cached),
    usd: fold.priced && Number.isFinite(usd) ? Math.min(PEER_USAGE_REPORT_LIMITS.usd, usd) : null,
    sessions: count(fold.sessions),
  };
};

/** The body's size with the largest `rev` it could carry: the contract's schema cannot say this. */
const bodyBytes = (environment: string, rows: ReadonlyArray<PeerUsageReportRow>) =>
  new TextEncoder().encode(JSON.stringify({ environment, rev: Number.MAX_SAFE_INTEGER, rows }))
    .length;

const withinLimits = (environment: string, rows: ReadonlyArray<PeerUsageReportRow>) =>
  rows.length <= PEER_USAGE_REPORT_LIMITS.rows &&
  bodyBytes(environment, rows) <= PEER_USAGE_REPORT_LIMITS.bytes;

/** One computer's day for one project, in an order that does not depend on the scan's. */
export function reportRows(
  sessions: ReadonlyArray<UsageRowInput>,
  environment: string,
): ReadonlyArray<PeerUsageReportRow> {
  let folds = foldSessions(sessions);
  while (!withinLimits(environment, folds.map(toRow))) {
    const next = foldSmallest(folds);
    if (next === null) break;
    folds = next;
  }
  return folds
    .map(toRow)
    .toSorted(
      (a, b) =>
        a.agent.localeCompare(b.agent) ||
        a.model.localeCompare(b.model) ||
        a.capacity.localeCompare(b.capacity) ||
        Number(a.usd === null) - Number(b.usd === null),
    );
}
