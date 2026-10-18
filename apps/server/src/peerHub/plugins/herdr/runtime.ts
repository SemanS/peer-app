/**
 * HerdrRuntime: which herdr serves this computer (the person's own, or Peer's bundled one) and the
 * owner's controls over Peer's. The supervisor runs while the plugin does; the status shows its
 * state; the RPCs turn Peer's herdr off and on, restart it, open a terminal on it and change its
 * integrations. `client/` holds the parts that talk to herdr's process and socket.
 *
 * @module peerHub/plugins/herdr/runtime
 */
import {
  PeerHubError,
  type PeerHerdrOpenTerminalInput,
  type PeerHerdrSetIntegrationInput,
  type PeerHerdrSetRuntimeInput,
  type PeerHerdrStatus,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";

import * as ServerConfig from "../../../config.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { herdrData } from "./client/checkouts.ts";
import { HerdrClient } from "./client/HerdrClient.ts";
import { HerdrProcess } from "./client/HerdrProcess.ts";
import { makeHerdrRuntimeControl } from "./client/runtimeControl.ts";
import type { HerdrRuntimeEvent } from "./client/supervisor.ts";
import { makeHerdrWindows } from "./client/window.ts";

type Change<I = void> = (input: I) => Effect.Effect<PeerHubStatus, PeerHubError>;

export class HerdrRuntime extends Context.Service<
  HerdrRuntime,
  {
    /** The socket every herdr call goes to now. */
    readonly socketPath: () => string;
    /** The `herdr` field of the status; read from memory. */
    readonly status: Effect.Effect<PeerHerdrStatus>;
    /** Why an agent cannot start in herdr now, or null. */
    readonly blocker: Effect.Effect<string | null>;
    /** Supervises Peer's herdr until interrupted (the plugin's background work). */
    readonly run: Effect.Effect<never, never, Scope.Scope>;
    /** Opens a window before an agent is shown when none is attached; the reason it could not. */
    readonly ensureWindow: Effect.Effect<string | undefined>;
    readonly setRuntime: Change<PeerHerdrSetRuntimeInput>;
    readonly restart: Change;
    readonly openTerminal: Change<PeerHerdrOpenTerminalInput>;
    readonly setIntegration: Change<PeerHerdrSetIntegrationInput>;
    /** Stops Peer's herdr when the plugin is turned off and it runs no agents. */
    readonly turnOff: Effect.Effect<void>;
  }
>()("t3/peerHub/plugins/herdr/runtime/HerdrRuntime") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const sessions = yield* PeerAgents.PeerAgents;
  const config = yield* ServerConfig.ServerConfig;
  const port = yield* HerdrProcess;
  const client = yield* HerdrClient;
  const settings = herdrData(state);
  const changed = yield* Queue.dropping<void>(1);
  const events = yield* Queue.unbounded<HerdrRuntimeEvent>();
  const control = makeHerdrRuntimeControl({
    port,
    stateDir: config.stateDir,
    bundled: Option.getOrElse(yield* settings.read, () => ({ bundled: true })).bundled,
    onChange: () => void Queue.offerUnsafe(changed, undefined),
    onEvent: (event) => void Queue.offerUnsafe(events, event),
  });
  const { supervisor } = control;
  const windows = makeHerdrWindows({ port, supervisor, focus: client.focus });

  /** Logs what the supervisor reported since: classes and counts, never content. */
  const flush = Effect.gen(function* () {
    for (const { event, ...fields } of yield* Queue.clear(events))
      yield* sessions.log(`herdr.runtime.${event}`, fields);
  });
  const publish = flush.pipe(Effect.andThen(status.publish));
  /** Publishes the status, or fails saying why the change did not happen. */
  const settled = (failure: string | undefined) =>
    failure === undefined ? publish : Effect.fail(new PeerHubError({ detail: failure }));

  return HerdrRuntime.of({
    socketPath: supervisor.socketPath,
    status: Effect.sync(control.status),
    blocker: Effect.promise(() => control.launchBlocker((socket) => client.list(socket))),
    ensureWindow: windows.ensure,
    setRuntime: ({ on }) =>
      settings
        .update((current) => ({ ...Option.getOrElse(current, () => ({})), bundled: on }))
        .pipe(
          state.lock.withPermits(1),
          Effect.andThen(Effect.promise(() => supervisor.setBundled(on))),
          Effect.andThen(publish),
        ),
    restart: () => Effect.promise(supervisor.restart).pipe(Effect.andThen(publish)),
    openTerminal: ({ paneId }) => windows.open(paneId).pipe(Effect.flatMap(settled)),
    setIntegration: ({ agent, installed }) =>
      Effect.promise(() => control.setIntegration(agent, installed)).pipe(Effect.flatMap(settled)),
    turnOff: Effect.promise(supervisor.stopIfIdle).pipe(Effect.andThen(flush)),
    run: Effect.gen(function* () {
      yield* Queue.take(changed).pipe(Effect.andThen(publish), Effect.forever, Effect.forkScoped);
      yield* Effect.forkScoped(Effect.promise(control.refreshIntegrations));
      while (true) {
        yield* Effect.promise(control.tick);
        yield* Effect.sleep(supervisor.nextDelayMs());
      }
    }),
  });
});

export const layer = Layer.effect(HerdrRuntime, make);
