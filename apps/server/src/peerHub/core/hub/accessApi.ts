import {
  PeerHubError,
  PeerWorkspaceMembers,
  PeerRemovalPlan,
  PeerMemberKeys,
  type PeerHubMemberInput,
  type PeerHubMemberRoleInput,
  type PeerHubMemberKeysInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { HubCall } from "./hubApi.ts";

/** Membership and key management stay in core, independent of whether Audit is enabled. */
export const accessApi = (request: HubCall) => {
  const path = (workspace: string, email?: string, rest = "") =>
    `/v1/workspaces/${encodeURIComponent(workspace)}/members${email === undefined ? "" : `/${encodeURIComponent(email)}`}${rest}`;
  const ok = Schema.Struct({});
  const unsupported = { unsupported: true } as const;
  return {
    members: (hubUrl: string, session: string, workspace: string) =>
      request(PeerWorkspaceMembers, { hubUrl, session, path: path(workspace) }),
    removalPlan: (hubUrl: string, session: string, input: PeerHubMemberInput) =>
      request(PeerRemovalPlan, {
        hubUrl,
        session,
        path: path(input.workspace, input.email, "/offboarding"),
        unsupported: { value: unsupported },
      }),
    removeMember: (hubUrl: string, session: string, input: PeerHubMemberInput) =>
      request(ok, { hubUrl, session, path: path(input.workspace, input.email), method: "DELETE" }),
    setMemberRole: (hubUrl: string, session: string, input: PeerHubMemberRoleInput) =>
      request(ok, {
        hubUrl,
        session,
        path: path(input.workspace, input.email),
        method: "PUT",
        body: { role: input.role },
      }),
    withdrawInvite: (hubUrl: string, session: string, input: PeerHubMemberInput) =>
      request(ok, {
        hubUrl,
        session,
        path: `/v1/workspaces/${encodeURIComponent(input.workspace)}/invites/${encodeURIComponent(input.email)}`,
        method: "DELETE",
      }),
    memberKeys: (hubUrl: string, session: string, input: PeerHubMemberInput) =>
      request(PeerMemberKeys, {
        hubUrl,
        session,
        path: path(input.workspace, input.email, "/keys"),
      }),
    revokeMemberKeys: (hubUrl: string, session: string, input: PeerHubMemberKeysInput) => {
      const query = new URLSearchParams();
      if (input.project !== undefined) query.set("project", input.project);
      if (input.environment !== undefined) query.set("environment", input.environment);
      return request(ok, {
        hubUrl,
        session,
        path: path(input.workspace, input.email, `/keys${query.size ? `?${query}` : ""}`),
        method: "DELETE",
      });
    },
    signOutEverywhere: (hubUrl: string, session: string) =>
      request(ok, {
        hubUrl,
        session,
        path: "/v1/auth/signout-everywhere",
        method: "POST",
        body: {},
        unsupported: { value: unsupported },
      }).pipe(
        Effect.flatMap((answer) =>
          "unsupported" in answer
            ? Effect.fail(
                new PeerHubError({
                  detail: "This hub cannot sign out everywhere. Update Peer Hub.",
                }),
              )
            : Effect.void,
        ),
      ),
  };
};
