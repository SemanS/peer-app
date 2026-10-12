import * as Effect from "effect/Effect";
import { bindPlugin, refused, type PeerContributions } from "../../core/plugin.ts";
import { Plans, forcedOff, layer } from "./Plans.ts";

/**
 * Plan preflight: before it edits, an agent says what it will change, may change, use and provide,
 * and Peer tells it, and the agents of the works its plan meets, where they meet. Advice only: no
 * edit is stopped, held or ordered because of a plan. The Hub's feature has the same id.
 *
 * @module peerHub/plugins/plans
 */
export const PlansPlugin = bindPlugin({
  id: "plans",
  title: "Plans",
  summary:
    "Before editing, agents say what they will change, use and provide; Peer says whose work meets theirs.",
  defaultEnabled: true,
  forcedOff: () => (forcedOff() ? "PEER_PLANS=off" : undefined),
  commandNames: ["plan"],
  hubFeature: { id: "plans", revision: 1 },
  layer,
  make: Effect.gen(function* () {
    const plans = yield* Plans;
    return {
      commands: [
        {
          name: "plan",
          usage: "plan",
          summary: "say what you will change, use and provide",
          run: () => Effect.fail(refused("peer plan is not available yet", "run peer help.")),
        },
      ],
      status: { read: plans.status },
    } satisfies PeerContributions;
  }),
});
