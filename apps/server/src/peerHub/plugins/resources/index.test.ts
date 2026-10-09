import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PeerPlugins, startPlugins } from "../../core/plugins/PeerPlugins.ts";
import { coreLayer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { ResourcesPlugin } from "./index.ts";
it.effect(
  "a disabled resource plugin contributes no agent or client surface and refuses its RPC guard",
  () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({
        current: () => [200, { held: [], patterns: {}, at: "2026-10-09T12:00:00Z" }],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), {
          session: "phs_test",
          plugins: [ResourcesPlugin],
        }),
      );
      const state = yield* PeerState.pipe(Effect.provide(core));
      yield* state.updatePersisted((p) => ({ ...p, plugins: { resources: false } }));
      yield* startPlugins.pipe(Effect.provide(core));
      const plugins = yield* PeerPlugins.pipe(Effect.provide(core));
      expect(yield* plugins.active).toEqual([]);
      expect(yield* plugins.contributions).toEqual([]);
      expect(yield* Effect.flip(plugins.requireActive("resources"))).toMatchObject({
        detail: "Resource claims is turned off on this environment.",
      });
      expect(hub.calls.filter((c) => c.url?.includes("/resources"))).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
