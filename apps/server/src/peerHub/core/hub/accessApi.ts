import {
  PeerHubError,
  PeerInvitation,
  PeerInvitationList,
  PeerInvitePreview,
  PeerWorkspaceMembers,
  PeerRemovalPlan,
  PeerMemberKeys,
  type PeerHubInvitePreviewInput,
  type PeerHubMemberInput,
  type PeerHubMemberRoleInput,
  type PeerHubMemberKeysInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { HubCall } from "./hubApi.ts";

/** What a Hub from before invitations had a lifecycle answers for a route it lacks. */
const isOlderHub = (error: PeerHubError) =>
  error.status === 405 ||
  (error.status === 404 && (error.code === undefined || error.detail === "no such route"));

/**
 * Membership, invitations, foundings and key management stay in core, independent of whether
 * Audit is enabled.
 */
export const accessApi = (request: HubCall) => {
  const invitesPath = (workspace: string, rest = "") =>
    `/v1/workspaces/${encodeURIComponent(workspace)}/invites${rest}`;
  const foundingPath = (slug: string, action: "accept" | "decline") =>
    `/v1/foundings/${encodeURIComponent(slug)}/${action}`;
  /** Null where the Hub has no such route: it predates the feature. */
  const orNull = <A>(effect: Effect.Effect<A, PeerHubError>) =>
    effect.pipe(
      Effect.catch((error: PeerHubError) =>
        isOlderHub(error) ? Effect.succeed(null) : Effect.fail(error),
      ),
    );
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
    /** The projects a member is on only, or null to lift their limit. */
    setMemberProjects: (
      hubUrl: string,
      session: string,
      input: {
        readonly workspace: string;
        readonly email: string;
        readonly projects: ReadonlyArray<string> | null;
      },
    ) =>
      request(ok, {
        hubUrl,
        session,
        path: path(input.workspace, input.email),
        method: "PUT",
        body: { projects: input.projects },
      }),
    /** The workspace's invitations with their states; null from an older Hub. */
    invitations: (hubUrl: string, session: string, workspace: string) =>
      orNull(request(PeerInvitationList, { hubUrl, session, path: invitesPath(workspace) })),
    /**
     * What inviting `email` to `projects` would reach; null from an older Hub. A lead's preview
     * names the projects, or the Hub refuses it.
     */
    invitePreview: (hubUrl: string, session: string, input: PeerHubInvitePreviewInput) =>
      orNull(
        request(PeerInvitePreview, {
          hubUrl,
          session,
          path: invitesPath(
            input.workspace,
            `/preview?${new URLSearchParams({
              email: input.email,
              ...(input.projects === undefined || input.projects.length === 0
                ? {}
                : { projects: input.projects.join(",") }),
            })}`,
          ),
        }),
      ),
    resendInvite: (hubUrl: string, session: string, input: PeerHubMemberInput) =>
      request(PeerInvitation, {
        hubUrl,
        session,
        path: invitesPath(input.workspace, `/${encodeURIComponent(input.email)}/resend`),
        method: "POST",
        body: {},
      }).pipe(
        Effect.mapError((error) =>
          isOlderHub(error)
            ? new PeerHubError({
                detail: "This hub cannot send an invitation again. Update Peer Hub.",
                kind: "unsupported",
              })
            : error,
        ),
      ),
    /** Accepts or declines an organization founded for the signed-in address. */
    answerFounding: (hubUrl: string, session: string, slug: string, action: "accept" | "decline") =>
      request(ok, { hubUrl, session, path: foundingPath(slug, action), method: "POST", body: {} }),
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
