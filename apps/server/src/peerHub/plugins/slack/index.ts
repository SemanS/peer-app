import { PEER_SLACK_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";

/**
 * Slack threads for agents that wait on their owners: posts a waiting agent's question to its
 * project's Slack thread and takes the owner's answer back to that agent.
 */
export const SlackPlugin = bindPlugin({
  id: "slack",
  title: PEER_SLACK_PLUGIN.title,
  summary: PEER_SLACK_PLUGIN.summary,
  hubFeature: PEER_SLACK_PLUGIN.hubFeature,
  defaultEnabled: true,
  layer: Layer.empty,
  make: Effect.succeed({} satisfies PeerContributions),
});
