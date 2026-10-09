import {
  PeerHubError,
  PeerAnnouncementList,
  PeerAnnouncementDetail,
  PeerAnnouncementPostResult,
  PeerAnnouncementWithdrawResult,
  PeerAnnouncementSync,
  PeerAnnouncementCredentials,
  PeerAnnouncementCredentialCreated,
  PeerAnnouncementCredential,
  type PeerAnnouncementProjectInput,
  type PeerAnnouncementInput,
  type PeerAnnouncementPostInput,
  type PeerAnnouncementWithdrawInput,
  type PeerAnnouncementCredentialCreateInput,
  type PeerAnnouncementReceipt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
type HubAnswer = Schema.Top & { readonly DecodingServices: never };

/** Typed feature routes on the environment's Hub session; automation secrets are never inputs. */
export function makeHubClient(client: PeerHubClient["Service"]) {
  const projectPath = (project: string) => `/projects/${encodeURIComponent(project)}`;
  const call = <S extends HubAnswer>(
    schema: S,
    workspace: string,
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: unknown,
  ) =>
    client.request(schema, {
      workspace,
      path,
      method,
      ...(body === undefined ? {} : { body }),
      unsupported: { value: null },
      timeoutMs: 10000,
    });
  const required = <A>(answer: A | null) =>
    answer === null
      ? Effect.fail(new PeerHubError({ detail: "This hub has no announcements." }))
      : Effect.succeed(answer);
  return {
    list: ({ workspace, project }: PeerAnnouncementProjectInput) =>
      call(PeerAnnouncementList, workspace, `${projectPath(project)}/announcements`, "GET"),
    detail: ({ workspace, project, id }: PeerAnnouncementInput) =>
      call(
        PeerAnnouncementDetail,
        workspace,
        `${projectPath(project)}/announcements/${encodeURIComponent(id)}`,
        "GET",
      ).pipe(Effect.flatMap(required)),
    post: ({ workspace, project, ...body }: PeerAnnouncementPostInput) =>
      call(
        PeerAnnouncementPostResult,
        workspace,
        `${projectPath(project)}/announcements`,
        "POST",
        body,
      ).pipe(Effect.flatMap(required)),
    withdraw: ({ workspace, project, id, topic }: PeerAnnouncementWithdrawInput) =>
      call(
        PeerAnnouncementWithdrawResult,
        workspace,
        `${projectPath(project)}/announcements${id === undefined ? `?topic=${encodeURIComponent(topic ?? "")}` : `/${encodeURIComponent(id)}`}`,
        "DELETE",
      ).pipe(Effect.flatMap(required)),
    sync: (
      workspace: string,
      environment: string,
      receipts: ReadonlyArray<PeerAnnouncementReceipt>,
    ) =>
      call(PeerAnnouncementSync, workspace, "/announcements/sync", "POST", {
        environment,
        receipts,
      }),
    credentials: ({ workspace, project }: PeerAnnouncementProjectInput) =>
      call(
        PeerAnnouncementCredentials,
        workspace,
        `${projectPath(project)}/announcement-credentials`,
        "GET",
      ).pipe(Effect.flatMap(required)),
    createCredential: ({ workspace, project, ...body }: PeerAnnouncementCredentialCreateInput) =>
      call(
        PeerAnnouncementCredentialCreated,
        workspace,
        `${projectPath(project)}/announcement-credentials`,
        "POST",
        body,
      ).pipe(Effect.flatMap(required)),
    revokeCredential: ({ workspace, project, id }: PeerAnnouncementInput) =>
      call(
        PeerAnnouncementCredential,
        workspace,
        `${projectPath(project)}/announcement-credentials/${encodeURIComponent(id)}`,
        "DELETE",
      ).pipe(Effect.flatMap(required)),
  };
}
