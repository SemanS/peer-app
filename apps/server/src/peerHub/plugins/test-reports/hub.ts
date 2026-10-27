/**
 * The Hub's `test-reports` routes (design D4), below `/v1/workspaces/{slug}/tests`: file the caller's
 * report on a task (`POST`), read every author's latest (`GET`), remove the caller's (`DELETE`), and
 * give an unverified item an owner (`PATCH …/{author}/items/{index}`, compare-and-set on `number`).
 *
 * @module peerHub/plugins/test-reports/hub
 */
import {
  PeerHubError,
  PeerTestReport,
  type PeerTestReportItem,
  type PeerTestReportResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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
  readonly environment: string;
  readonly session?: string;
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
  return {
    file: (p: Place, filing: Filing) =>
      served(
        client.request(Schema.Struct({ report: PeerTestReport, changed: Schema.Boolean }), {
          workspace: p.workspace,
          path: path(p),
          method: "POST",
          body: filing,
          timeoutMs: 4000,
          unsupported,
        }),
      ),
    list: (p: Place) =>
      served(
        client.request(Schema.Struct({ reports: Schema.Array(PeerTestReport) }), {
          workspace: p.workspace,
          path: path(p),
          unsupported,
        }),
      ).pipe(Effect.map((answer) => answer.reports)),
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
