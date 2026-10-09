import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerPluginEntry } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import { peerPlugins, validatePlugins } from "../../core/registry.ts";
import {
  coreLayer,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { MemoryPlugin, makeMemoryPlugin } from "./index.ts";

/** Core on `baseDir` with `plugins` registered and started, for as long as the test's scope. */
const startedCore = (baseDir: string, plugins: ReadonlyArray<PeerPluginEntry>, session?: string) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(baseDir, { plugins, ...(session === undefined ? {} : { session }) }),
    );
    return yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      return {
        plugins: yield* PeerPlugins.PeerPlugins,
        client: yield* PeerHubClient.PeerHubClient,
      };
    }).pipe(Effect.provide(core));
  });

const refusal = (effect: Effect.Effect<void, PeerHubError>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.detail : null)),
  );

describe("the memory plugin", () => {
  it("is listed last in this build's registry, and the registry stays valid", () => {
    assert.strictEqual(peerPlugins().at(-1), MemoryPlugin);
    assert.deepStrictEqual(validatePlugins(peerPlugins()), []);
  });

  it.effect("is not in the catalog of a build without memory", () =>
    Effect.gen(function* () {
      const core = yield* startedCore(yield* seedState(), [makeMemoryPlugin({ available: false })]);
      assert.deepStrictEqual(yield* core.plugins.states, []);
      // Nothing of it was built.
      assert.deepStrictEqual(yield* core.plugins.built, []);
      assert.strictEqual(
        yield* refusal(core.plugins.requireActive("memory")),
        'There is no Peer plugin "memory" on this environment.',
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is off until its owner turns it on, and the choice outlives a restart", () =>
    Effect.gen(function* () {
      const baseDir = yield* seedState();
      const first = yield* startedCore(baseDir, [makeMemoryPlugin({ available: true })]);
      assert.deepStrictEqual(yield* first.plugins.states, [
        { id: "memory", title: "Peer Memory", enabled: false, active: false, reason: "off" },
      ]);
      assert.strictEqual(
        yield* refusal(first.plugins.requireActive("memory")),
        "Peer Memory is turned off on this environment.",
      );
      yield* first.plugins.setPlugin({ id: "memory", enabled: true });
      // Signed out, no Hub has said what it serves: the Hub from before the catalog serves memory.
      assert.isTrue(yield* first.plugins.isActive("memory"));

      const restarted = yield* startedCore(baseDir, [makeMemoryPlugin({ available: true })]);
      assert.deepStrictEqual(yield* restarted.plugins.states, [
        { id: "memory", title: "Peer Memory", enabled: true, active: true },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is inactive while the signed-in Hub's catalog has no memory", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = { current: () => [200, meAnswer()] };
      const hub = yield* standInHub(answer);
      const core = yield* startedCore(
        yield* seedState(signedInSeed(hub.url)),
        [makeMemoryPlugin({ available: true })],
        "phs_test",
      );
      yield* core.plugins.setPlugin({ id: "memory", enabled: true });
      // A Hub without a catalog counts as serving it.
      yield* core.client.me;
      assert.isTrue(yield* core.plugins.isActive("memory"));

      answer.current = () => [200, meAnswer({ requests: 1, observe: 1, knowledge: 1 })];
      yield* core.client.me;
      assert.deepStrictEqual(yield* core.plugins.states, [
        { id: "memory", title: "Peer Memory", enabled: true, active: false, reason: "hub" },
      ]);

      answer.current = () => [200, meAnswer({ knowledge: 1, memory: 1 })];
      yield* core.client.me;
      assert.isTrue(yield* core.plugins.isActive("memory"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
