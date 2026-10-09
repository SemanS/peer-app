/**
 * Team requests' Hub endpoints (the Hub's `requests` feature): the requests addressed to the signed-in
 * person in a workspace, sending one to a teammate, and answering one.
 *
 * @module peerHub/plugins/requests/hub
 */
import { PeerAgentRequest, type PeerHubSendRequestInput } from "@t3tools/contracts";
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
      .request(Inbox, { workspace, path: "/requests" })
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

  /** Its recipient accepts a request (taking the task) or dismisses it. */
  respond: (workspace: string, projectId: string, id: string, status: "accepted" | "dismissed") =>
    client.request(PeerAgentRequest, {
      workspace,
      path: requestsOf(projectId, id),
      method: "PATCH",
      body: { status },
    }),
});
