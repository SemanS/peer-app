/**
 * publisher — opens this computer's waiting agents as asks in Slack once the member's delay has
 * passed, and withdraws them when they are over. The Hub decides where an ask goes.
 *
 * @module peerHub/plugins/slack/publisher
 */
import type { PeerSlackMe } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { SlackHub } from "./hub.ts";
import { hubKey, millis, observe, over, type Entry, type SlackLedger } from "./ledger.ts";
import type { SlackThreads, SlackWorld } from "./world.ts";

/** What the publisher and the deliverer share. */
export interface Slack {
  readonly environment: string;
  readonly hub: SlackHub;
  readonly ledger: SlackLedger;
  readonly world: SlackWorld;
  readonly threads: () => SlackThreads | undefined;
  readonly agents: Pick<PeerAgents.PeerAgents["Service"], "promptRuntime">;
  /** Each workspace's `GET /slack/me`; a workspace not read is left alone. */
  readonly mine: Map<string, PeerSlackMe>;
  /** Workspaces where the Hub said Slack is off for an ask: nothing is opened until the next ping. */
  readonly paused: Set<string>;
}

const activeIn = (me: PeerSlackMe | undefined) =>
  me !== undefined && me.connected && me.link !== null && me.settings.enabled;

/**
 * One look at the waiting agents: opens what is due and withdraws what is over. With `off`, nothing
 * is waiting any more: everything this computer opened is withdrawn, whatever the settings say.
 * A Hub that cannot be reached ends the look, to be taken up again.
 */
export const publisher = (s: Slack, off = false) => {
  /** Opened waits the Hub has confirmed since the loop started; the others are opened again. */
  const confirmed = new Set<string>();
  const put = (key: string, entry: Entry) =>
    s.ledger.update((ledger) => ({ ...ledger, waits: { ...ledger.waits, [key]: entry } }));

  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const before = yield* s.ledger.read;
    const entries = Object.entries(before.waits);
    const known = off ? new Set(entries.map(([, e]) => e.workspace)) : new Set(s.mine.keys());
    const active = new Set(
      [...known].filter((workspace) => !off && activeIn(s.mine.get(workspace))),
    );
    const owed = entries.some(([, e]) => e.opened && !e.closed && known.has(e.workspace));
    if (active.size === 0 && !owed) return;
    const tracked = new Set(entries.flatMap(([key, e]) => (e.firstSeenAt === null ? [] : [key])));
    const world = off ? null : yield* s.world(active, tracked);
    // Without the threads nothing is known: nothing is opened, nothing withdrawn.
    if (world === undefined) return;

    const wanted = (world?.waits ?? []).filter((wait) => {
      const me = s.mine.get(wait.workspace);
      const mode = me?.projects.find((project) => project.id === wait.project)?.mode;
      return me?.settings.kinds.includes(wait.kind) === true && mode !== "off" && mode !== "unset";
    });
    const seen = observe(before, wanted, known, now);
    if (seen !== before) yield* s.ledger.update((ledger) => ({ ...ledger, waits: seen.waits }));

    const live = new Map(wanted.map((wait) => [wait.waitKey, wait]));
    for (const [key, e] of Object.entries(seen.waits)) {
      const { workspace } = e;
      if (e.firstSeenAt === null || e.closed || !known.has(workspace)) continue;
      const wait = live.get(key);
      const body = { environment: s.environment, waitKey: hubKey(key, e) };
      if (wait === undefined) {
        const reason = world === null ? "off" : world.why(key) === "ended" ? "ended" : "handled";
        const sent = yield* Effect.result(s.hub.withdraw(workspace, { ...body, reason }));
        // A Hub that refuses to withdraw will not later; one that cannot be reached will.
        if (Result.isFailure(sent) && sent.failure.refused !== true) return;
        confirmed.delete(key);
        yield* put(key, over(e));
        continue;
      }
      const delay = (s.mine.get(workspace)?.settings.delayMinutes ?? 0) * 60_000;
      const due = e.opened
        ? !confirmed.has(key)
        : !s.paused.has(workspace) && now - millis(e.firstSeenAt) >= delay;
      if (!due) continue;
      const { project, task, subject, kind, text, options, decisions } = wait;
      const ask = { ...body, project, task, subject, kind, text, options, decisions };
      const sent = yield* Effect.result(s.hub.open(workspace, ask));
      if (Result.isFailure(sent)) {
        if (sent.failure.refused !== true) return;
      } else if (typeof sent.success === "object" && "off" in sent.success) {
        s.paused.add(workspace);
      } else {
        confirmed.add(key);
        yield* put(key, { ...e, opened: true, closed: sent.success === "closed" });
      }
    }
  });
};
