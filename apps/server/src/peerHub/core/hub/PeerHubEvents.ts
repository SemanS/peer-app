/**
 * PeerHubEvents: the Hub's change pings for every workspace while signed in, read as they come.
 *
 * One event stream per workspace, reconnected with a growing pause after a failure and right after
 * the Hub ends it (it does every 15 minutes); a Hub without pings is asked again much later. Core
 * reads what changed at once: a workspace's work (a burst of pings, and each reconnection, reads it
 * once), its coordination and its projects, on `work`, `coord`, `projects` and `resync`. Every other
 * name goes to the active plugins whose listener names it, and `resync` (pings a subscriber missed)
 * to all of them. Connecting counts as a `resync` for every listener, since pings sent while not
 * connected were missed: what a listener reads then is current from the moment the Hub subscribed
 * it. Pings this environment caused are skipped, except by listeners that follow their own echo.
 * Names nobody follows are dropped. The periodic reads stay the fallback, so a Hub without pings,
 * or a lost connection, only means slower news.
 *
 * @module peerHub/core/hub/PeerHubEvents
 */
import type { PeerHubError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { PeerHubListener, PeerHubPing } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as HubApi from "./hubApi.ts";
import * as PeerHubClient from "./PeerHubClient.ts";

/** What core does about the Hub's pings; the PeerHub facade supplies it while core moves out. */
export interface PeerHubCoreReactions {
  /** Reads one workspace's work again. */
  readonly readWork: (workspace: string) => Effect.Effect<void, PeerHubError>;
  /** Another environment changed a workspace's coordination. */
  readonly coordinationChanged: Effect.Effect<void>;
  /** A workspace's projects changed. */
  readonly projectsChanged: Effect.Effect<void>;
}

export class PeerHubEvents extends Context.Service<
  PeerHubEvents,
  {
    /** Follows the pings of every workspace while signed in, until interrupted. */
    readonly follow: (core: PeerHubCoreReactions) => Effect.Effect<never, never, Scope.Scope>;
  }
>()("t3/peerHub/core/hub/PeerHubEvents") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const status = yield* PeerStatus.PeerStatus;
  const workChanged = yield* Queue.unbounded<string>();
  const { environmentId } = state;

  /** Tells each listener following the ping; one that fails is logged and skipped. */
  const tell = (
    listeners: ReadonlyArray<{ readonly id: string; readonly listener: PeerHubListener }>,
    ping: PeerHubPing,
  ) =>
    Effect.forEach(
      listeners,
      ({ id, listener }) => {
        const resync = ping.change === "resync";
        if (!resync && !listener.changes.includes(ping.change)) return Effect.void;
        if (!resync && ping.origin === environmentId && listener.ownEcho !== true) {
          return Effect.void;
        }
        return listener.onPing(ping).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("A Peer plugin failed on a Hub ping", {
              plugin: id,
              change: ping.change,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      },
      { discard: true },
    );

  /** The active plugins' listeners. */
  const listeners = Effect.map(plugins.active, (active) =>
    active.flatMap(({ id, contributions }) =>
      contributions.hubChanges === undefined ? [] : [{ id, listener: contributions.hubChanges }],
    ),
  );

  const onPing = (core: PeerHubCoreReactions, ping: PeerHubPing) =>
    Effect.gen(function* () {
      const resync = ping.change === "resync";
      if (ping.origin !== environmentId) {
        if (resync || ping.change === "work") yield* Queue.offer(workChanged, ping.workspace);
        if (resync || ping.change === "coord") yield* core.coordinationChanged;
        if (resync || ping.change === "projects") yield* core.projectsChanged;
      }
      yield* tell(yield* listeners, ping);
    });

  /** The Hub subscribed this environment to a workspace's pings: the work and listeners read anew. */
  const connected = (workspace: string) =>
    Effect.gen(function* () {
      yield* Queue.offer(workChanged, workspace);
      yield* tell(yield* listeners, { workspace, change: "resync", origin: null, data: {} });
    });

  const listen = (core: PeerHubCoreReactions, workspace: string) =>
    Effect.gen(function* () {
      let failures = 0;
      while (true) {
        const signedIn = yield* client.session.pipe(Effect.option);
        if (Option.isNone(signedIn)) return;
        const { hubUrl, session } = signedIn.value;
        const ended = yield* client.api
          .events(hubUrl, session, workspace, connected(workspace))
          .pipe(
            Stream.runForEach((ping) => {
              failures = 0;
              return onPing(core, { ...ping, workspace });
            }),
            Effect.result,
          );
        if (Result.isSuccess(ended)) {
          // The hub ends a stream every 15 minutes; one that ends at once must not spin.
          yield* Effect.sleep("1 second");
          continue;
        }
        if (HubApi.isSessionEnded(ended.failure)) return;
        if (HubApi.isWithoutEvents(ended.failure)) {
          yield* Effect.sleep("10 minutes");
          continue;
        }
        failures += 1;
        yield* Effect.logInfo("Peer lost the hub's change events; it reconnects", {
          workspace,
          reason: ended.failure.detail,
        });
        yield* Effect.sleep(Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6)));
      }
    });

  const follow: PeerHubEvents["Service"]["follow"] = (core) =>
    Effect.gen(function* () {
      const listeners = yield* FiberMap.make<string>();
      const listening = new Set<string>();

      // A burst of pings (an agent's first steps) reads each workspace once.
      yield* Effect.gen(function* () {
        while (true) {
          const first = yield* Queue.take(workChanged);
          yield* Effect.sleep(300);
          const rest = yield* Queue.clear(workChanged);
          for (const workspace of new Set([first, ...rest])) {
            yield* core.readWork(workspace).pipe(Effect.ignoreCause({ log: true }));
          }
          yield* status.publish;
        }
      }).pipe(Effect.forkScoped);

      while (true) {
        const signedIn = Option.isSome(yield* client.session.pipe(Effect.option));
        const workspaces = signedIn
          ? (yield* state.read).persisted.workspaces.map((workspace) => workspace.slug)
          : [];
        for (const workspace of workspaces) {
          if (listening.has(workspace)) continue;
          listening.add(workspace);
          yield* FiberMap.run(
            listeners,
            workspace,
            listen(core, workspace).pipe(
              Effect.ensuring(Effect.sync(() => listening.delete(workspace))),
            ),
          );
        }
        for (const workspace of listening) {
          if (workspaces.includes(workspace)) continue;
          listening.delete(workspace);
          yield* FiberMap.remove(listeners, workspace);
        }
        yield* Effect.sleep("15 seconds");
      }
    });

  return PeerHubEvents.of({ follow });
});

export const layer = Layer.effect(PeerHubEvents, make);
