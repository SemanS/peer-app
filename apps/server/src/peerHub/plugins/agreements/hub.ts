/**
 * The agreements feature's Hub endpoints (the Hub's `agreements` feature, camelCase JSON below
 * `/v1/workspaces/{slug}`): the agreements of a workspace's projects, and a person closing or
 * reopening one. They are called on the signed-in session. A Hub without the route answers
 * `no such route`, which reads as null. Every other refusal fails as a `PeerHubError` that keeps the
 * Hub's words and code: a project that is not the caller's is a 404, and a close or reopen the
 * agreement's state does not allow is `409 agreement_state`.
 *
 * @module peerHub/plugins/agreements/hub
 */
import {
  PeerAgreementResult,
  PeerAgreementsView,
  type PeerAgreementPersonReason,
} from "@t3tools/contracts";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const segment = encodeURIComponent;

/** A Hub that lacks the feature, or whose operator turned it off, says `no such route`. */
const unsupported = {
  value: null,
  when: (_status: number, message: string) => message === "no such route",
} as const;

/** Where one agreement of a project is acted on. */
const actionPath = (project: string, id: string, action: "close" | "reopen") =>
  `/agreements/${segment(project)}/${segment(id)}/${action}`;

/** The endpoints, called on the signed-in session; an answer of null is a Hub without the feature. */
export const agreementsHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /**
   * The agreements of a workspace's projects, or of one project of it, each in the state this caller
   * sees. A command that must answer within the `peer` shim's wait gives `timeoutMs`.
   */
  view: (workspace: string, project?: string, timeoutMs?: number) =>
    client.request(PeerAgreementsView, {
      workspace,
      path: project === undefined ? "/agreements" : `/agreements?project=${segment(project)}`,
      unsupported,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),

  /** A person closes an open or due agreement as handled or not needed. */
  close: (workspace: string, project: string, id: string, why: PeerAgreementPersonReason) =>
    client.request(PeerAgreementResult, {
      workspace,
      path: actionPath(project, id, "close"),
      method: "POST",
      body: { why },
      unsupported,
    }),

  /** A person brings back an agreement a person closed. */
  reopen: (workspace: string, project: string, id: string) =>
    client.request(PeerAgreementResult, {
      workspace,
      path: actionPath(project, id, "reopen"),
      method: "POST",
      body: {},
      unsupported,
    }),
});
