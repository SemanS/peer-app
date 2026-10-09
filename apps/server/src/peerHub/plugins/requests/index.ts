/**
 * The team requests plugin. A member asks a teammate to start their agent on a task: from the Work
 * panel, or as an agent with `peer request`. The request waits in the teammate's Needs you until
 * they accept it, starting their agent through `peerHub.startAgent` (this plugin's
 * `requestAcceptor`), or dismiss it. It needs the Hub's `requests` feature, which keeps the
 * requests while the plugin is off.
 *
 * @module peerHub/plugins/requests
 */
import { PEER_REQUESTS_METHODS, RequestsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { requestCommand } from "./command.ts";
import * as Requests from "./Requests.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";

/** Traced as Peer's methods always were. */
const TRACE = { "rpc.aggregate": "peerHub" } as const;

export const RequestsPlugin = bindPlugin({
  id: "requests",
  title: "Team requests",
  summary: "Ask a teammate, in their Needs you, to start their agent on a task.",
  defaultEnabled: true,
  hubFeature: { id: "requests", revision: 1 },
  layer: Requests.layer,
  make: Effect.gen(function* () {
    const requests = yield* Requests.Requests;
    const status = yield* PeerStatus.PeerStatus;
    return {
      commands: [requestCommand(requests)],
      hubChanges: {
        changes: ["requests"],
        onPing: (ping) => requests.readSoon(ping.workspace),
      },
      lifecycle: (event) =>
        event.kind === "signing-out"
          ? requests.forget
          : event.kind === "signed-in"
            ? requests.forget.pipe(Effect.andThen(requests.refresh()))
            : event.kind === "synced"
              ? Effect.forEach(event.workspaces, (workspace) => requests.readSoon(workspace.slug), {
                  discard: true,
                })
              : Effect.void,
      status: { read: requests.inbox },
      turnOff: requests.forget,
      rpc: {
        group: RequestsRpcGroup,
        handlers: (wrap) =>
          RequestsRpcGroup.of({
            [PEER_REQUESTS_METHODS.peerHubSendRequest]: (input) =>
              wrap.effect(
                PEER_REQUESTS_METHODS.peerHubSendRequest,
                requests.send(input).pipe(Effect.andThen(status.publish)),
                TRACE,
              ),
            [PEER_REQUESTS_METHODS.peerHubDismissRequest]: (input) =>
              wrap.effect(
                PEER_REQUESTS_METHODS.peerHubDismissRequest,
                requests.dismiss(input),
                TRACE,
              ),
            [PEER_REQUESTS_METHODS.peerHubWithdrawRequest]: (input) =>
              wrap.effect(
                PEER_REQUESTS_METHODS.peerHubWithdrawRequest,
                requests.withdraw(input).pipe(Effect.andThen(status.publish)),
                TRACE,
              ),
          }),
      },
      run: requests.follow,
      requestAcceptor: { accept: requests.accept },
    } satisfies PeerContributions;
  }),
});
