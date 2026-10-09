import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerMetricsSummaryInput,
  PeerMetricsSummary,
  PeerMetricsDaysInput,
  PeerMetricsDays,
  PeerMetricsConfigureInput,
  PeerMetricsStatus,
} from "./metrics.ts";
export const PEER_METRICS_METHODS = {
  peerMetricsSummary: "peer.metrics.summary",
  peerMetricsDays: "peer.metrics.days",
  peerMetricsConfigure: "peer.metrics.configure",
} as const;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const MetricsRpcGroup = RpcGroup.make(
  Rpc.make(PEER_METRICS_METHODS.peerMetricsSummary, {
    payload: PeerMetricsSummaryInput,
    success: PeerMetricsSummary,
    error,
  }),
  Rpc.make(PEER_METRICS_METHODS.peerMetricsDays, {
    payload: PeerMetricsDaysInput,
    success: PeerMetricsDays,
    error,
  }),
  Rpc.make(PEER_METRICS_METHODS.peerMetricsConfigure, {
    payload: PeerMetricsConfigureInput,
    success: PeerMetricsStatus,
    error,
  }),
);
export const MetricsRpcScopes = {
  [PEER_METRICS_METHODS.peerMetricsSummary]: AuthOrchestrationReadScope,
  [PEER_METRICS_METHODS.peerMetricsDays]: AuthOrchestrationReadScope,
  [PEER_METRICS_METHODS.peerMetricsConfigure]: AuthAccessWriteScope,
} as const;
