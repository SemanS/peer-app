import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry, Atom } from "effect/reactivity";
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
import { createPeerSettingsAtoms } from "./settings.ts";

/** The settings atoms on an environment whose RPC client is `client`. */
const atomsOn = (client: Record<string, (input: unknown) => Effect.Effect<unknown>>) =>
  Effect.gen(function* () {
    const target = new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make("laptop"),
      label: "Laptop",
      httpBaseUrl: "https://environment.test",
      wsBaseUrl: "wss://environment.test",
    });
    const session: RpcSession = {
      client: client as unknown as WsRpcProtocolClient,
      initialConfig: Effect.never,
      subscribeServerConfig: () => Stream.never,
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
    const atoms = createPeerSettingsAtoms(
      Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments)),
    );
    return { atoms, registry, environmentId: target.environmentId };
  });

const view = (name: string) => ({
  revision: {
    seq: 42,
    commit: "3f2a",
    at: "x",
    by: { email: "eva@acme.dev", name: "Eva" },
    message: "m",
  },
  rights: { admin: false, owner: false, leads: [] },
  document: { projects: { booking: { name } } },
  features: { pathRules: true, webhooks: true, github: true },
  people: [],
});

it.effect("reads each person's settings on their own, and never sends who is asking", () =>
  Effect.gen(function* () {
    let signedIn = "ana";
    const inputs: unknown[] = [];
    const { atoms, registry, environmentId } = yield* atomsOn({
      [WS_METHODS.peerSettingsGet]: (input) =>
        Effect.sync(() => {
          inputs.push(input);
          return view(`Booking for ${signedIn}`);
        }),
    });
    const ask = (person: string, revision: number) =>
      atoms.view({ environmentId, person, input: { workspace: "acme", revision } });
    const named = (atom: ReturnType<typeof ask>) =>
      AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
        Effect.map((read) => {
          const projects = read?.document.projects as { booking?: { name?: string } } | undefined;
          return projects?.booking?.name;
        }),
      );
    expect(yield* named(ask("ana", 42))).toBe("Booking for ana");
    // The same person at the same revision has what was read; another person has nothing of it.
    expect(ask("ana", 42)).toBe(ask("ana", 42));
    expect(ask("bob", 42)).not.toBe(ask("ana", 42));
    signedIn = "bob";
    expect(yield* named(ask("bob", 42))).toBe("Booking for bob");
    // A newer revision, which `status.settings` names, reads again.
    expect(ask("ana", 43)).not.toBe(ask("ana", 42));
    expect(yield* named(ask("ana", 43))).toBe("Booking for bob");
    expect(inputs).toEqual([
      { workspace: "acme", revision: 42 },
      { workspace: "acme", revision: 42 },
      { workspace: "acme", revision: 43 },
    ]);
  }).pipe(Effect.scoped),
);

it.effect("runs a write with the method it is named for, and a save after the one before it", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const first = yield* Deferred.make<void>();
    const { atoms, registry, environmentId } = yield* atomsOn({
      [WS_METHODS.peerSettingsSave]: (input) =>
        Effect.gen(function* () {
          const message = (input as { message: string }).message;
          calls.push(`start ${message}`);
          if (message === "one") yield* Deferred.await(first);
          calls.push(`end ${message}`);
          return { kind: "saved", message };
        }),
      [WS_METHODS.peerSettingsPutSecret]: (input) =>
        Effect.sync(() => {
          calls.push(`secret ${(input as { name: string }).name}`);
          return {};
        }),
    });
    const base = { workspace: "acme", base: 42, set: [] } as const;
    const save = (message: string, workspace = "acme") =>
      atoms.save.run(registry, { environmentId, input: { ...base, workspace, message } });
    const one = save("one");
    const two = save("two");
    // Another workspace's save, and a secret, do not wait for them.
    const elsewhere = yield* Effect.promise(() => save("other", "camp"));
    expect(elsewhere._tag).toBe("Success");
    const stored = yield* Effect.promise(() =>
      atoms.putSecret.run(registry, {
        environmentId,
        input: { workspace: "acme", name: "TEAMS_ALERTS_URL", value: "https://x.test" },
      }),
    );
    expect(stored._tag).toBe("Success");
    expect(calls).toEqual(["start one", "start other", "end other", "secret TEAMS_ALERTS_URL"]);
    yield* Deferred.succeed(first, undefined);
    expect((yield* Effect.promise(() => one))._tag).toBe("Success");
    expect((yield* Effect.promise(() => two))._tag).toBe("Success");
    expect(calls.slice(4)).toEqual(["end one", "start two", "end two"]);
  }).pipe(Effect.scoped),
);
