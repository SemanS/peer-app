import { PEER_USAGE_METHODS, UsageRpcGroup } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { UsageSessionReader } from "../../../usage/usageSessionTotals.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { remoteFile, remoteWhenPresent } from "./remoteMemory.ts";
import { createReporter } from "./reporter.ts";
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
    // Null in headless Peer Core, which has no usage engine: the page still works, and nothing here
    // reads a transcript or sends a report.
    const read = yield* UsageSessionReader;
    const state = yield* PeerState.PeerState;
    const { features } = yield* PeerHubClient.PeerHubClient;
    const clock = yield* Clock.Clock;
    return {
      ...(read === null
        ? {}
        : {
            run: createReporter({
              state,
              features,
              usage,
              read,
              remoteOf: remoteWhenPresent(PeerState.remoteOf),
              remotesFile: remoteFile(`${state.hubHome}/.usage/remotes.json`),
              now: () => clock.currentTimeMillisUnsafe(),
            }).run,
          }),
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
