// @effect-diagnostics nodeBuiltinImport:off - a stand-in Hub on a local port; PEER_OWNERSHIP is read from the environment.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import {
  coreLayer,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { OwnershipPlugin } from "./index.ts";

/** Core signed in to a stand-in Hub that answers `answer`, with the ownership plugin registered. */
const ownershipCore = (answer: { current: HubAnswer }) =>
  Effect.gen(function* () {
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: [OwnershipPlugin],
      }),
    );
    return yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      return {
        plugins: yield* PeerPlugins.PeerPlugins,
        client: yield* PeerHubClient.PeerHubClient,
      };
    }).pipe(Effect.provide(core));
  });

const state = (core: Effect.Success<ReturnType<typeof ownershipCore>>) =>
  core.plugins.states.pipe(Effect.map((states) => states.find(({ id }) => id === "ownership")));

const refusal = <A>(effect: Effect.Effect<A, PeerHubError>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.detail : null)),
  );

/** `PEER_OWNERSHIP` set to `value` (unset when undefined) while `effect` runs. */
const withEnvironment = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const before = process.env.PEER_OWNERSHIP;
      if (value === undefined) delete process.env.PEER_OWNERSHIP;
      else process.env.PEER_OWNERSHIP = value;
      return before;
    }),
    () => effect,
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env.PEER_OWNERSHIP;
        else process.env.PEER_OWNERSHIP = before;
      }),
  );

describe("the ownership plugin", () => {
  it("is defined as the Settings row of the design says, and needs the Hub's ownership feature", () => {
    assert.strictEqual(OwnershipPlugin.id, "ownership");
    assert.strictEqual(OwnershipPlugin.title, "Ownership");
    assert.strictEqual(
      OwnershipPlugin.summary,
      "Who owns each task and path. Owners hear about changes in their paths and decide them where they ask to.",
    );
    assert.isTrue(OwnershipPlugin.defaultEnabled);
    assert.deepStrictEqual(OwnershipPlugin.hubFeature, { id: "ownership", revision: 1 });
  });

  it.effect("is active where the Hub serves ownership, and says why where it does not", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = { current: () => [200, meAnswer()] };
        const core = yield* ownershipCore(answer);
        // No Hub answered yet: the plugin waits for one, it does not need a newer one.
        assert.strictEqual((yield* state(core))?.reason, "hub-unknown");
        assert.isFalse(yield* core.plugins.isActive("ownership"));

        answer.current = () => [200, meAnswer({ requests: 1, ownership: 1 })];
        yield* core.client.me;
        assert.deepStrictEqual(yield* state(core), {
          id: "ownership",
          title: "Ownership",
          enabled: true,
          active: true,
        });

        // An older Hub lists no such feature: reviews stay in every member's Needs you, no owners show.
        answer.current = () => [200, meAnswer({ requests: 1 })];
        yield* core.client.me;
        assert.deepStrictEqual(yield* state(core), {
          id: "ownership",
          title: "Ownership",
          enabled: true,
          active: false,
          reason: "hub",
        });
        assert.strictEqual(
          yield* refusal(core.plugins.requireActive("ownership")),
          "Ownership needs a newer Peer Hub.",
        );

        // Its operator turned it off: the Hub lists it as off, and does not serve it.
        answer.current = () => [200, meAnswer({ requests: 1 }, { featuresOff: ["ownership"] })];
        yield* core.client.me;
        assert.isFalse(yield* core.plugins.isActive("ownership"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("is turned off by its owner, and the choice survives the Hub serving the feature", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = {
          current: () => [200, meAnswer({ ownership: 1 })],
        };
        const core = yield* ownershipCore(answer);
        yield* core.client.me;
        assert.isTrue(yield* core.plugins.isActive("ownership"));
        yield* core.plugins.setPlugin({ id: "ownership", enabled: false });
        assert.deepStrictEqual(yield* state(core), {
          id: "ownership",
          title: "Ownership",
          enabled: false,
          active: false,
          reason: "off",
        });
        assert.strictEqual(
          yield* refusal(core.plugins.requireActive("ownership")),
          "Ownership is turned off on this environment.",
        );
        yield* core.plugins.setPlugin({ id: "ownership", enabled: true });
        assert.isTrue(yield* core.plugins.isActive("ownership"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("is forced off by PEER_OWNERSHIP=off, and the switch cannot turn it on", () =>
    withEnvironment(
      "off",
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = {
          current: () => [200, meAnswer({ ownership: 1 })],
        };
        const core = yield* ownershipCore(answer);
        yield* core.client.me;
        assert.deepStrictEqual(yield* state(core), {
          id: "ownership",
          title: "Ownership",
          enabled: false,
          active: false,
          reason: "PEER_OWNERSHIP=off",
          locked: true,
        });
        assert.include(
          (yield* refusal(core.plugins.setPlugin({ id: "ownership", enabled: true })))!,
          "PEER_OWNERSHIP=off",
        );
        assert.isFalse(yield* core.plugins.isActive("ownership"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("reads PEER_OWNERSHIP each time, and any value but off leaves the plugin on", () =>
    withEnvironment(
      "on",
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = {
          current: () => [200, meAnswer({ ownership: 1 })],
        };
        const core = yield* ownershipCore(answer);
        yield* core.client.me;
        assert.isTrue(yield* core.plugins.isActive("ownership"));
        process.env.PEER_OWNERSHIP = "off";
        assert.strictEqual((yield* state(core))?.locked, true);
        delete process.env.PEER_OWNERSHIP;
        assert.isTrue(yield* core.plugins.isActive("ownership"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );
});
