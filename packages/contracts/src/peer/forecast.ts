import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const PeerForecastSide = Schema.Struct({
  branch: Schema.String,
  email: Schema.String,
  task: Schema.optional(Schema.String),
  title: Schema.String,
  where: Schema.Literals(["here", "origin"]),
});
export type PeerForecastSide = typeof PeerForecastSide.Type;
export const PeerForecastPair = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  repository: Schema.String,
  a: PeerForecastSide,
  b: PeerForecastSide,
  files: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  more: count,
  checkedAt: Schema.String,
});
export type PeerForecastPair = typeof PeerForecastPair.Type;
export const PeerForecast = Schema.Struct({
  state: Schema.Literals(["on", "off", "unsupported"]),
  reason: Schema.optional(
    Schema.Literals(["disabled", "environment", "git-missing", "git-old", "git-unreadable"]),
  ),
  git: Schema.optional(Schema.String),
  teammates: Schema.Boolean,
  pairs: Schema.Array(PeerForecastPair).check(Schema.isMaxLength(30)),
  tracked: count,
  skipped: count,
  notOnOrigin: count,
  paused: Schema.Array(Schema.Struct({ repository: Schema.String, until: Schema.String })),
  fetchFailedAt: Schema.optional(Schema.String),
  checkedAt: Schema.optional(Schema.String),
});
export type PeerForecast = typeof PeerForecast.Type;
export const PeerForecastConfigure = Schema.Struct({ teammates: Schema.optional(Schema.Boolean) });
export type PeerForecastConfigure = typeof PeerForecastConfigure.Type;
/** Preserve complete paths and count omitted paths; unusually large labels may omit a pair. */
export function boundForecast(source: PeerForecast): PeerForecast {
  const pairs = source.pairs.slice(0, 30).map((pair) => ({
    ...pair,
    files: pair.files.slice(0, 20),
    more: pair.more + Math.max(0, pair.files.length - 20),
  }));
  const result = { ...source, pairs },
    encoder = new TextEncoder();
  while (encoder.encode(JSON.stringify(result)).length >= 64 * 1024 && pairs.length > 0) {
    const pair = pairs.findLast((candidate) => candidate.files.length > 0);
    if (pair === undefined) pairs.pop();
    else {
      pair.files.pop();
      pair.more++;
    }
  }
  return result;
}
export const PEER_FORECAST_METHODS = {
  peerForecastSubscribe: "peerForecast.subscribe",
  peerForecastConfigure: "peerForecast.configure",
} as const;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const WsPeerForecastRpcGroup = RpcGroup.make(
  Rpc.make(PEER_FORECAST_METHODS.peerForecastSubscribe, {
    payload: Schema.Struct({}),
    success: PeerForecast,
    error,
    stream: true,
  }),
  Rpc.make(PEER_FORECAST_METHODS.peerForecastConfigure, {
    payload: PeerForecastConfigure,
    success: PeerForecast,
    error,
  }),
);
export const ForecastRpcScopes = {
  [PEER_FORECAST_METHODS.peerForecastSubscribe]: AuthOrchestrationReadScope,
  [PEER_FORECAST_METHODS.peerForecastConfigure]: AuthAccessWriteScope,
} as const satisfies Record<
  RpcGroup.Rpcs<typeof WsPeerForecastRpcGroup>["_tag"],
  AuthEnvironmentScope
>;
