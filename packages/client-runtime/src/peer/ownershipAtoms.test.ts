import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry, Atom } from "effect/unstable/reactivity";
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
import { createPeerPluginAtoms } from "./atoms.ts";
import { createOwnershipEnvironmentAtoms } from "./ownership.ts";

/** The ownership atoms on an environment whose RPC client is `client`. */
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
    const runtime = Atom.runtime(
      Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
    );
    return {
      atoms: createOwnershipEnvironmentAtoms(runtime),
      all: createPeerPluginAtoms(runtime),
      registry,
      environmentId: target.environmentId,
    };
  });

const call = {
  id: "oc-1",
  project: "ordering",
  session: "claude:b1",
  email: "bob@acme.test",
  environment: "bob-laptop",
  owner: "ana@acme.test",
  paths: ["src/payments/fees.ts"],
  reason: "add a refund fee field",
  state: "accepted",
  decidedBy: "ana@acme.test",
  onBehalf: false,
  note: "keep fees in integer cents",
  createdAt: "2026-10-12T20:20:00Z",
  updatedAt: "2026-10-12T20:40:00Z",
  expiresAt: "2026-10-19T20:20:00Z",
};
const map = { version: 8, areas: { Payments: "ana@acme.test" }, paths: {}, decide: [] };

it.effect("reads the Hub's view with the workspace it is asked for", () =>
  Effect.gen(function* () {
    const inputs: unknown[] = [];
    const { atoms, registry, environmentId } = yield* atomsOn({
      [WS_METHODS.peerOwnershipList]: (input) =>
        Effect.sync(() => {
          inputs.push(input);
          return { projects: {}, at: "2026-10-12T21:00:00Z" };
        }),
    });
    const read = yield* AtomRegistry.getResult(
      registry,
      atoms.list({ environmentId, input: { workspace: "acme", project: "ordering" } }),
      { suspendOnWaiting: true },
    );
    expect(read).toEqual({ projects: {}, at: "2026-10-12T21:00:00Z" });
    expect(inputs).toEqual([{ workspace: "acme", project: "ordering" }]);
  }).pipe(Effect.scoped),
);

it.effect("runs each change with the method it is named for, and hands back the Hub's answer", () =>
  Effect.gen(function* () {
    const calls: Array<readonly [string, unknown]> = [];
    const answer = (method: string, result: unknown) => (input: unknown) =>
      Effect.sync(() => {
        calls.push([method, input]);
        return result;
      });
    const { atoms, registry, environmentId } = yield* atomsOn({
      [WS_METHODS.peerOwnershipSetTaskOwner]: answer("setTaskOwner", {
        task: "ord-14",
        owner: null,
        changed: true,
      }),
      [WS_METHODS.peerOwnershipSetMap]: answer("setMap", { kind: "conflict", map }),
      [WS_METHODS.peerOwnershipDecide]: answer("decide", { call }),
      [WS_METHODS.peerOwnershipWithdraw]: answer("withdraw", {
        call: { ...call, state: "withdrawn" },
      }),
    });
    const run = <A>(started: Promise<A>) => Effect.promise(() => started);
    const base = { workspace: "acme", project: "ordering" };
    const owner = yield* run(
      atoms.setTaskOwner.run(registry, {
        environmentId,
        input: { ...base, task: "ord-14", owner: null },
      }),
    );
    const saved = yield* run(
      atoms.setMap.run(registry, {
        environmentId,
        input: { ...base, version: 7, areas: {}, paths: {}, decide: [] },
      }),
    );
    const decided = yield* run(
      atoms.decide.run(registry, {
        environmentId,
        input: { ...base, id: "oc-1", decision: "accept", note: "keep fees in integer cents" },
      }),
    );
    const withdrawn = yield* run(
      atoms.withdraw.run(registry, { environmentId, input: { ...base, id: "oc-1" } }),
    );
    expect([owner._tag, saved._tag, decided._tag, withdrawn._tag]).toEqual([
      "Success",
      "Success",
      "Success",
      "Success",
    ]);
    // A save that someone else's came before is a result, not a failure: the editor keeps its draft.
    expect(saved._tag === "Success" ? saved.value : null).toEqual({ kind: "conflict", map });
    expect(calls.map(([method]) => method)).toEqual([
      "setTaskOwner",
      "setMap",
      "decide",
      "withdraw",
    ]);
    expect(calls[2]?.[1]).toEqual({
      ...base,
      id: "oc-1",
      decision: "accept",
      note: "keep fees in integer cents",
    });
  }).pipe(Effect.scoped),
);

it.effect("is among the plugins' atoms the apps reach through the server's", () =>
  Effect.gen(function* () {
    const { all } = yield* atomsOn({});
    expect(Object.keys(all.peerOwnership).toSorted()).toEqual([
      "decide",
      "list",
      "setMap",
      "setTaskOwner",
      "withdraw",
    ]);
  }).pipe(Effect.scoped),
);
