import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CardRpcGroup, PEER_CARD_MAX, type PeerPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import type { PeerHookContext, PeerRpcWrap, PeerSessionView } from "../../core/plugin.ts";
import { coreLayer, coreRpcStandIns, seedState } from "../../core/testkit.ts";
import { CardPlugin, NO_CARD } from "./index.ts";

const wrap: PeerRpcWrap = {
  effect: (_method, effect) => effect,
  stream: (_method, stream) => stream,
};

/** Core with only the card plugin, what it contributes, and its RPC methods. */
const cardOn = Effect.gen(function* () {
  const core = yield* Layer.build(coreLayer(yield* seedState(), { plugins: [CardPlugin] }));
  const plugins = yield* Effect.gen(function* () {
    yield* PeerPlugins.startPlugins;
    return yield* PeerPlugins.PeerPlugins;
  }).pipe(Effect.provide(core));
  const active = yield* plugins.active;
  const card = active.find(({ id }) => id === ("card" satisfies PeerPluginId))!.contributions;
  const client = yield* RpcTest.makeClient(CardRpcGroup).pipe(
    Effect.provide(
      PeerHub.rpcLayer(wrap).pipe(
        Layer.provide(
          Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
        ),
      ),
    ),
  );
  const read = card.commands![0]!.run({
    session: {} as PeerSessionView,
    args: [],
    plain: [],
    text: "",
    flag: () => undefined,
    cwd: undefined,
  });
  return { card, client, read };
});

describe("a person's card", () => {
  it.effect("says nothing at a start until it has words, then passes them on as theirs", () =>
    Effect.gen(function* () {
      const { card, client, read } = yield* cardOn;
      const started = card.hooks!.sessionStart!({} as PeerHookContext);
      assert.strictEqual(yield* read, NO_CARD);
      assert.isNull(yield* started);
      assert.isTrue(
        (yield* client["peer.card.read"]({})).teammatesMayWake,
        "waking is on until they turn it off",
      );
      yield* client["peer.card.save"]({ text: "  Ask me in Slack.  ", teammatesMayWake: true });
      assert.deepStrictEqual(yield* client["peer.card.read"]({}), {
        text: "Ask me in Slack.",
        teammatesMayWake: true,
      });
      assert.include(yield* read, "in their own words:\nAsk me in Slack.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps a card to its bound", () =>
    Effect.gen(function* () {
      const { client } = yield* cardOn;
      const saved = yield* client["peer.card.save"]({
        text: "x".repeat(PEER_CARD_MAX + 50),
        teammatesMayWake: false,
      });
      assert.lengthOf(saved.text, PEER_CARD_MAX);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
