import {
  PEER_SLACK_METHODS as m,
  PEER_SLACK_PLUGIN,
  SlackRpcGroup,
  type PeerHubError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Slack from "./PeerSlack.ts";

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
  layer: Slack.layer,
  make: Effect.gen(function* () {
    const slack = yield* Slack.PeerSlack;
    return {
      rpc: {
        group: SlackRpcGroup,
        handlers: (wrap) => {
          const h =
            <I, A>(method: string, call: (input: I) => Effect.Effect<A, PeerHubError>) =>
            (input: I) =>
              wrap.effect(method, call(input));
          return SlackRpcGroup.of({
            [m.peerSlackMe]: h(m.peerSlackMe, slack.me),
            [m.peerSlackSetMine]: h(m.peerSlackSetMine, slack.setMine),
            [m.peerSlackLink]: h(m.peerSlackLink, slack.link),
            [m.peerSlackUnlink]: h(m.peerSlackUnlink, slack.unlink),
            [m.peerSlackAdmin]: h(m.peerSlackAdmin, slack.admin),
            [m.peerSlackSaveSecrets]: h(m.peerSlackSaveSecrets, slack.saveSecrets),
            [m.peerSlackVerify]: h(m.peerSlackVerify, slack.verify),
            [m.peerSlackChannels]: h(m.peerSlackChannels, slack.channels),
            [m.peerSlackSetChannels]: h(m.peerSlackSetChannels, slack.setChannels),
            [m.peerSlackTest]: h(m.peerSlackTest, slack.test),
            [m.peerSlackUnlinkMember]: h(m.peerSlackUnlinkMember, slack.unlinkMember),
            [m.peerSlackDisconnect]: h(m.peerSlackDisconnect, slack.disconnect),
          });
        },
      },
      hubChanges: { changes: ["slack"], onPing: (ping) => slack.ping(ping.workspace) },
      run: slack.run,
      // No tool: T3's MCP server hands the plugin the threads its answers go to.
      mcp: Layer.effectDiscard(
        Effect.gen(function* () {
          slack.bindThreads(yield* ThreadManagementService);
        }),
      ),
      turnOff: slack.stop,
      workspaceCleanup: slack.forget,
    } satisfies PeerContributions;
  }),
});
