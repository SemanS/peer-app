import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerHubError, type PeerPluginId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";

import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { bindPlugin, type PeerPluginInfo } from "../plugin.ts";
import * as PeerState from "../state/PeerState.ts";
import {
  coreLayer,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../testkit.ts";
import * as PeerPlugins from "./PeerPlugins.ts";

/** What a fake plugin's background work and cleanup did, in order. */
type SeenEvent = "started" | "stopped" | "cleaned";
type Seen = Queue.Queue<SeenEvent>;

/** A plugin that only reports its work and its cleanup to `seen`. */
const fakePlugin = (
  info: Partial<PeerPluginInfo> & { readonly id: PeerPluginId },
  seen: Seen,
  cleanup: Effect.Effect<void, PeerHubError> = Queue.offer(seen, "cleaned").pipe(Effect.asVoid),
) =>
  bindPlugin({
    title: `The ${info.id} plugin`,
    summary: "A plugin for tests.",
    defaultEnabled: true,
    ...info,
    layer: Layer.empty,
    make: Effect.succeed({
      run: Queue.offer(seen, "started").pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Queue.offer(seen, "stopped")),
      ),
      turnOff: cleanup,
    }),
  });

/** Core on `baseDir` with `plugins` registered and started, living as long as the test's scope. */
const startedCore = (
  baseDir: string,
  plugins: ReadonlyArray<ReturnType<typeof fakePlugin>>,
  session?: string,
) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(baseDir, { plugins, ...(session === undefined ? {} : { session }) }),
    );
    return yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      return {
        plugins: yield* PeerPlugins.PeerPlugins,
        state: yield* PeerState.PeerState,
        client: yield* PeerHubClient.PeerHubClient,
      };
    }).pipe(Effect.provide(core));
  });

const refusal = (effect: Effect.Effect<void, PeerHubError>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.detail : null)),
  );

