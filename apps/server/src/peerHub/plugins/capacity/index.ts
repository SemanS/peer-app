/**
 * The shared capacity plugin: a workspace project's shared AI capacity, through the Hub's gateway,
 * becomes a provider instance on this environment holding a per-member, per-project key. It needs
 * no Hub feature. Turning it off revokes this environment's keys and removes their instances.
 *
 * @module peerHub/plugins/capacity
 */
import { CapacityRpcGroup, PEER_CAPACITY_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Capacity from "./Capacity.ts";

/** Traced as Peer's methods always were. */
const TRACE = { "rpc.aggregate": "peerHub" } as const;

export const CapacityPlugin = bindPlugin({
  id: "capacity",
  title: "Shared capacity",
  summary: "Use a workspace project's shared AI capacity on this computer, through the Hub.",
  defaultEnabled: true,
  layer: Capacity.layer,
  make: Effect.gen(function* () {
    const capacity = yield* Capacity.Capacity;
    return {
      status: { read: capacity.shared },
      rpc: {
        group: CapacityRpcGroup,
        handlers: (wrap) =>
          CapacityRpcGroup.of({
            [PEER_CAPACITY_METHODS.peerHubSetSharedCapacity]: (input) =>
              wrap.effect(
                PEER_CAPACITY_METHODS.peerHubSetSharedCapacity,
                capacity.set(input),
                TRACE,
              ),
            [PEER_CAPACITY_METHODS.peerHubProjectUsage]: (input) =>
              wrap.effect(PEER_CAPACITY_METHODS.peerHubProjectUsage, capacity.usage(input), TRACE),
          }),
      },
      lifecycle: capacity.follow,
      turnOff: capacity.revokeAll,
    } satisfies PeerContributions;
  }),
});
