import { PEER_OPENSPEC_METHODS, PEER_OPENSPEC_PLUGIN, OpenSpecRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as OpenSpec from "./OpenSpec.ts";

export const OpenSpecPlugin = bindPlugin({
  ...PEER_OPENSPEC_PLUGIN,
  id: "openspec",
  layer: OpenSpec.layer,
  make: Effect.gen(function* () {
    const service = yield* OpenSpec.OpenSpec;
    return {
      rpc: {
        group: OpenSpecRpcGroup,
        handlers: (wrap) =>
          OpenSpecRpcGroup.of({
            [PEER_OPENSPEC_METHODS.peerOpenSpecRead]: (input) =>
              wrap.effect(PEER_OPENSPEC_METHODS.peerOpenSpecRead, service.read(input)),
          }),
      },
    } satisfies PeerContributions;
  }),
});
