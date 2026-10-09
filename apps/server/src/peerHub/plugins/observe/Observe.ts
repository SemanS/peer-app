/**
 * Observe: the team watches one of this computer's threads live while its owner shares it, through
 * the Hub's relay, and people here watch their colleagues' shared threads.
 *
 * A shared thread's view goes to the Hub only while someone watches it. When the Hub says a
 * colleague started watching (an `observe` ping), Peer sends the view at once, then on each change
 * and every 10 seconds, until the last watcher has left. Observe's work stops when observe does
 * here: its views stop going out, and watching a colleague's thread from here ends. Turning it off
 * also unshares this computer's threads, which stay unshared until their owner shares them again.
 *
 * @module peerHub/plugins/observe/Observe
 */
import {
  PeerAgentView,
  PeerHubError,
  type PeerHubObserveInput,
  type PeerHubShareThreadInput,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { observeHub } from "./hub.ts";

const sameView = Schema.toEquivalence(PeerAgentView);
const hubError = (detail: string) => new PeerHubError({ detail });

/** This computer's threads its owner lets the team watch. */
const sharedOf = (state: PeerState.RuntimeState) => state.persisted.sharedThreads ?? [];

export class Observe extends Context.Service<
  Observe,
  {
    /** This computer's threads (`peer:…`, `herdr:…`) its owner lets the team watch. */
    readonly shared: Effect.Effect<ReadonlyArray<string>>;
    /** Whether its owner lets the team watch one of this computer's threads. */
    readonly isShared: (thread: string) => boolean;
    /** Lets the team watch one of this computer's threads live, or stops it. */
    readonly share: (input: PeerHubShareThreadInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A colleague's shared thread as it happens, while watching it goes on here. */
    readonly watch: (input: PeerHubObserveInput) => Stream.Stream<PeerAgentView, PeerHubError>;
    /**
     * Someone started watching a shared thread of the environment `environment`: when it is this
     * one, the thread's view goes to the Hub.
     */
    readonly watched: (input: {
      readonly workspace: string;
      readonly environment: string;
      readonly thread: string;
    }) => Effect.Effect<void>;
    /** Stops sending views, and ends watching from here: observe stopped. */
    readonly stop: Effect.Effect<void>;
    /** Unshares every one of this computer's threads, and tells the Hub. Run under the state lock. */
    readonly unshareAll: Effect.Effect<void, PeerHubError>;
  }
>()("t3/peerHub/plugins/observe/Observe") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const work = yield* PeerWork.PeerWork;
  const hub = observeHub(yield* PeerHubClient.PeerHubClient);
  const { environmentId } = state;
  /** Shared threads whose views go to the Hub now, because someone watches them. */
  const publishing = new Map<string, { resend: boolean }>();
  const senders = yield* FiberMap.make<string>();
  /** Completed when observe stops here; watching a colleague's thread ends with it. */
  const stopped = yield* Ref.make(Deferred.makeUnsafe<void>());

  /**
   * Sends a shared thread's view to the Hub while someone watches it: at once, then on each change,
   * and every 10 s to learn when the last watcher left.
   */
  const publishThread = (workspace: string, thread: string) =>
    Effect.gen(function* () {
      let last: PeerAgentView | null = null;
      let sentAt = 0;
      while (true) {
        if (!sharedOf(yield* state.read).includes(thread)) return;
        const view = yield* work.view(thread);
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const asked = publishing.get(thread);
        if (
          last === null ||
          !sameView(last, view) ||
          asked?.resend === true ||
          now - sentAt > 10_000
        ) {
          if (asked !== undefined) asked.resend = false;
          const watchers = yield* hub
            .publish(workspace, environmentId, thread, view)
            .pipe(Effect.orElseSucceed(() => 0));
          last = view;
          sentAt = now;
          if (watchers === 0) return;
        }
        yield* Effect.sleep("1500 millis");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => publishing.delete(thread))));

  const watched: Observe["Service"]["watched"] = ({ workspace, environment, thread }) =>
    Effect.gen(function* () {
      if (environment !== environmentId) return;
      const sending = publishing.get(thread);
      if (sending !== undefined) {
        // A new watcher needs the current view now, not at the next change.
        sending.resend = true;
        return;
      }
      if (!sharedOf(yield* state.read).includes(thread)) return;
      publishing.set(thread, { resend: false });
      yield* FiberMap.run(
        senders,
        thread,
        publishThread(workspace, thread).pipe(Effect.ignoreCause({ log: true })),
      );
    });

  const stop: Observe["Service"]["stop"] = Effect.gen(function* () {
    yield* FiberMap.clear(senders);
    yield* Deferred.succeed(yield* Ref.getAndSet(stopped, Deferred.makeUnsafe<void>()), undefined);
  });

  const share: Observe["Service"]["share"] = Effect.fn("Observe.share")(function* (input) {
    if (!/^(peer|herdr):/.test(input.thread)) {
      return yield* hubError("Only this computer's threads and herdr agents can be shared.");
    }
    yield* state.updatePersisted((p) => {
      const shared = new Set(p.sharedThreads ?? []);
      if (input.shared) shared.add(input.thread);
      else shared.delete(input.thread);
      return { ...p, sharedThreads: [...shared] };
    });
    yield* work.refresh();
    return yield* status.publish;
  }, state.lock.withPermits(1));

  const watch: Observe["Service"]["watch"] = (input) =>
    Stream.unwrap(
      Effect.map(Ref.get(stopped), (whenStopped) =>
        hub.relay(input.workspace, input.environment, input.thread).pipe(
          // The hub ends a stream every 15 minutes; watching goes on until observe stops here.
          Stream.forever,
          Stream.interruptWhen(Deferred.await(whenStopped)),
        ),
      ),
    );

  const unshareAll: Observe["Service"]["unshareAll"] = Effect.gen(function* () {
    yield* stop;
    yield* state.updatePersisted((p) => ({ ...p, sharedThreads: [] }));
    // The Hub hears that none of them may be watched any more.
    yield* work.refresh();
  });

  return Observe.of({
    shared: Effect.map(state.read, sharedOf),
    isShared: (thread) => sharedOf(state.current()).includes(thread),
    share,
    watch,
    watched,
    stop,
    unshareAll,
  });
});

export const layer = Layer.effect(Observe, make);
