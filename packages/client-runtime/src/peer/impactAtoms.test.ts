import { EnvironmentId, WS_METHODS, type PeerImpactView } from "@t3tools/contracts";
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
import { createPeerImpactAtoms } from "./impact.ts";

it.effect(
  "isolates cached authorized impact views when the person or project membership changes at the same revision",
  () =>
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
      const bobResponse = yield* Deferred.make<PeerImpactView>();
      const afterRemovalStarted = yield* Deferred.make<void>();
      const afterRemovalResponse = yield* Deferred.make<PeerImpactView>();
      const response = (person: string): PeerImpactView => ({
        records: [],
        provided: [
          {
            project: "app",
            name: `private-${person}`,
            path: "money.ts",
            side: { session: person, email: person, environment: "one", label: person },
            change: "signature",
            rev: 1,
            changedAt: "now",
          },
        ],
      });
      const client = {
        [WS_METHODS.peerImpactList]: (input: unknown) =>
          Effect.gen(function* () {
            calls++;
            inputs.push(input);
            if (calls === 3) {
              yield* Deferred.succeed(afterRemovalStarted, undefined);
              return yield* Deferred.await(afterRemovalResponse);
            }
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
      const atoms = createPeerImpactAtoms(
        Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments)),
      );
      const first = {
        environmentId: target.environmentId,
        person: "ana",
        projectIds: ["app", "other"],
        input: { workspace: "acme", revision: 1 },
      };
      const ana = atoms.peerImpactList(first);
      expect(
        (yield* AtomRegistry.getResult(registry, ana, { suspendOnWaiting: true }))?.provided[0]
          ?.name,
      ).toBe("private-ana");
      signedIn = "bob";
      const bob = atoms.peerImpactList({ ...first, person: "bob" });
      expect(bob).not.toBe(ana);
      const unmount = registry.mount(bob);
      yield* Effect.addFinalizer(() => Effect.sync(unmount));
      yield* Deferred.await(bobStarted);
      expect(AsyncResult.value(registry.get(bob))).toEqual(Option.none());
      yield* Deferred.succeed(bobResponse, response("bob"));
      expect(
        (yield* AtomRegistry.getResult(registry, bob, { suspendOnWaiting: true }))?.provided[0]
          ?.name,
      ).toBe("private-bob");
      const removed = atoms.peerImpactList({ ...first, person: "bob", projectIds: ["other"] });
      expect(removed).not.toBe(bob);
      const releaseRemoved = registry.mount(removed);
      yield* Effect.addFinalizer(() => Effect.sync(releaseRemoved));
      yield* Deferred.await(afterRemovalStarted);
      expect(AsyncResult.value(registry.get(removed))).toEqual(Option.none());
      // An old server response must not restore the project the current manifest removed.
      yield* Deferred.succeed(afterRemovalResponse, response("bob"));
      expect(yield* AtomRegistry.getResult(registry, removed, { suspendOnWaiting: true })).toEqual({
        records: [],
        provided: [],
      });
      expect(calls).toBe(3);
      expect(inputs).toEqual([{ workspace: "acme" }, { workspace: "acme" }, { workspace: "acme" }]);
    }).pipe(Effect.scoped),
);
