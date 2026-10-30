import type {
  UsageDay,
  UsageProviderKind,
  UsageReadError,
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

export type ReadSessionTotals = (input: {
  readonly sinceDay: UsageDay;
  readonly untilDay: UsageDay;
}) => Effect.Effect<ReadonlyArray<UsageSessionTotal>, UsageReadError>;

/**
 * `UsageService.readSessionTotals` for code that also runs where the engine does not: Peer's usage
 * plugin runs headless too, and `PeerCore` has no usage engine there. Null means none. A module of
 * its own so that reading it does not load every provider's driver.
 */
export class UsageSessionReader extends Context.Reference<ReadSessionTotals | null>(
  "t3/usage/usageSessionTotals/UsageSessionReader",
  { defaultValue: () => null },
) {}
