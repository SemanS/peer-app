/**
 * Shared capacity's Hub endpoints: the gateway key this environment holds for a project, which the
 * Hub issues and revokes, and a project's spending.
 *
 * @module peerHub/plugins/capacity/hub
 */
import { PeerHubProjectUsage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

/** A project's gateway key for one environment, and the models it reaches. */
const Credentials = Schema.Struct({
  project: Schema.String,
  baseUrl: Schema.String,
  apiKey: Schema.String,
  keyId: Schema.String,
  models: Schema.Array(Schema.Struct({ id: Schema.String, harness: Schema.Array(Schema.String) })),
});

const Ok = Schema.Struct({});

const projectPath = (projectId: string, rest: string) =>
  `/projects/${encodeURIComponent(projectId)}${rest}`;

/** The endpoints, called on the signed-in session. */
export const capacityHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /** Issues `environment` its gateway key for a project's shared capacity. */
  issue: (workspace: string, projectId: string, environment: string) =>
    client.request(Credentials, {
      workspace,
      path: projectPath(projectId, "/credentials"),
      method: "POST",
      body: { environment },
    }),

  /** Revokes `environment`'s gateway key for a project. */
  revoke: (workspace: string, projectId: string, environment: string) =>
    client.request(Ok, {
      workspace,
      path: projectPath(projectId, `/credentials?environment=${encodeURIComponent(environment)}`),
      method: "DELETE",
    }),

  /** What a project spent this period, shared and as its members reported it. */
  usage: (workspace: string, projectId: string) =>
    client.request(PeerHubProjectUsage, { workspace, path: projectPath(projectId, "/usage") }),
});
