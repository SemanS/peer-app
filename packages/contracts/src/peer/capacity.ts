import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";
import { PeerBudgetPeriod, PeerCurrency } from "./base.ts";

/**
 * Shared capacity: a workspace project's AI capacity, through the Hub's gateway, on this
 * environment as a provider instance holding a per-member, per-project key.
 */

export const PeerHubSharedCapacityInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type PeerHubSharedCapacityInput = typeof PeerHubSharedCapacityInput.Type;

export const PeerHubProjectUsage = Schema.Struct({
  project: Schema.String,
  currency: PeerCurrency,
  shared: Schema.NullOr(
    Schema.Struct({
      budget: Schema.Number,
      period: PeerBudgetPeriod,
      spent: Schema.Number,
      members: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          allocation: Schema.NullOr(Schema.Number),
          spent: Schema.Number,
        }),
      ),
    }),
  ),
  /** Token totals peers reported for this period, personal and shared. */
  reported: Schema.Array(
    Schema.Struct({
      member: Schema.String,
      harness: Schema.String,
      capacity: Schema.Literals(["personal", "shared"]),
      inputTokens: Schema.Number,
      outputTokens: Schema.Number,
      cachedInputTokens: Schema.Number,
      costUsd: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type PeerHubProjectUsage = typeof PeerHubProjectUsage.Type;
