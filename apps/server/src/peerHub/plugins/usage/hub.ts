import {
  type PeerHubError,
  PeerUsageOverview,
  PeerUsageSharing,
  type PeerUsageOverviewInput,
  type PeerUsageReportInput,
  type PeerUsageSetSharingInput,
  type PeerUsageSharingInput,
  type PeerUsageUnsupported,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { isMissingRoute } from "../../core/plugin.ts";

const UNSUPPORTED: PeerUsageUnsupported = { unsupported: true };
/** False for a report that removed a row, which changes nothing that follows. */
const Stored = Schema.Struct({ stored: Schema.optional(Schema.Boolean) });

/**
 * A Hub without the feature has no such route. The Hub's own 404 (a workspace or project the person
 * cannot see) has a code and stays an error, or a refusal would read as "this Hub needs an update".
 */
const orUnsupported = <A, R>(call: Effect.Effect<A, PeerHubError, R>) =>
  call.pipe(
    Effect.catchIf(
      (error) => isMissingRoute(error) || error.status === 405,
      () => Effect.succeed(UNSUPPORTED),
    ),
  );

/** What became of a report the Hub answered. A refusal outside these stays a `PeerHubError`. */
export type UsageReportOutcome =
  /** Kept, or, with empty rows, the computer's row removed. */
  | "stored"
  /** The kept report's `rev` is as new: send again on the next pass with a higher one. */
  | "stale"
  /** Sharing is off: nothing was stored, and nothing more should be sent. */
  | "not-shared"
  /** The Hub has no usage feature. */
  | "unsupported";

export const usageHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  overview: ({ workspace, days, project }: PeerUsageOverviewInput) => {
    const query = new URLSearchParams({ days: String(days) });
    if (project !== undefined) query.set("project", project);
    return orUnsupported(
      client.request(PeerUsageOverview, { workspace, path: `/usage/overview?${query}` }),
    );
  },

  sharing: ({ workspace }: PeerUsageSharingInput) =>
    orUnsupported(client.request(PeerUsageSharing, { workspace, path: "/usage/sharing" })),

  setSharing: ({ workspace, sharing }: PeerUsageSetSharingInput) =>
    orUnsupported(
      client.request(PeerUsageSharing, {
        workspace,
        path: "/usage/sharing",
        method: "PUT",
        body: { sharing },
      }),
    ),

  /** `PUT /usage/reports/{project}/{day}`. The body is exactly what the Hub's bounds allow. */
  report: ({ workspace, project, day, environment, rev, rows }: PeerUsageReportInput) =>
    client
      .request<typeof Stored, "stale" | "not-shared">(Stored, {
        workspace,
        path: `/usage/reports/${encodeURIComponent(project)}/${day}`,
        method: "PUT",
        body: { environment, rev, rows },
        conflict: (code) => (code === "stale_rollup" ? "stale" : undefined),
        rejected: (status, code) =>
          status === 403 && code === "usage_not_shared" ? "not-shared" : undefined,
      })
      .pipe(
        orUnsupported,
        Effect.map((answer): UsageReportOutcome => {
          if (typeof answer === "string") return answer;
          return "unsupported" in answer ? "unsupported" : "stored";
        }),
      ),
});
