/**
 * The Hub's `test-reports` routes (design D4), below `/v1/workspaces/{slug}/tests`: file the caller's
 * report on a task (`POST`), read every author's latest (`GET`), remove the caller's (`DELETE`), read
 * the summaries, without text, of the reports on the caller's projects (`GET /tests`), and
 * give an unverified item an owner (`PATCH …/{author}/items/{index}`, compare-and-set on `number`).
 *
 * @module peerHub/plugins/test-reports/hub
 */
import {
  PeerHubError,
  PeerTestReport,
  PeerTestReportSummary,
  PeerTestsInherited,
  type PeerTestReportItem,
  type PeerTestReportResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

/** A task of a project, as the routes name it. */
export interface Place {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

/** What a filing sends: the Hub cleans, bounds and numbers it, and completes owners. */
export interface Filing {
  readonly result: PeerTestReportResult;
  readonly summary: string;
  readonly items: ReadonlyArray<PeerTestReportItem>;
  /** The agent session that files and its computer: both, or neither for a person's filing. */
  readonly session?: string;
  readonly environment?: string;
  /** The session's run, which a Hub with runs accepts as proof once the session's row is gone. */
  readonly run?: string;
  readonly commit?: string;
}

const unsupported = {
  value: null,
  when: (_status: number, message: string) => message === "no such route",
};

const Stale = Schema.Struct({ number: Schema.Number, report: Schema.optional(PeerTestReport) });
const decodeStale = Schema.decodeUnknownOption(Stale);

export function hubCalls(client: PeerHubClient.PeerHubClient["Service"]) {
  const path = (p: Place) =>
    `/tests/${encodeURIComponent(p.project)}/${encodeURIComponent(p.task)}`;
  const served = <A>(effect: Effect.Effect<A | null, PeerHubError>) =>
    effect.pipe(
      Effect.filterOrFail(
        (answer): answer is A => answer !== null,
        () =>
          new PeerHubError({ detail: "This Peer Hub cannot keep test reports.", refused: true }),
      ),
    );
  // A Hub before revision 2 of test reports refuses a filing that names a run (400).
  const withRun = ({ run, ...filing }: Filing) =>
    Effect.map(client.features, (features): Filing =>
      run !== undefined && (features["test-reports"] ?? 0) >= 2 ? { ...filing, run } : filing,
    );
  return {
    file: (p: Place, filing: Filing) =>
      withRun(filing).pipe(
        Effect.flatMap((body) =>
          served(
            client.request(Schema.Struct({ report: PeerTestReport, changed: Schema.Boolean }), {
              workspace: p.workspace,
              path: path(p),
              method: "POST",
              body,
              timeoutMs: 4000,
              unsupported,
            }),
          ),
        ),
      ),
    list: (p: Place) =>
      served(
        client.request(Schema.Struct({ reports: Schema.Array(PeerTestReport) }), {
          workspace: p.workspace,
          path: path(p),
          unsupported,
        }),
      ).pipe(Effect.map((answer) => answer.reports)),
    /** Null from a Hub that serves no summaries: the plugin then knows what pings name. */
    summaries: (workspace: string) =>
      client
        .request(
          Schema.Struct({
            summaries: Schema.Array(PeerTestReportSummary.mapFields(Struct.omit(["workspace"]))),
          }),
          { workspace, path: "/tests", unsupported },
        )
        .pipe(Effect.map((answer) => answer?.summaries ?? null)),
    remove: (p: Place) =>
      served(
        client.request(Schema.Struct({ removed: Schema.Boolean }), {
          workspace: p.workspace,
          path: path(p),
          method: "DELETE",
          timeoutMs: 4000,
          unsupported,
        }),
      ).pipe(Effect.map((answer) => answer.removed)),
    /** What the task's dependencies left to it; nothing from a Hub that keeps no such items. */
    inherited: (p: Place) =>
      client
        .request(PeerTestsInherited, {
          workspace: p.workspace,
          path: `${path(p)}/inherited`,
          unsupported,
        })
        .pipe(Effect.map((answer) => answer ?? { items: [], capped: false })),
    /** `stale` when the author filed another report since `number` (409 `stale_report`). */
    setOwner: (
      p: Place,
      author: string,
      index: number,
      body: { readonly number: number; readonly owner: string | null },
    ) =>
      served(
        client.request<
          Schema.Struct<{ report: typeof PeerTestReport }>,
          { readonly stale: typeof Stale.Type } | null
        >(Schema.Struct({ report: PeerTestReport }), {
          workspace: p.workspace,
          path: `${path(p)}/${encodeURIComponent(author)}/items/${index}`,
          method: "PATCH",
          body,
          timeoutMs: 4000,
          unsupported,
          conflict: (code, details) => {
            if (code !== "stale_report") return undefined;
            const stale = decodeStale(details);
            return stale._tag === "Some" ? { stale: stale.value } : undefined;
          },
        }),
      ),
  };
}

export type TestReportsHub = ReturnType<typeof hubCalls>;
