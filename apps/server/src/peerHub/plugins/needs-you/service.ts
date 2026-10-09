import {
  PeerHubError,
  type PeerHubStatus,
  type PeerNeedsYouStatus,
  type PeerStaleInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import { AgentAwarenessRelay } from "../../../relay/AgentAwarenessRelay.ts";
import { ServerConfig } from "../../../config.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { Refusals } from "./refusals.ts";
import { nextWake } from "./decisions.ts";
import { fileLedger } from "./ledger.ts";
import { Publisher } from "./publisher.ts";

export class NeedsYou extends Context.Service<
  NeedsYou,
  {
    readonly read: Effect.Effect<PeerNeedsYouStatus>;
    readonly refuse: (session: string, scopes: PeerStaleInput["scopes"]) => Effect.Effect<void>;
    readonly end: (session: string) => Effect.Effect<void>;
    readonly setAlerts: (enabled: boolean) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly stop: Effect.Effect<void>;
    readonly run: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peerHub/plugins/needs-you/service/NeedsYou") {}

/** @public The local worker is tested with a clock and transport at its service boundary. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig,
    relay = yield* AgentAwarenessRelay,
    agents = yield* PeerAgents,
    status = yield* PeerStatus,
    clock = yield* Clock.Clock;
  const queue = yield* Queue.dropping<void>(1),
    lock = yield* Semaphore.make(1),
    refusals = new Refusals();
  const publisher = new Publisher(
    fileLedger(config.stateDir),
    (id, value) => Effect.runPromise(relay.publishExternal(id, value)),
    (fields) => Effect.runSync(Effect.logDebug("Needs You alert intent", fields)),
  );
  yield* Effect.tryPromise(() => publisher.load()).pipe(Effect.ignoreCause({ log: true }));
  let latest: PeerHubStatus | undefined,
    delivery: PeerNeedsYouStatus["alerts"]["delivery"] = "not-linked";
  const updateDelivery = relay.publishingState.pipe(
    Effect.map((value) => {
      const next =
        value === "enabled" ? "ready" : value === "disabled" ? "publishing-off" : "not-linked";
      const changed = delivery !== next;
      delivery = next;
      return changed;
    }),
  );
  const read = Effect.sync(() => ({
    alerts: { enabled: publisher.ledger.alerts, delivery },
    staleInputs: refusals.list(clock.currentTimeMillisUnsafe()),
  }));
  const reconcile = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const live = yield* agents.sessions;
    yield* Effect.tryPromise(() =>
      refusals.refresh(now, new Set(live.map((s) => s.id)), (session) =>
        Effect.runPromise(
          agents.staleReads(session).pipe(
            Effect.timeout("2 seconds"),
            Effect.map((value) => value.stale),
          ),
        ),
      ),
    ).pipe(Effect.ignore);
    yield* updateDelivery;
    if (latest)
      yield* Effect.tryPromise(() => publisher.reconcile(latest!, refusals.list(now), now)).pipe(
        Effect.ignoreCause({ log: true }),
      );
    yield* status.publish;
  }).pipe(lock.withPermits(1));
  const run = Effect.gen(function* () {
    yield* relay.externalCatchUp(
      Effect.gen(function* () {
        if (yield* updateDelivery) yield* status.publish;
        return publisher.source();
      }),
    );
    yield* status.changes.pipe(
      Stream.runForEach((snapshot) => {
        latest = snapshot;
        return Queue.offer(queue, undefined);
      }),
      Effect.forkScoped,
    );
    while (true) {
      yield* Queue.take(queue);
      yield* reconcile;
      const now = yield* Clock.currentTimeMillis;
      const wake = latest ? nextWake(latest, [...refusals.entries.values()], now) : null;
      const refusalWake = refusals.nextWake(now);
      const deadline =
        wake === null ? refusalWake : refusalWake === null ? wake : Math.min(wake, refusalWake);
      if (deadline !== null)
        yield* Effect.race(Queue.take(queue), Effect.sleep(Math.max(1, deadline - now))).pipe(
          Effect.andThen(Queue.offer(queue, undefined)),
        );
    }
  });
  return NeedsYou.of({
    read,
    run,
    refuse: (session, scopes) =>
      Effect.sync(() => refusals.record(session, scopes, clock.currentTimeMillisUnsafe())).pipe(
        Effect.andThen(Queue.offer(queue, undefined)),
        Effect.asVoid,
      ),
    end: (session) =>
      Effect.sync(() => refusals.end(session)).pipe(
        Effect.andThen(Queue.offer(queue, undefined)),
        Effect.asVoid,
      ),
    setAlerts: (enabled) =>
      Effect.gen(function* () {
        latest = yield* status.publish;
        yield* Effect.tryPromise({
          try: () => publisher.setAlerts(enabled),
          catch: () => new PeerHubError({ detail: "Could not save the Phone alerts setting." }),
        });
        yield* updateDelivery;
        yield* Effect.tryPromise({
          try: () =>
            publisher.reconcile(
              latest!,
              refusals.list(clock.currentTimeMillisUnsafe()),
              clock.currentTimeMillisUnsafe(),
            ),
          catch: () => new PeerHubError({ detail: "Could not update Phone alerts." }),
        });
        return yield* status.publish;
      }).pipe(lock.withPermits(1)),
    stop: Effect.gen(function* () {
      refusals.clear();
      yield* Effect.tryPromise(() => publisher.setAlerts(false)).pipe(
        Effect.ignoreCause({ log: true }),
      );
      if (latest)
        yield* Effect.tryPromise(() =>
          publisher.reconcile(latest!, [], clock.currentTimeMillisUnsafe()),
        ).pipe(Effect.ignoreCause({ log: true }));
    }).pipe(lock.withPermits(1)),
  });
});
export const layer = Layer.effect(NeedsYou, make);
