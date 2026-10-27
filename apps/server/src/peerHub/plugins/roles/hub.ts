/**
 * The roles feature's Hub endpoints (design D2): a project's roles, and one session's role set,
 * marked as having changed files, or cleared. The Hub keeps a role only for a session this computer
 * reported (403 `not_your_session`) and, for an agent's own request, only while that session has
 * changed nothing and claims nothing (409 `session_not_clean`); what a refusal means is the caller's.
 *
 * @module peerHub/plugins/roles/hub
 */
import { PeerRoleRow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const Listed = Schema.Struct({ roles: Schema.Array(PeerRoleRow) });

const segment = encodeURIComponent;
const sessionPath = (project: string, session: string) =>
  `/roles/${segment(project)}/${segment(session)}`;

/** The endpoints, called on the signed-in session. */
export const rolesHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /** Every role of a project's live sessions; 404 for someone not on it. */
  list: (workspace: string, project: string) =>
    client
      .request(Listed, { workspace, path: `/roles/${segment(project)}` })
      .pipe(Effect.map(({ roles }) => roles)),

  /** Gives a session of this computer a role; the last of two writes stands. */
  put: (
    workspace: string,
    project: string,
    session: string,
    body: {
      readonly role: string;
      readonly environment: string;
      readonly setBy: "person" | "agent";
    },
  ) =>
    client.request(Schema.Unknown, {
      workspace,
      path: sessionPath(project, session),
      method: "PUT",
      body,
      timeoutMs: 4000,
    }),

  /** Whether the session's files changed through the shell while it had the role: no file names. */
  changed: (workspace: string, project: string, session: string, changed: boolean) =>
    client.request(Schema.Unknown, {
      workspace,
      path: sessionPath(project, session),
      method: "PATCH",
      body: { changed },
      timeoutMs: 4000,
    }),

  /** Clears a session's role; clearing one that has none changes nothing. */
  clear: (workspace: string, project: string, session: string) =>
    client.request(Schema.Unknown, {
      workspace,
      path: sessionPath(project, session),
      method: "DELETE",
      timeoutMs: 4000,
    }),
});
