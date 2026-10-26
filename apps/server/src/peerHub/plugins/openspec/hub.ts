/**
 * The Hub's `briefs` endpoints below `/v1/workspaces/{slug}`: a task's own brief, read and saved by
 * project members against the revision they read. A Hub without the feature answers
 * `no such route`, which reads as null; a save from an older revision is `409 brief_conflict`,
 * which fails with the revision the brief now has.
 *
 * @module peerHub/plugins/openspec/hub
 */
import { PeerHubError, PeerTaskBrief } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const segment = encodeURIComponent;
const noRoute = (_status: number, message: string) => message === "no such route";
const unsupported = { value: null, when: noRoute } as const;
const Answer = Schema.Struct({ brief: Schema.NullOr(PeerTaskBrief) });
const Saved = Schema.Struct({ brief: PeerTaskBrief });
const decodeConflict = Schema.decodeUnknownOption(
  Schema.Struct({ brief: Schema.NullOr(PeerTaskBrief) }),
);

/** The brief changed since the person read it: they see the new one before they try again. */
const conflict = (code: string, details: unknown) => {
  if (code !== "brief_conflict") return undefined;
  const revision = Option.getOrUndefined(decodeConflict(details))?.brief?.revision;
  return {
    conflict: new PeerHubError({
      detail:
        revision === undefined
          ? "The brief changed since you read it. Look at it again, then repeat."
          : `The brief changed since you read it; it is now at revision ${revision}. Look at it again, then repeat.`,
    }),
  };
};

export interface BriefBody {
  readonly expectedRevision: number;
  readonly goal: string;
  readonly checklist: ReadonlyArray<{ readonly text: string; readonly done: boolean }>;
  readonly notes?: string;
  readonly source?: PeerTaskBrief["source"];
}

const path = (project: string, task: string) => `/briefs/${segment(project)}/${segment(task)}`;

/** The endpoints, on the signed-in session; `undefined` from `get` is a Hub without briefs. */
export const briefsHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  get: (workspace: string, project: string, task: string) =>
    client.request(Answer, {
      workspace,
      path: path(project, task),
      unsupported: { value: undefined, when: noRoute },
    }),
  save: (workspace: string, project: string, task: string, body: BriefBody) =>
    client.request(Saved, {
      workspace,
      path: path(project, task),
      method: "PUT",
      body,
      unsupported,
      conflict,
    }),
  unlink: (workspace: string, project: string, task: string, expectedRevision: number) =>
    client.request(Saved, {
      workspace,
      path: `${path(project, task)}/unlink`,
      method: "POST",
      body: { expectedRevision },
      unsupported,
      conflict,
    }),
});
