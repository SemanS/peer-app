import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { contributionsOf, roomHubOf, roomPeer } from "./fixtures.test.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

type Peer = Effect.Success<ReturnType<typeof roomPeer>>;

/** What `core/workSnapshots.ts` asks before it pushes a pin. */
const shares = (peer: Peer) =>
  peer.plugins.require("wipSharing").pipe(Effect.flatMap((sharing) => sharing.on));

const choose = (peer: Peer, share: boolean) =>
  Effect.gen(function* () {
    const { rpc } = yield* contributionsOf(peer);
    const handlers = rpc?.handlers({
      effect: (_, effect) => effect as never,
      stream: (_, stream) => stream as never,
    }) as Record<string, (input: unknown) => Effect.Effect<unknown, { readonly detail: string }>>;
    return yield* handlers["peer.rooms.shareWork"]!({ share });
  });

/** `peer-hub.json` as a Peer from before rooms held the choice left it. */
const earlierChoice = (peer: Peer, shareWip: boolean, forecastOn = true) =>
  peer.state.updatePersisted((persisted) => ({
    ...persisted,
    plugins: { ...persisted.plugins, ...(forecastOn ? {} : { forecast: false }) },
    pluginData: { ...persisted.pluginData, forecast: { teammates: false, shareWip } },
  }));

describe("sharing an agent's work in progress", () => {
  it.effect("is off until its owner turns it on, and the status says which", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        assert.isFalse(yield* shares(peer));
        assert.isFalse((yield* peer.status.publish).rooms?.shareWork);

        assert.deepStrictEqual(yield* choose(peer, true), { shareWork: true });
        assert.isTrue(yield* shares(peer));
        assert.isTrue((yield* peer.status.publish).rooms?.shareWork);

        yield* choose(peer, false);
        assert.isFalse(yield* shares(peer));
      }),
    ),
  );

  it.effect("keeps a choice made while the forecast plugin held it", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* earlierChoice(peer, true);
        assert.isTrue(yield* shares(peer));
        // A choice made here stands from then on.
        yield* choose(peer, false);
        assert.isFalse(yield* shares(peer));
      }),
    ),
  );

  it.effect("does not start sharing what the forecast plugin was not sharing", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* earlierChoice(peer, false);
        assert.isFalse(yield* shares(peer));
        yield* earlierChoice(peer, true, false);
        assert.isFalse(yield* shares(peer));
      }),
    ),
  );

  it.effect("stops with the plugin: nothing else may push a pin", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* choose(peer, true);
        yield* peer.plugins.setPlugin({ id: "rooms", enabled: false });
        assert.isTrue(Result.isFailure(yield* shares(peer).pipe(Effect.result)));
      }),
    ),
  );
});
