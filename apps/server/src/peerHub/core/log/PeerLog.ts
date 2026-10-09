import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as ServerConfig from "../../../config.ts";
import { createMetricsLog, type MetricsLog } from "../metricsLog.ts";
export class PeerLog extends Context.Service<PeerLog, MetricsLog>()(
  "t3/peerHub/core/log/PeerLog",
) {}
export const layer = Layer.effect(
  PeerLog,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig,
      clock = yield* Clock.Clock;
    const log = createMetricsLog({
      path: `${config.logsDir}/coordination.jsonl`,
      now: () => clock.currentTimeMillisUnsafe(),
    });
    yield* Effect.addFinalizer(() => Effect.promise(log.idle));
    return log;
  }),
);
