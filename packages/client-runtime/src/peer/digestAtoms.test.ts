import { EnvironmentId, WS_METHODS, type PeerDigest } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createDigestEnvironmentAtoms } from "./digest.ts";

it.effect("isolates cached personal request digests when the signed-in person changes", () =>
  Effect.gen(function* () {
    const target = new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make("laptop"),
      label: "Laptop",
      httpBaseUrl: "https://environment.test",
      wsBaseUrl: "wss://environment.test",
    });
    let signedIn = "ana",
      calls = 0;
    const inputs: unknown[] = [];
    const bobStarted = yield* Deferred.make<void>();
    const bobResponse = yield* Deferred.make<PeerDigest | null>();
    const response = (person: string): PeerDigest => ({
      project: "app",
      since: "2026-10-09T00:00:00Z",
      until: "2026-10-09T08:00:00Z",
      coverage: { complete: true },
      sections: [
        {
          id: "requests",
          title: "Requests",
          total: 1,
          entries: [
            {
              kind: "request.received",
              at: "2026-10-09T07:00:00Z",
              by: ["cal"],
              subject: `Private request for ${person}`,
            },
          ],
        },
      ],
    });
    const client = {
      [WS_METHODS.peerDigestGet]: (input: unknown) =>
        Effect.gen(function* () {
          calls++;
          inputs.push(input);
          if (signedIn === "bob") {
            yield* Deferred.succeed(bobStarted, undefined);
            return yield* Deferred.await(bobResponse);
          }
          return response(signedIn);
        }),
    } as unknown as WsRpcProtocolClient;
    const session: RpcSession = {
      client,
      initialConfig: Effect.never,
      subscribeServerConfig: (input) => client.subscribeServerConfig(input),
      ready: Effect.void,
      probe: Effect.void,
      closed: Effect.never,
    };
    const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
      target,
      state: yield* SubscriptionRef.make<SupervisorConnectionState>({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        network: "online",
        phase: "connected",
        attempt: 1,
        generation: 1,
      }),
      session: yield* SubscriptionRef.make(Option.some(session)),
      prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    });
    const environments = EnvironmentRegistry.EnvironmentRegistry.of({
      run: (_id, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      followStream: (_id, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
    const registry = AtomRegistry.make();
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
    const atoms = createDigestEnvironmentAtoms(
      Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments)),
    );
    const first = {
      environmentId: target.environmentId,
      person: "ana",
      input: { workspace: "acme", project: "app", since: "8h", revision: 1 },
    };
    const ana = atoms.get(first);
    expect(
      (yield* AtomRegistry.getResult(registry, ana, { suspendOnWaiting: true }))?.sections[0]
        ?.entries[0]?.subject,
    ).toBe("Private request for ana");
    signedIn = "bob";
    const bob = atoms.get({ ...first, person: "bob" });
    expect(bob).not.toBe(ana);
    const unmount = registry.mount(bob);
    yield* Effect.addFinalizer(() => Effect.sync(unmount));
    yield* Deferred.await(bobStarted);
    expect(AsyncResult.value(registry.get(bob))).toEqual(Option.none());
    yield* Deferred.succeed(bobResponse, response("bob"));
    expect(
      (yield* AtomRegistry.getResult(registry, bob, { suspendOnWaiting: true }))?.sections[0]
        ?.entries[0]?.subject,
    ).toBe("Private request for bob");
    expect(calls).toBe(2);
    expect(inputs).toEqual([
      { workspace: "acme", project: "app", since: "8h" },
      { workspace: "acme", project: "app", since: "8h" },
    ]);
  }).pipe(Effect.scoped),
);
