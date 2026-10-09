/**
 * The observe plugin. Its owner shares one of this computer's threads, and the team watches it
 * live through the Hub's relay; people here watch their colleagues' shared threads. It needs the
 * Hub's `observe` feature. Turning it off unshares this computer's threads.
 *
 * @module peerHub/plugins/observe
 */
import { ObserveRpcGroup, PEER_OBSERVE_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Observe from "./Observe.ts";

/** Traced as Peer's methods always were. */
const TRACE = { "rpc.aggregate": "peerHub" } as const;

export const ObservePlugin = bindPlugin({
  id: "observe",
  title: "Observe",
  summary: "Let the team watch a thread of yours live while you share it, and watch theirs.",
  defaultEnabled: true,
  hubFeature: { id: "observe", revision: 1 },
  layer: Observe.layer,
  make: Effect.gen(function* () {
    const observe = yield* Observe.Observe;
    return {
      hubChanges: {
        changes: ["observe"],
        // Someone started watching a shared thread.
        onPing: (ping) => {
          const { environment, thread } = ping.data;
          return ping.change === "observe" &&
            typeof environment === "string" &&
            typeof thread === "string"
            ? observe.watched({ workspace: ping.workspace, environment, thread })
            : Effect.void;
        },
      },
      status: { read: observe.shared },
      rpc: {
        group: ObserveRpcGroup,
        handlers: (wrap) =>
          ObserveRpcGroup.of({
            [PEER_OBSERVE_METHODS.peerHubShareThread]: (input) =>
              wrap.effect(PEER_OBSERVE_METHODS.peerHubShareThread, observe.share(input), TRACE),
            [PEER_OBSERVE_METHODS.peerHubObserveThread]: (input) =>
              wrap.stream(PEER_OBSERVE_METHODS.peerHubObserveThread, observe.watch(input), TRACE),
          }),
      },
      // Observe's work runs while it is active: its views stop, and watching ends, when it stops.
      run: Effect.addFinalizer(() => observe.stop).pipe(Effect.andThen(Effect.never)),
      turnOff: observe.unshareAll,
      threadReport: (thread) => ({ observable: observe.isShared(thread) }),
    } satisfies PeerContributions;
  }),
});
