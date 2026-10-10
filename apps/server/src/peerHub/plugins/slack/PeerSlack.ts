/**
 * PeerSlack: Slack for this computer's agents. The calls behind the RPC methods, and the loop that
 * opens waiting agents as asks, withdraws them when they are over and delivers the owner's answers.
 *
 * @module peerHub/plugins/slack/PeerSlack
 */
import {
  PeerHubError,
  PeerSlackMe,
  type PeerSlackAdmin,
  type PeerSlackSaveSecretsInput,
  type PeerSlackWorkspaceInput as Ws,
} from "@t3tools/contracts";
import { HostProcessHostname } from "@t3tools/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerContributions } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { deliverer } from "./deliver.ts";
import { slackHub } from "./hub.ts";
import { slackLedger } from "./ledger.ts";
import { publisher, type Slack } from "./publisher.ts";
import { makeWorld, type SlackThreads } from "./world.ts";

/** Settings are read again this often, and the Hub asked for answers, whether or not it pinged. */
const SETTINGS_MS = 600_000;
const ANSWERS_MS = 60_000;
const sameMe = Schema.toEquivalence(PeerSlackMe);

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const status = yield* PeerStatus.PeerStatus;
  const agents = yield* PeerAgents.PeerAgents;
  const hub = slackHub(client);
  const raw = slackLedger(state);
  let threads: SlackThreads | undefined;
  const s: Slack = {
    environment: state.environmentId,
    hub,
    // The loop writes under the state lock; a turn-off or a cleanup already runs under it.
    ledger: { read: raw.read, update: (f) => state.lock.withPermits(1)(raw.update(f)) },
    world: makeWorld({
      work: yield* PeerWork.PeerWork,
      agents,
      threads: () => threads,
      computer: (yield* HostProcessHostname).replace(/\.local$/i, ""),
    }),
    threads: () => threads,
    agents,
    mine: new Map(),
    paused: new Set(),
  };
  /** Workspaces the Hub said changed: their settings are read again, and answers asked for. */
  const dirty = new Set<string>();
  const wake = yield* Queue.dropping<void>(1);
  const nudge = Queue.offer(wake, undefined);

  /** An admin's view with the Hub this environment is signed in to and the addresses Slack calls. */
  const admin =
    <I extends Ws>(call: (input: I) => Effect.Effect<PeerSlackAdmin, PeerHubError>) =>
    (input: I) =>
      Effect.zip(call(input), client.session).pipe(
        Effect.map(([view, { hubUrl }]) => {
          const base = `${hubUrl.replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(input.workspace)}`;
          const manifest = {
            eventsUrl: `${base}/slack/events`,
            actionsUrl: `${base}/slack/actions`,
          };
          return { ...view, hubUrl, manifest };
        }),
      );
  const saveSecrets = ({ workspace, botToken, signingSecret }: PeerSlackSaveSecretsInput) =>
    Effect.gen(function* () {
      if (botToken !== undefined) yield* hub.saveSecret(workspace, "slack-bot-token", botToken);
      if (signingSecret !== undefined) {
        yield* hub.saveSecret(workspace, "slack-signing-secret", signingSecret);
      }
      return yield* hub.admin({ workspace });
    });

  const run = Effect.gen(function* () {
    yield* status.changes.pipe(
      Stream.runForEach(() => nudge),
      Effect.forkScoped,
    );
    // Fresh with each start: the Hub is asked again for what is open.
    const publish = publisher(s);
    const deliver = deliverer(s);
    let readAt = -SETTINGS_MS;
    let askedAt = -ANSWERS_MS;
    while (true) {
      const now = yield* Clock.currentTimeMillis;
      const slugs = (yield* state.workspaces).map((workspace) => workspace.slug);
      for (const slug of s.mine.keys()) if (!slugs.includes(slug)) s.mine.delete(slug);
      const pinged = new Set(dirty);
      dirty.clear();
      const stale = now - readAt >= SETTINGS_MS;
      const minute = now - askedAt >= ANSWERS_MS;
      for (const slug of slugs) {
        // A workspace not read yet is tried again each minute.
        if (!pinged.has(slug) && !stale && !(minute && !s.mine.has(slug))) continue;
        const me = yield* Effect.option(hub.me({ workspace: slug }));
        if (Option.isNone(me)) continue;
        // A ping, or settings that changed, lift the pause a 409 slack_off put on the workspace.
        const before = s.mine.get(slug);
        if (pinged.has(slug) || (before !== undefined && !sameMe(before, me.value))) {
          s.paused.delete(slug);
        }
        s.mine.set(slug, me.value);
      }
      if (stale) readAt = now;
      yield* publish.pipe(Effect.ignoreCause({ log: true }));
      if (pinged.size > 0 || minute) {
        askedAt = now;
        yield* deliver.pipe(Effect.ignoreCause({ log: true }));
      }
      // At least every five seconds, sooner when something changed, but never twice in a second.
      const changed = Queue.take(wake).pipe(Effect.andThen(Effect.sleep("1 second")));
      yield* Effect.race(changed, Effect.sleep("5 seconds"));
    }
  });

  return {
    me: hub.me,
    setMine: hub.setMine,
    link: hub.link,
    unlink: hub.unlink,
    admin: admin(hub.admin),
    saveSecrets: admin(saveSecrets),
    verify: admin(hub.verify),
    channels: hub.channels,
    setChannels: admin(hub.setChannels),
    test: hub.test,
    unlinkMember: admin(hub.unlinkMember),
    disconnect: admin(hub.disconnect),
    /** Slack's settings or answers changed at the Hub, or the stream to it was lost and came back. */
    ping: (workspace: string) =>
      Effect.sync(() => void dirty.add(workspace)).pipe(Effect.andThen(nudge), Effect.asVoid),
    /** T3's threads, once its MCP layer has them. */
    bindThreads: (bound: SlackThreads) => {
      threads = bound;
    },
    run,
    /** Withdraws everything this computer opened, as its owner turns Slack off. Runs under the lock. */
    stop: Effect.gen(function* () {
      yield* publisher({ ...s, ledger: raw }, true);
      const left = Object.values((yield* raw.read).waits).filter((e) => e.opened && !e.closed);
      if (left.length > 0) {
        return yield* new PeerHubError({
          detail: `${left.length} Slack message(s) could not be withdrawn; they stay until they expire.`,
        });
      }
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(
          new PeerHubError({ detail: "The Hub did not answer; Slack messages stay open." }),
        ),
      ),
    ),
    /** Forgets the workspaces a person left, or all of them on signing out. Runs under the lock. */
    forget: (event: Parameters<NonNullable<PeerContributions["workspaceCleanup"]>>[0]) => {
      const keep = (workspace: string) =>
        event.kind === "synced"
          ? event.workspaces.some((w) => w.slug === workspace)
          : event.kind === "left-workspace" && event.workspace !== workspace;
      for (const slug of s.mine.keys()) if (!keep(slug)) s.mine.delete(slug);
      const kept = <A extends { readonly workspace: string }>(rows: Record<string, A>) =>
        Object.fromEntries(Object.entries(rows).filter(([, row]) => keep(row.workspace)));
      return raw
        .update((l) => ({ waits: kept(l.waits), delivered: kept(l.delivered) }))
        .pipe(Effect.ignoreCause({ log: true }));
    },
  };
});

export class PeerSlack extends Context.Service<PeerSlack, Effect.Success<typeof make>>()(
  "t3/peerHub/plugins/slack/PeerSlack",
) {}

export const layer = Layer.effect(PeerSlack, make);
