import type { PeerPlansStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** `PEER_PLANS=off` keeps plans off on this computer, whatever its owner chose in Settings. */
export const forcedOff = () => process.env.PEER_PLANS === "off";

export class Plans extends Context.Service<
  Plans,
  {
    /** The status slice, read from memory on every publish. */
    readonly status: Effect.Effect<PeerPlansStatus>;
  }
>()("t3/peerHub/plugins/plans/Plans") {}

export const layer = Layer.succeed(
  Plans,
  Plans.of({
    status: Effect.sync((): PeerPlansStatus => ({
      enabled: true,
      forcedOff: forcedOff(),
      hubSupport: "unknown",
      counts: [],
      revision: 0,
    })),
  }),
);
