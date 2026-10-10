/**
 * The Hub's `slack` endpoints on the signed-in session: the routes behind the RPC methods, and the
 * asks this computer opens and the answers it takes back.
 *
 * @module peerHub/plugins/slack/hub
 */
import {
  PeerHubError,
  PeerSlackAdmin,
  PeerSlackChannels,
  PeerSlackMe,
  PeerSlackTestResult,
  type PeerSlackWorkspaceInput as Ws,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const Done = Schema.Struct({});
const Answers = Schema.Struct({
  answers: Schema.Array(
    Schema.Struct({
      answer: Schema.String,
      waitKey: Schema.String,
      kind: Schema.String,
      value: Schema.String,
      index: Schema.optional(Schema.Number),
    }),
  ),
});
/** An answer the owner gave in Slack, held by the Hub for this computer. */
export type SlackAnswer = (typeof Answers.Type)["answers"][number];

const noSlack = new PeerHubError({
  detail: "This Peer Hub has no Slack support yet.",
  refused: true,
});
/** Opening an ask meets 409 `closed` (it is over) or 409 `slack_off` (Slack is off for it). */
const refusal = (code: string, details: unknown) =>
  code === "closed"
    ? ("closed" as const)
    : code === "slack_off"
      ? { off: String((details as { reason?: unknown } | null)?.reason ?? "off") }
      : undefined;

type Schemas = Schema.Top & { readonly DecodingServices: never };
type Method = "GET" | "POST" | "PUT" | "DELETE";

export const slackHub = (client: PeerHubClient.PeerHubClient["Service"]) => {
  const call = <S extends Schemas>(
    schema: S,
    workspace: string,
    method: Method,
    path: string,
    body?: object,
  ) =>
    client
      .request(schema, {
        workspace,
        path,
        method,
        ...(body === undefined ? {} : { body }),
        unsupported: { value: null, when: (_status, message) => message === "no such route" },
      })
      .pipe(Effect.filterOrFail(Predicate.isNotNull, () => noSlack));
  /** A route of a workspace; the rest of the input is the body of a PUT or POST. */
  const route =
    <S extends Schemas>(method: Method, path: string, schema: S) =>
    <I extends Ws>({ workspace, ...body }: I) =>
      call(
        schema,
        workspace,
        method,
        path,
        method === "PUT" || method === "POST" ? body : undefined,
      );

  return {
    me: route("GET", "/slack/me", PeerSlackMe),
    setMine: route("PUT", "/slack/me", PeerSlackMe),
    link: route("POST", "/slack/me/link", PeerSlackMe),
    unlink: route("DELETE", "/slack/me/link", PeerSlackMe),
    admin: route("GET", "/slack/admin", PeerSlackAdmin),
    verify: route("POST", "/slack/admin/verify", PeerSlackAdmin),
    channels: route("GET", "/slack/admin/channels", PeerSlackChannels),
    setChannels: route("PUT", "/slack/admin/channels", PeerSlackAdmin),
    test: route("POST", "/slack/admin/test", PeerSlackTestResult),
    disconnect: route("DELETE", "/slack/admin", PeerSlackAdmin),
    unlinkMember: ({ workspace, email }: Ws & { readonly email: string }) =>
      call(PeerSlackAdmin, workspace, "DELETE", `/slack/admin/links/${encodeURIComponent(email)}`),
    /** Seals one of the app's secrets as a workspace secret, by the Hub's existing route. */
    saveSecret: (workspace: string, name: string, value: string) =>
      call(Done, workspace, "PUT", `/secrets/${name}`, { value }),

    /** Opens the ask of a wait key, once: the same key answers the ask it opened. */
    open: (workspace: string, body: object) =>
      client.request(Done, {
        workspace,
        path: "/slack/asks",
        method: "PUT",
        body,
        conflict: refusal,
      }),
    /** Withdraws an ask; null when the Hub has none of that key. */
    withdraw: (workspace: string, body: object) =>
      client.request(Done, {
        workspace,
        path: "/slack/asks/withdraw",
        method: "POST",
        body,
        notFound: { value: null },
      }),
    inbox: (workspace: string, environment: string) =>
      client.request(Answers, {
        workspace,
        path: `/slack/inbox?environment=${encodeURIComponent(environment)}`,
      }),
    /** Tells the Hub what became of an answer; null when it holds none any more. */
    report: (workspace: string, id: string, body: object) =>
      client.request(Done, {
        workspace,
        path: `/slack/inbox/${encodeURIComponent(id)}/result`,
        method: "POST",
        body,
        notFound: { value: null },
      }),
  };
};
export type SlackHub = ReturnType<typeof slackHub>;
