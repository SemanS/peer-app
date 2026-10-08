import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentAuthorizationError,
  PeerCoreRpcGroup,
  PeerHubError,
  WsPeerMemoryRpcGroup,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import type { PeerContributions, PeerRpcWrap } from "./core/plugin.ts";
import * as PeerPlugins from "./core/plugins/PeerPlugins.ts";
import * as PeerHub from "./PeerHub.ts";

/** A plugin method, as a plugin's own contract file declares one. */
const PingRpc = Rpc.make("peer.find.ping", {
  payload: Schema.Struct({}),
  success: Schema.String,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const FindRpcGroup = RpcGroup.make(PingRpc);
const AllRpcs = PeerCoreRpcGroup.merge(WsPeerMemoryRpcGroup).merge(FindRpcGroup);

const status = { signedIn: false } as unknown as PeerHubStatus;

/** Peer's RPC handlers over a facade that only turns plugins on and off, and the find plugin. */
const serving = (active: { current: boolean }) => {
  const traced: Array<string> = [];
  let pinged = 0;
  const wrap: PeerRpcWrap = {
    effect: (method, effect, attributes) => {
      traced.push(`${method} ${JSON.stringify(attributes)}`);
      return effect;
    },
    stream: (method, stream, attributes) => {
      traced.push(`${method} ${JSON.stringify(attributes)}`);
      return stream;
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
  const handlers = PeerHub.rpcLayer(wrap) as Layer.Layer<
    Rpc.ToHandler<RpcGroup.Rpcs<typeof AllRpcs>>,
    never,
    PeerHub.PeerHub | PeerPlugins.PeerPlugins
  >;
  const layer = handlers.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(PeerHub.PeerHub)({ setPlugin: () => Effect.succeed(status) }),
        Layer.mock(PeerPlugins.PeerPlugins)({
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
});
