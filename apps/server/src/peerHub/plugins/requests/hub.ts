/**
 * Team requests' Hub endpoints (the Hub's `requests` feature): the requests addressed to the signed-in
 * person in a workspace, sending one to a teammate, and answering one.
 *
 * @module peerHub/plugins/requests/hub
 */
import {
  PeerHubError,
  PeerAgentRequest,
  type PeerHubSendRequestInput,
  type PeerHubWithdrawRequestInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const Inbox = Schema.Struct({ requests: Schema.Array(PeerAgentRequest) });

const requestsOf = (projectId: string, id?: string) =>
  `/projects/${encodeURIComponent(projectId)}/requests${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;

/** The endpoints, called on the signed-in session. */
export const requestsHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /** The requests addressed to the signed-in person in a workspace, pending or answered. */
  inbox: (workspace: string) =>
    client
      .request(Inbox, { workspace, path: "/requests", unsupported: { value: { requests: [] } } })
      .pipe(Effect.map((answer) => answer.requests)),

  /** Puts a request in its recipient's inbox; the same `op` puts it there once. */
  send: (input: PeerHubSendRequestInput) =>
    client.request(PeerAgentRequest, {
      workspace: input.workspace,
      path: requestsOf(input.projectId),
      method: "POST",
      body: {
        op: input.op,
        recipient: input.recipient,
        title: input.title,
        prompt: input.prompt,
        ...(input.task === undefined ? {} : { task: input.task }),
      },
    }),

  /**
   * Its recipient accepts a request (taking the task) or dismisses it, with the reason the sender
   * sees when they gave one. A Hub that keeps no reasons ignores it.
   */
  respond: (
    workspace: string,
    projectId: string,
    id: string,
    status: "accepted" | "dismissed",
    reason?: string,
  ) => {
    const said = reason?.trim() ?? "";
    return client.request(PeerAgentRequest, {
      workspace,
      path: requestsOf(projectId, id),
      method: "PATCH",
      body: { status, ...(said === "" ? {} : { reason: said }) },
    });
  },
  withdraw: (input: PeerHubWithdrawRequestInput) =>
    client
      .request(PeerAgentRequest, {
        workspace: input.workspace,
        path: requestsOf(input.projectId, input.requestId),
        method: "DELETE",
        unsupported: { value: null, when: (_status, message) => message === "no such route" },
      })
      .pipe(
        Effect.flatMap((row) =>
          row === null
            ? Effect.fail(
                new PeerHubError({
                  detail: "This Hub cannot withdraw requests yet.",
                  refused: true,
                }),
              )
            : Effect.succeed(row),
        ),
      ),
});
