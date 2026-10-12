import type { PeerPlansStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { refused } from "../../core/plugin.ts";
import type { PlansCommands } from "./cli.ts";

/** `PEER_PLANS=off` keeps plans off on this computer, whatever its owner chose in Settings. */
export const forcedOff = () => process.env.PEER_PLANS === "off";

export class Plans extends Context.Service<
  Plans,
  {
    /** The status slice, read from memory on every publish. */
    readonly status: Effect.Effect<PeerPlansStatus>;
    /** What `peer plan` asks of the plugin. */
    readonly commands: PlansCommands;
  }
>()("t3/peerHub/plugins/plans/Plans") {}

const unavailable = Effect.fail(refused("peer plan is not available yet", "run peer help."));

export const layer = Layer.succeed(
  Plans,
  Plans.of({
    commands: {
      declare: () => unavailable,
      show: () => unavailable,
      withdraw: () => unavailable,
      publicView: () => unavailable,
    },
    status: Effect.sync((): PeerPlansStatus => ({
      enabled: true,
      forcedOff: forcedOff(),
      hubSupport: "unknown",
      counts: [],
      revision: 0,
    })),
  }),
);
