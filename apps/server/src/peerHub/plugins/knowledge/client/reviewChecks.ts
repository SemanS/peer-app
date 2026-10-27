/**
 * The entries' own checks `peer review` runs before it refuses a handover over drift. A review has
 * a few seconds and a project's test may take minutes, so each check runs in the background, one
 * after another, and the review waits for them only as long as it may: a check still running is
 * named, and the next review reads what it came to. A pass settles the entry for the session at
 * that head (its ledger line is staged and rides in the agent's commit); a failure is told once and
 * runs again at the next review, after the agent's fix.
 *
 * @module peerHub/plugins/knowledge/client/reviewChecks
 */
import type { PeerKnowledgeVerified } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  checkOutcome,
  UNCHECKED,
  VERIFY_RUNS,
  type CheckOutcome,
  type Drift,
  type ReviewCheck,
} from "./drift.ts";

/** Checks remembered across reviews; past this many, the oldest goes. */
const KEPT = 500;

export function reviewChecks(
  run: (checkout: string, id: string) => Promise<PeerKnowledgeVerified>,
) {
  const runs = new Map<string, { outcome: CheckOutcome | undefined; done: Promise<void> }>();
  let queue: Promise<void> = Promise.resolve();

  /**
   * Starts the checks of `drift`'s entries not run yet for `session` at its head (`VERIFY_RUNS` at
   * most), waits up to `waitMs` for those it needs, and says which passed and what the others said.
   */
  return (session: string, checkout: string, drift: Drift, waitMs: number) =>
    Effect.gen(function* () {
      const wanted: Array<{
        readonly id: string;
        readonly command: string;
        readonly key: string;
        readonly held: { outcome: CheckOutcome | undefined; done: Promise<void> };
      }> = [];
      let started = 0;
      for (const entry of drift.entries) {
        const command = entry.verify;
        if (command === undefined) continue;
        const key = `${session}\u0000${entry.id}\u0000${drift.head}`;
        let held = runs.get(key);
        if (held === undefined) {
          if (started >= VERIFY_RUNS) continue;
          started += 1;
          const record: { outcome: CheckOutcome | undefined; done: Promise<void> } = {
            outcome: undefined,
            done: Promise.resolve(),
          };
          record.done = queue = queue
            .then(() => run(checkout, entry.id))
            .then(
              (verified) => {
                record.outcome = checkOutcome(command, verified);
              },
              () => {
                record.outcome = UNCHECKED;
              },
            );
          if (runs.size >= KEPT) runs.delete(runs.keys().next().value!);
          runs.set(key, record);
          held = record;
        }
        wanted.push({ id: entry.id, command, key, held });
      }
      if (wanted.some(({ held }) => held.outcome === undefined) && waitMs > 0)
        yield* Effect.promise(() => Promise.all(wanted.map(({ held }) => held.done))).pipe(
          Effect.timeoutOption(waitMs),
        );
      const passed = new Set<string>();
      const checks = new Map<string, ReviewCheck>();
      for (const { id, command, key, held } of wanted) {
        const outcome = held.outcome;
        if (outcome === undefined) checks.set(id, { state: "running", command });
        else if (outcome.kind === "passed") passed.add(id);
        else {
          if (outcome.kind === "failed") checks.set(id, { state: "failed", check: outcome.check });
          runs.delete(key);
        }
      }
      return { passed, checks, started };
    });
}
