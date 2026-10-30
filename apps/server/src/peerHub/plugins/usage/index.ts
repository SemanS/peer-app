import { PEER_USAGE_METHODS, UsageRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { PeerUsageService, layer } from "./service.ts";

export const UsagePlugin = bindPlugin({
  id: "usage",
  title: "Usage",
  summary: "See a workspace's tickets, agent work, spend and tokens. Sharing yours is your choice.",
  defaultEnabled: true,
  // No `hubFeature`: the page answers `unsupported` for an older Hub, so it can say to update it.
  layer,
  make: Effect.gen(function* () {
    const usage = yield* PeerUsageService;
    return {
      rpc: {
        group: UsageRpcGroup,
        handlers: (wrap) =>
          UsageRpcGroup.of({
            [PEER_USAGE_METHODS.peerUsageOverview]: (input) =>
              wrap.effect(PEER_USAGE_METHODS.peerUsageOverview, usage.overview(input), {
                "rpc.aggregate": "peerHub",
              }),
            [PEER_USAGE_METHODS.peerUsageSharing]: (input) =>
              wrap.effect(PEER_USAGE_METHODS.peerUsageSharing, usage.sharing(input), {
                "rpc.aggregate": "peerHub",
              }),
            [PEER_USAGE_METHODS.peerUsageSetSharing]: (input) =>
              wrap.effect(PEER_USAGE_METHODS.peerUsageSetSharing, usage.setSharing(input), {
                "rpc.aggregate": "peerHub",
              }),
          }),
      },
    } satisfies PeerContributions;
  }),
});
