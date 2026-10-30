// @effect-diagnostics globalDate:off - the peer command's budget in wall-clock time, as cli.ts counts it.
/* oxlint-disable oxc/no-this-in-exported-function -- Bound by CoordinationBroker, whose methods pass their broker as `this`. */
import * as Effect from "effect/Effect";

import type { PeerReviewFacts } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import type { LocalSession } from "./sessions.ts";
import { INTENT_DEADLINE_MS } from "../coordination/overlaps.ts";
import { TIMED_OUT, within } from "./sync.ts";
import { messageOf } from "./log.ts";

export async function handoffRefusal(
  this: CoordinationBroker,
  session: LocalSession,
  at: "publish" | "review" | "done" = "publish",
): Promise<{ readonly hook: string; readonly reason: string; readonly next: string } | null> {
  if (this.host.staleReads === undefined) return null;
  try {
    const freshness = await within(
      this.host.staleReads(session.workspace, session.project, session.id),
      INTENT_DEADLINE_MS,
    );
    if (freshness === TIMED_OUT) throw new Error("freshness deadline");
    const missingKnownInputs = [...session.read].some(
      ([scope, known]) =>
        !(freshness.reads ?? []).some(
          (read) => read.scope === scope && read.version >= known.version,
        ),
    );
    const recovery = missingKnownInputs
      ? "unavailable"
      : session.inputRecovery !== undefined && session.inputRecovery !== "complete"
        ? session.inputRecovery
        : (freshness.recovery ?? "revalidation-required");
    if (recovery === "complete" && freshness.fresh && freshness.stale.length === 0) return null;
    if (recovery === "unavailable" || recovery === "revalidation-required") {
      const hook = `Peer: input recovery is ${recovery}. Run ${this.cli} inputs status, read the required contexts and reconstruct missing input coverage with ${this.cli} inputs recover "<sources checked and remaining gaps>" before ${at}.`;
      this.record("handoff.recovery", { session: session.id, recovery, at });
      return {
        hook,
        reason: hook.replace(/^Peer: /, ""),
        next: `run ${this.cli} inputs status; re-read sources and explicitly reconstruct the manifest with a reason.`,
      };
    }
    this.record("handoff.stale", { session: session.id, stale: freshness.stale, at });
    const plugins = await this.plugins();
    await within(
      Promise.all(
        plugins.active.map((plugin) => {
          const report = plugin.contributions.hooks?.handoffRefused;
          return report === undefined
            ? Promise.resolve()
            : this.host
                .run(report(this.sessionView(session), freshness.stale))
                .catch(() => undefined);
        }),
      ),
      100,
    );
    const hook = `Peer: shared inputs changed. Read the current version before publishing, or explicitly confirm its change with ${this.cli} ack <task>: ${freshness.stale.map((read) => `${this.handleOf(session.workspace, session.project, read.scope)} v${read.readVersion} → v${read.currentVersion}`).join("; ")}.`;
    return {
      hook,
      reason: hook.replace(/^Peer: /, ""),
      next: "read the current version with peer context <task>, recheck the result and retry. peer ack <task> only accepts a change you have already checked.",
    };
  } catch (error) {
    this.record("handoff.unverified", { session: session.id, reason: messageOf(error), at });
    return {
      hook: "Peer could not verify shared input versions. Check peer inputs status and retry when the context authority is reachable.",
      reason: "Peer could not verify shared input versions",
      next: "check peer inputs status and retry when the context authority is reachable.",
    };
  }
}

/**
 * What the active plugins observe for an agent's move to review (`reviewFacts`), each within what
 * is left of 3 of the command's first 10 seconds; one that misses it or fails adds nothing.
 */
export async function reviewFacts(
  this: CoordinationBroker,
  session: LocalSession,
  plugins: PeerBrokerPlugins,
  started: number,
): Promise<PeerReviewFacts> {
  const facts: PeerReviewFacts = {};
  for (const plugin of plugins.active) {
    const observe = plugin.contributions.reviewFacts;
    if (!observe) continue;
    const remainingMs = Math.max(0, Math.min(3000, 10000 - (Date.now() - started)));
    const seen = await this.host.run(
      observe({ session: this.sessionView(session), remainingMs }).pipe(
        Effect.timeout(`${Math.max(1, remainingMs)} millis`),
        Effect.catchCause(() =>
          Effect.sync((): PeerReviewFacts => {
            this.record("plugin.failed", { plugin: plugin.id, at: "reviewFacts" });
            return {};
          }),
        ),
      ),
      { signal: this.stopping.signal },
    );
    Object.assign(facts, seen);
  }
  return facts;
}
