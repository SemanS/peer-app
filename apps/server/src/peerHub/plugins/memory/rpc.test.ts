import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import {
  coreLayer,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import * as PeerHub from "../../PeerHub.ts";
import { makeMemoryPlugin } from "./index.ts";

/** ws.ts's wrappers as tests need them: no authorization, no tracing. */
const wrap: PeerRpcWrap = {
  effect: (_method, effect) => effect,
  stream: (_method, stream) => stream,
};

/** Ana's Peer signed in to `hub`, with memory in the build when `available`, and its RPC client. */
const anaServing = (hub: { readonly url: string }, available: boolean) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: [makeMemoryPlugin({ available })],
      }),
    );
    const { plugins, client } = yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      return {
        plugins: yield* PeerPlugins.PeerPlugins,
        client: yield* PeerHubClient.PeerHubClient,
      };
    }).pipe(Effect.provide(core));
    const handlers = PeerHub.rpcLayer(wrap).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(PeerHub.PeerHub)({}),
          Layer.succeed(PeerPlugins.PeerPlugins, plugins),
        ),
      ),
    );
    const rpc = yield* RpcTest.makeClient(PeerRpcGroup).pipe(Effect.provide(handlers));
    return { plugins, client, rpc };
  });

const refusal = <A, E extends { readonly message: string }>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.message : null)),
  );

const SCOPE = { workspace: "acme", project: "app" };

describe("memory's RPCs", () => {
  it.effect("are refused while memory is off, and while the Hub was built without it", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = { current: () => [200, meAnswer()] };
      const hub = yield* standInHub(answer);
      const ana = yield* anaServing(hub, true);
      assert.strictEqual(
        yield* refusal(ana.rpc["peerHub.memoryQueue"](SCOPE)),
        "Peer Memory is turned off on this environment.",
      );
      yield* ana.plugins.setPlugin({ id: "memory", enabled: true });
      answer.current = () => [200, meAnswer({ requests: 1, observe: 1, knowledge: 1 })];
      yield* ana.client.me;
      assert.strictEqual(
        yield* refusal(ana.rpc["peerHub.memorySearch"]({ ...SCOPE, search: { contextIds: [] } })),
        "This Peer Hub was built without Memory.",
      );
      assert.isFalse(hub.calls.some((call) => call.url?.includes("/memory") === true));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("read this computer's queue while memory is on", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, meAnswer()] });
      const ana = yield* anaServing(hub, true);
      yield* ana.plugins.setPlugin({ id: "memory", enabled: true });
      assert.deepStrictEqual(yield* ana.rpc["peerHub.memoryQueue"](SCOPE), { operations: [] });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("are answered, not lost, by a build without memory", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, meAnswer()] });
      const ana = yield* anaServing(hub, false);
      assert.strictEqual(
        yield* refusal(ana.rpc["peerHub.memoryState"](SCOPE)),
        "There is no Peer plugin for peerHub.memoryState on this environment.",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
