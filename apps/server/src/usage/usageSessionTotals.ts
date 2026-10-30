import type {
  UsageDay,
  UsageProviderKind,
  UsageReadError,
  UsageSource,
  UsageTokenTotals,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** What one session cost on one UTC day with one model, from one transcript directory. */
export interface UsageSessionTotal {
  readonly day: string;
  readonly provider: UsageProviderKind;
  readonly model: string;
  /** Empty when the format names no session. */
  readonly sessionId: string;
  readonly cwd?: string;
  /** The source directory the scan found it in. */
  readonly dir: string;
  readonly totals: UsageTokenTotals;
  readonly costUsd: number;
  /** No record of it has a price, so `costUsd` is a gap and not a zero. */
  readonly unpriced: boolean;
}

export interface UsageSessionTotals {
  readonly sessions: ReadonlyArray<UsageSessionTotal>;
  /** A Claude or Codex transcript source failed outright (`transcriptSourceFailed`). */
  readonly failed: boolean;
}

const TRANSCRIPT_PROVIDERS: ReadonlySet<UsageProviderKind> = new Set(["claude", "codex"]);

/**
 * Whether the read lost a source that carries workspace work. `partial` does not count, and neither
 * does any other provider: an unreadable file stays out and a signed-out Cursor is its own matter,
 * and neither may stop what can be read.
 */
export const transcriptSourceFailed = (sources: ReadonlyArray<UsageSource>) =>
  sources.some(
    ({ status, fingerprint }) =>
      status === "failed" && TRANSCRIPT_PROVIDERS.has(fingerprint.provider),
  );

export type ReadSessionTotals = (input: {
  readonly sinceDay: UsageDay;
  readonly untilDay: UsageDay;
}) => Effect.Effect<UsageSessionTotals, UsageReadError>;

/**
 * `UsageService.readSessionTotals` for code that also runs where the engine does not: Peer's usage
 * plugin runs headless too, and `PeerCore` has no usage engine there. Null means none. A module of
 * its own so that reading it does not load every provider's driver.
 */
export class UsageSessionReader extends Context.Reference<ReadSessionTotals | null>(
  "t3/usage/usageSessionTotals/UsageSessionReader",
  { defaultValue: () => null },
) {}
