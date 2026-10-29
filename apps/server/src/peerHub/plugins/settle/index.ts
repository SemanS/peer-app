import { PEER_SETTLE_METHODS, PEER_SETTLE_PLUGIN, SettleRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { Settle, layer } from "./service.ts";

export const SettlePlugin = bindPlugin({
  id: "settle",
  title: PEER_SETTLE_PLUGIN.title,
  summary: PEER_SETTLE_PLUGIN.summary,
  defaultEnabled: true,
  layer,
  make: Effect.gen(function* () {
    const service = yield* Settle;
    return {
      status: { read: service.read },
      hooks: { sessionEnding: service.ending },
      turnOff: service.stop,
      run: service.run,
      rpc: {
        group: SettleRpcGroup,
        handlers: (wrap) =>
          SettleRpcGroup.of({
            [PEER_SETTLE_METHODS.peerSettleSetResume]: (input) =>
              wrap.effect(
                PEER_SETTLE_METHODS.peerSettleSetResume,
                service.setResume(input.enabled),
                { "rpc.aggregate": "peerHub" },
              ),
          }),
      },
    } satisfies PeerContributions;
  }),
});