describe("Peer plugins", () => {
  it.effect(
    "a forced-off plugin stays visible, dominates saved enables, and refuses enable without writes",
    () =>
      Effect.gen(function* () {
        const seen = yield* Queue.unbounded<SeenEvent>();
        const core = yield* startedCore(yield* seedState(), [
          fakePlugin({ id: "audit", forcedOff: () => "FORCE_TEST=off" }, seen),
        ]);
        yield* core.state.updatePersisted((p) => ({
          ...p,
          plugins: { ...p.plugins, audit: true },
        }));
        const before = (yield* core.state.read).persisted;
        assert.deepStrictEqual(yield* core.plugins.states, [
          {
            id: "audit",
            title: "The audit plugin",
            enabled: false,
            active: false,
            reason: "FORCE_TEST=off",
            locked: true,
          },
        ]);
        assert.include(
          (yield* refusal(core.plugins.setPlugin({ id: "audit", enabled: true })))!,
          "FORCE_TEST=off",
        );
        yield* core.plugins.setPlugin({ id: "audit", enabled: false });
        assert.strictEqual((yield* core.state.read).persisted, before);
        assert.equal(yield* Queue.size(seen), 0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("start from their defaults", () =>
    Effect.gen(function* () {
      const seen = yield* Queue.unbounded<SeenEvent>();
      const core = yield* startedCore(yield* seedState(), [
        fakePlugin({ id: "audit" }, seen),
        fakePlugin({ id: "observe", title: "Observe", defaultEnabled: false }, seen),
      ]);
      assert.deepStrictEqual(yield* core.plugins.states, [
        { id: "audit", title: "The audit plugin", enabled: true, active: true },
        { id: "observe", title: "Observe", enabled: false, active: false, reason: "off" },
      ]);
      assert.deepStrictEqual(
        (yield* core.plugins.active).map((plugin) => plugin.id),
        ["audit"],
      );
      assert.isTrue(yield* core.plugins.isActive("audit"));
      assert.isFalse(yield* core.plugins.isActive("herdr"));
      assert.isNull(yield* refusal(core.plugins.requireActive("audit")));
      assert.strictEqual(
        yield* refusal(core.plugins.requireActive("observe")),
        "Observe is turned off on this environment.",
      );
      assert.strictEqual(
        yield* refusal(core.plugins.requireActive("observe")),
        'There is no Peer plugin "observe" on this environment.',
      );
      // Only the active plugin's work runs.
      assert.strictEqual(yield* Queue.take(seen), "started");
      assert.strictEqual(yield* Queue.size(seen), 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "keep an owner's choice, run work only while on, and clean up once per turning off",
    () =>
      Effect.gen(function* () {
        const seen = yield* Queue.unbounded<SeenEvent>();
        const baseDir = yield* seedState();
        const first = yield* startedCore(baseDir, [fakePlugin({ id: "audit" }, seen)]);
        assert.strictEqual(yield* Queue.take(seen), "started");

        yield* first.plugins.setPlugin({ id: "audit", enabled: false });
        assert.deepStrictEqual(yield* Queue.takeAll(seen), ["stopped", "cleaned"]);
        // Turning it off again changes nothing, and runs no second cleanup.
        yield* first.plugins.setPlugin({ id: "audit", enabled: false });
        assert.strictEqual(yield* Queue.size(seen), 0);
        assert.deepStrictEqual((yield* first.state.read).persisted.plugins, { audit: false });
        assert.strictEqual(
          yield* refusal(first.plugins.setPlugin({ id: "telepathy", enabled: true })),
          'There is no Peer plugin "telepathy" on this environment.',
        );

        // After a restart it is still off, and turning it on starts its work without one.
        const restarted = yield* startedCore(baseDir, [fakePlugin({ id: "audit" }, seen)]);
        assert.deepStrictEqual(yield* restarted.plugins.states, [
          { id: "audit", title: "The audit plugin", enabled: false, active: false, reason: "off" },
        ]);
        assert.strictEqual(yield* Queue.size(seen), 0);
        yield* restarted.plugins.setPlugin({ id: "audit", enabled: true });
        assert.strictEqual(yield* Queue.take(seen), "started");
        assert.isTrue(yield* restarted.plugins.isActive("audit"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "follow the Hub's feature catalog, and say when a plugin needs a newer Hub or waits for one",
    () =>
      Effect.gen(function* () {
        const seen = yield* Queue.unbounded<SeenEvent>();
        const answer: { current: HubAnswer } = { current: () => [200, meAnswer()] };
        const hub = yield* standInHub(answer);
        const core = yield* startedCore(
          yield* seedState(signedInSeed(hub.url)),
          [fakePlugin({ id: "changes", hubFeature: { id: "changes", revision: 2 } }, seen)],
          "phs_test",
        );
        // Before a Hub answered, the legacy set (no changes) is all Peer assumes, and no
        // Hub said whether it serves more: the plugin waits for one, it does not need a newer one.
        const waiting = {
          id: "changes",
          title: "The changes plugin",
          enabled: true,
          active: false,
          reason: "hub-unknown",
        };
        assert.deepStrictEqual(yield* core.plugins.states, [waiting]);
        assert.strictEqual(
          yield* refusal(core.plugins.requireActive("changes")),
          "The changes plugin waits for a Peer Hub: it works once this environment is signed in and its Hub answers.",
        );
        assert.strictEqual(yield* Queue.size(seen), 0);

        answer.current = () => [200, meAnswer({ changes: 2, observe: 1 })];
        yield* core.client.me;
        assert.strictEqual(yield* Queue.take(seen), "started");
        assert.isTrue(yield* core.plugins.isActive("changes"));

        answer.current = () => [200, meAnswer({ observe: 1 })];
        yield* core.client.me;
        assert.strictEqual(yield* Queue.take(seen), "stopped");
        // The Hub, not its owner, turned it off: no cleanup runs.
        assert.strictEqual(yield* Queue.size(seen), 0);
        assert.deepStrictEqual(yield* core.plugins.states, [
          {
            id: "changes",
            title: "The changes plugin",
            enabled: true,
            active: false,
            reason: "hub",
          },
        ]);
        assert.strictEqual(
          yield* refusal(core.plugins.requireActive("changes")),
          "The changes plugin needs a newer Peer Hub.",
        );

        // Signed out, the last Hub's answer no longer says anything of the next one.
        yield* core.client.signOut;
        assert.deepStrictEqual(yield* core.plugins.states, [waiting]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuse to start while a plugin names a command core has", () =>
    Effect.gen(function* () {
      const seen = yield* Queue.unbounded<SeenEvent>();
      const core = yield* Layer.build(
        coreLayer(yield* seedState(), {
          plugins: [fakePlugin({ id: "observe", commandNames: ["status"] }, seen)],
        }),
      );
      const started = yield* PeerPlugins.startPlugins.pipe(Effect.provide(core), Effect.exit);
      assert.isTrue(Exit.isFailure(started));
      if (Exit.isFailure(started)) {
        assert.include(
          Cause.pretty(started.cause),
          'Command "status" of plugin "observe" is already core\'s.',
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("show a cleanup that failed as the plugin's error, and keep the owner's choice", () =>
    Effect.gen(function* () {
      const seen = yield* Queue.unbounded<SeenEvent>();
      const core = yield* startedCore(yield* seedState(), [
        fakePlugin(
          { id: "observe", title: "Observe" },
          seen,
          Effect.fail(new PeerHubError({ detail: "The Hub did not answer." })),
        ),
      ]);
      yield* core.plugins.setPlugin({ id: "observe", enabled: false });
      assert.deepStrictEqual(yield* core.plugins.states, [
        {
          id: "observe",
          title: "Observe",
          enabled: false,
          active: false,
          reason: "off",
          error: "The Hub did not answer.",
        },
      ]);
      yield* core.plugins.setPlugin({ id: "observe", enabled: true });
      assert.deepStrictEqual(yield* core.plugins.states, [
        { id: "observe", title: "Observe", enabled: true, active: true },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
