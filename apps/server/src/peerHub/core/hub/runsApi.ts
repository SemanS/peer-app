/**
 * The Hub's `runs` routes (design D4), below `/v1/workspaces/{slug}/runs/{project}`: a project's or
 * a task's runs (`GET`), this Peer's upsert of a run it minted (`PUT`, idempotent, sessions merged by
 * id; a stored run keeps its task, agent, runtime and start), and ending or moving one (`PATCH`);
 * both answer `{ run, changed }`. Refusals keep the Hub's code (`not_your_run`, `person_only`,
 * `wrong_project`; 404 for a task no project has). A Hub without the routes (404 "no such route",
 * or 405) answers `null`, so runs stay on this computer (design D8). Split from `hubApi.ts` as
 * `workApi.ts` is.
 *
 * @module peerHub/core/hub/runsApi
 */
import { PeerRun, type PeerRunOutcome, type PeerRunState } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "./PeerHubClient.ts";

/** A run as `PUT` takes it: D1 without the derived `state`. */
export type RunBody = Omit<PeerRun, "state">;

const Listed = Schema.Struct({ runs: Schema.Array(PeerRun) });
/** What `PUT` and `PATCH` answer, 200 even when a `PUT` created the run. */
const Written = Schema.Struct({ run: PeerRun, changed: Schema.Boolean });

/** A Hub that predates runs has no route: its router says so, unlike a missing task's 404. */
const unsupported = {
  value: null,
  when: (_status: number, message: string) => message === "no such route",
};

const segment = encodeURIComponent;
const runPath = (project: string, run: string) => `/runs/${segment(project)}/${segment(run)}`;

export const runsApi = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  list: (
    workspace: string,
    project: string,
    filter: { readonly task?: string | undefined; readonly state?: PeerRunState | undefined } = {},
  ) => {
    const query = new URLSearchParams({
      ...(filter.task === undefined ? {} : { task: filter.task }),
      ...(filter.state === undefined ? {} : { state: filter.state }),
    }).toString();
    return client.request(Listed, {
      workspace,
      path: `/runs/${segment(project)}${query === "" ? "" : `?${query}`}`,
      unsupported,
    });
  },

  put: (workspace: string, run: RunBody) =>
    client.request(Written, {
      workspace,
      path: runPath(run.project, run.id),
      method: "PUT",
      body: run,
      timeoutMs: 4000,
      unsupported,
    }),

  /**
   * Ends a run (its person, the task's owner, a lead or an admin) or moves it (a person only). Peer
   * calls it as the person, never as an agent session, so `person_only` does not apply to it.
   */
  patch: (
    workspace: string,
    project: string,
    run: string,
    body:
      | { readonly endedAt: string; readonly outcome: PeerRunOutcome }
      | { readonly task: string },
  ) =>
    client.request(Written, {
      workspace,
      path: runPath(project, run),
      method: "PATCH",
      body,
      timeoutMs: 4000,
      unsupported,
    }),
});

export type RunsApi = ReturnType<typeof runsApi>;
