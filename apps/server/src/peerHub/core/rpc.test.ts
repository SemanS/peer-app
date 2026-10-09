import { assert, describe, it } from "@effect/vitest";
import {
  AuthAccessWriteScope,
  EnvironmentAuthorizationError,
  HerdrRpcGroup,
  PeerCoreRpcGroup,
  PeerHubError,
  MemoryRpcGroup,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import type { PeerContributions, PeerRpcWrap } from "./plugin.ts";
import * as PeerPlugins from "./plugins/PeerPlugins.ts";
import * as PeerRpc from "./rpc.ts";
import * as PeerStatus from "./status/PeerStatus.ts";
import { coreRpcStandIns } from "./testkit.ts";

/** A plugin method, as a plugin's own contract file declares one. */
const PingRpc = Rpc.make("peer.find.ping", {
  payload: Schema.Struct({}),
  success: Schema.String,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const FindRpcGroup = RpcGroup.make(PingRpc);
const AllRpcs = PeerCoreRpcGroup.merge(MemoryRpcGroup).merge(HerdrRpcGroup).merge(FindRpcGroup);

const status = { signedIn: false } as unknown as PeerHubStatus;

/**
 * Peer's RPC handlers over a core that only turns plugins on and off and publishes the status, and
 * the find plugin. The wrappers trace each method, and refuse those in `unauthorized` as ws.ts does
 * a caller without their scope.
 */
const serving = (active: { current: boolean }, unauthorized: ReadonlySet<string> = new Set()) => {
  const traced: Array<string> = [];
  let pinged = 0;
  const noScope = new EnvironmentAuthorizationError({
    message: "This session cannot call the method.",
    requiredScope: AuthAccessWriteScope,
  });
  const wrap: PeerRpcWrap = {
    effect: (method, effect, attributes) => {
      traced.push(`${method} ${JSON.stringify(attributes)}`);
      return unauthorized.has(method) ? Effect.fail(noScope) : effect;
    },
    stream: (method, stream, attributes) => {
      traced.push(`${method} ${JSON.stringify(attributes)}`);
      return unauthorized.has(method) ? Stream.fail(noScope) : stream;
    },
  };
  const find: PeerContributions = {
    rpc: {
      group: FindRpcGroup,
      handlers: (pluginWrap) =>
        FindRpcGroup.of({
          "peer.find.ping": () =>
            pluginWrap.effect(
              "peer.find.ping",
              Effect.sync(() => {
                pinged += 1;
                return "pong";
              }),
            ),
        }),
    },
  };
  // The find plugin's handler comes from its contributions at runtime; its group is a test's own,
  // so the static type of Peer's handlers does not list it.
  const handlers = PeerRpc.layer(wrap) as Layer.Layer<
    Rpc.ToHandler<RpcGroup.Rpcs<typeof AllRpcs>>,
    never,
    PeerRpc.PeerRpcServices
  >;
  const layer = handlers.pipe(
    Layer.provide(
      Layer.mergeAll(
        coreRpcStandIns,
        // A later layer's service replaces the stand-in's.
        Layer.mock(PeerStatus.PeerStatus)({ publish: Effect.succeed(status) }),
        Layer.mock(PeerPlugins.PeerPlugins)({
          setPlugin: () => Effect.void,
          built: Effect.succeed([
            {
              state: { id: "find", title: "Find", enabled: active.current, active: active.current },
              contributions: find,
            },
          ]),
          requireActive: () =>
            active.current
              ? Effect.void
              : Effect.fail(
                  new PeerHubError({ detail: "Find is turned off on this environment." }),
                ),
        }),
      ),
    ),
  );
  return { layer, traced, pinged: () => pinged };
};

describe("Peer's RPC handlers", () => {
  it.effect("serve core's methods through ws.ts's wrappers, traced as Peer's", () => {
    const served = serving({ current: true });
    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AllRpcs);
      assert.strictEqual(
        yield* client["peerHub.setPlugin"]({ id: "find", enabled: false }),
        status,
      );
      assert.deepStrictEqual(served.traced, ['peerHub.setPlugin {"rpc.aggregate":"peerHub"}']);
    }).pipe(Effect.scoped, Effect.provide(served.layer));
  });

  it.effect("run an active plugin's method, and refuse it while the plugin is inactive", () => {
    const active = { current: true };
    const served = serving(active);
    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AllRpcs);
      assert.strictEqual(yield* client["peer.find.ping"]({}), "pong");
      active.current = false;
      const refused = yield* client["peer.find.ping"]({}).pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused));
      if (Result.isFailure(refused)) {
        assert.strictEqual(refused.failure.message, "Find is turned off on this environment.");
      }
      // Refused before anything ran.
      assert.strictEqual(served.pinged(), 1);
    }).pipe(Effect.scoped, Effect.provide(served.layer));
  });

  it.effect(
    "refuse the methods of a plugin this build leaves out, through the same wrappers",
    () => {
      const served = serving({ current: true }, new Set(["peerHub.memoryQueue"]));
      return Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(AllRpcs);
        const scope = { workspace: "acme", project: "app" };
        assert.strictEqual(
          (yield* client["peerHub.memoryState"](scope).pipe(Effect.flip)).message,
          "There is no Peer plugin for peerHub.memoryState on this environment.",
        );
        assert.strictEqual(
          (yield* client["peerHub.watchAgent"]({ agentId: "agent-1" }).pipe(
            Stream.runCollect,
            Effect.flip,
          )).message,
          "There is no Peer plugin for peerHub.watchAgent on this environment.",
        );
        // A caller without the method's scope hears that, not whether the build has the plugin.
        assert.strictEqual(
          (yield* client["peerHub.memoryQueue"](scope).pipe(Effect.flip))._tag,
          "EnvironmentAuthorizationError",
        );
        assert.deepStrictEqual(served.traced, [
          'peerHub.memoryState {"rpc.aggregate":"peerHub"}',
          'peerHub.watchAgent {"rpc.aggregate":"peerHub"}',
          'peerHub.memoryQueue {"rpc.aggregate":"peerHub"}',
        ]);
      }).pipe(Effect.scoped, Effect.provide(served.layer));
    },
  );
});
