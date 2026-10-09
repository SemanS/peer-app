import { MetricsRpcGroup, PEER_METRICS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { MetricsService, layer } from "./service.ts";
export const MetricsPlugin = bindPlugin({
  id: "metrics",
  title: "Coordination metrics",
  summary:
    "Measure coordination locally. Sharing with the team needs your consent and its admin switch.",
  defaultEnabled: true,
  layer,
  make: Effect.gen(function* () {
    const service = yield* MetricsService;
    return {
      status: { read: service.status },
      run: service.run,
      lifecycle: service.lifecycle,
      workspaceCleanup: service.workspaceCleanup,
      turnOff: service.turnOff,
      rpc: {
        group: MetricsRpcGroup,
        handlers: (wrap) =>
          MetricsRpcGroup.of({
            [PEER_METRICS_METHODS.peerMetricsSummary]: (input) =>
              wrap.effect(PEER_METRICS_METHODS.peerMetricsSummary, service.summary(input)),
            [PEER_METRICS_METHODS.peerMetricsDays]: (input) =>
              wrap.effect(PEER_METRICS_METHODS.peerMetricsDays, service.days(input)),
            [PEER_METRICS_METHODS.peerMetricsConfigure]: (input) =>
              wrap.effect(PEER_METRICS_METHODS.peerMetricsConfigure, service.configure(input)),
          }),
      },
    } satisfies PeerContributions;
  }),
});
