import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_PLUGIN_IDS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { peerPlugins } from "../../core/registry.ts";
import { coreLayer, meAnswer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import { PlansPlugin } from "./index.ts";

const coordination = {
  enabled: false,
  policy: "coordinate" as const,
  claudeHooks: false,
  logPath: "",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

/** Core on a stand-in Hub whose `/v1/me` lists `features`, running only the plans plugin. */
const environment = (features: Readonly<Record<string, number>>) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({
      current: (url) => (url === "/v1/me" ? [200, meAnswer(features)] : [200, {}]),
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "s", plugins: [PlansPlugin] }),
    );
    const client = yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core));
    const plugins = yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
      return yield* PeerPlugins.PeerPlugins;
    }).pipe(Effect.provide(core));
    const state = plugins.states.pipe(
      Effect.map((all) => all.find((plugin) => plugin.id === "plans")),
    );
    return { client, plugins, state };
  });

const withEnv = <A, E, R>(name: string, value: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const before = process.env[name];
      process.env[name] = value;
      return before;
    }),
    () => effect,
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env[name];
        else process.env[name] = before;
      }),
  );

describe("the plans plugin definition", () => {
  it("is listed once, in the contracts' order, just before settings", () => {
    const listed = peerPlugins().map((entry) => entry.id);
    assert.deepStrictEqual(listed, [...PEER_PLUGIN_IDS]);
    assert.strictEqual(listed.indexOf("plans") + 1, listed.indexOf("settings"));
  });

  it("is named and summarized as the design says, on by default, and needs the Hub's plans", () => {
    assert.strictEqual(PlansPlugin.id, "plans");
    assert.strictEqual(PlansPlugin.title, "Plans");
    assert.strictEqual(
      PlansPlugin.summary,
      "Before editing, agents say what they will change, use and provide; Peer says whose work meets theirs.",
    );
    assert.isTrue(PlansPlugin.defaultEnabled);
    assert.deepStrictEqual(PlansPlugin.commandNames, ["plan"]);
    assert.deepStrictEqual(PlansPlugin.hubFeature, { id: "plans", revision: 1 });
    assert.isUndefined(PlansPlugin.forcedOff?.());
  });

  it.effect("is forced off by PEER_PLANS=off, and by nothing else", () =>
    withEnv(
      "PEER_PLANS",
      "off",
      Effect.sync(() => assert.strictEqual(PlansPlugin.forcedOff?.(), "PEER_PLANS=off")),
    ).pipe(
      Effect.andThen(
        withEnv(
          "PEER_PLANS",
          "on",
          Effect.sync(() => assert.isUndefined(PlansPlugin.forcedOff?.())),
        ),
      ),
    ),
  );
});

describe("the plans plugin in an environment", () => {
  it.effect("waits for a Hub that serves plans, and then runs until its owner turns it off", () =>
    Effect.gen(function* () {
      const older = yield* environment({ impact: 1 });
      yield* older.client.me;
      assert.deepStrictEqual(yield* older.state, {
        id: "plans",
        title: "Plans",
        enabled: true,
        active: false,
        reason: "hub",
      });
      assert.isEmpty(yield* older.plugins.active);

      const current = yield* environment({ plans: 1 });
      yield* current.client.me;
      assert.isTrue(yield* current.plugins.isActive("plans"));
      const [active] = yield* current.plugins.active;
      assert.strictEqual(active?.contributions.commands?.[0]?.name, "plan");

      yield* current.plugins.setPlugin({ id: "plans", enabled: false });
      assert.isFalse(yield* current.plugins.isActive("plans"));
      assert.strictEqual((yield* current.state)?.reason, "off");
      assert.isEmpty(yield* current.plugins.active);
      const refusal = yield* current.plugins.requireActive("plans").pipe(Effect.result);
      assert.isTrue(Result.isFailure(refusal));

      yield* current.plugins.setPlugin({ id: "plans", enabled: true });
      assert.isTrue(yield* current.plugins.isActive("plans"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is locked off by PEER_PLANS=off: visible, and no choice turns it on", () =>
    withEnv(
      "PEER_PLANS",
      "off",
      Effect.gen(function* () {
        const forced = yield* environment({ plans: 1 });
        yield* forced.client.me;
        assert.deepStrictEqual(yield* forced.state, {
          id: "plans",
          title: "Plans",
          enabled: false,
          active: false,
          reason: "PEER_PLANS=off",
          locked: true,
        });
        const turnedOn = yield* forced.plugins
          .setPlugin({ id: "plans", enabled: true })
          .pipe(Effect.result);
        assert.isTrue(Result.isFailure(turnedOn));
        assert.isFalse(yield* forced.plugins.isActive("plans"));
      }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
