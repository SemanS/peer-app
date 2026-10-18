/**
 * The changes feature's Hub endpoints (the Hub's `changes` feature, camelCase JSON below
 * `/v1/workspaces/{slug}`), called on the signed-in session: a session's report, its withdrawal and
 * the members' read. A Hub without the route answers `no such route`, which reads as null. A report
 * whose seq is behind the stored one comes back as `{ stale }` with the Hub's seq, so the caller
 * continues from it; every other refusal fails as a `PeerHubError` (`refused` set for a 4xx, which
 * retrying will not fix).
 *
 * @module peerHub/plugins/changes/hub
 */
import { HubChanges, type ChangeReport } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const segment = encodeURIComponent;

const unsupported = {
  value: null,
  when: (_status: number, message: string) => message === "no such route",
} as const;

const Stored = Schema.Struct({ seq: Schema.Number });
const Withdrawn = Schema.Struct({ withdrawn: Schema.Number });
const StaleDetails = Schema.Struct({ seq: Schema.Number });
const staleSeq = Schema.decodeUnknownOption(StaleDetails);

export const changesHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /** A session's changes in flight; `stale` is the seq the Hub holds when the report's was not higher. */
  report: (workspace: string, project: string, body: ChangeReport) =>
    client.request(Stored, {
      workspace,
      path: `/changes/${segment(project)}`,
      method: "PUT",
      body,
      unsupported,
      conflict: (code, details) => {
        if (code !== "stale_seq") return undefined;
        const stored = staleSeq(details);
        return { stale: stored._tag === "Some" ? stored.value.seq : body.seq };
      },
    }),

  /** A session ended: its rows go. */
  withdraw: (workspace: string, project: string, session: string) =>
    client.request(Withdrawn, {
      workspace,
      path: "/changes/withdraw",
      method: "POST",
      body: { project, session },
      unsupported,
      timeoutMs: 5_000,
    }),

  /** The changes in flight of a workspace's projects, or of one project. */
  view: (workspace: string, project?: string, timeoutMs?: number) =>
    client.request(HubChanges, {
      workspace,
      path: project === undefined ? "/changes" : `/changes?project=${segment(project)}`,
      unsupported,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
});
