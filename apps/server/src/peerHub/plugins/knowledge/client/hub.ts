/**
 * Knowledge's Hub endpoints (the Hub's `knowledge` feature): a project's knowledge candidates,
 * deciding one, and proposing one Peer read from a shared context.
 *
 * @module peerHub/plugins/knowledge/client/hub
 */
import { PeerKnowledgeCandidate, type PeerKeptAs } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";

const candidatesOf = (project: string, id?: string) =>
  `/candidates/${encodeURIComponent(project)}${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;

/** The endpoints, called on the signed-in session. */
const CandidateWithFutureState = Schema.Struct({
  ...PeerKnowledgeCandidate.fields,
  status: Schema.String,
});
const isKnown = Schema.is(PeerKnowledgeCandidate);
const decodeCandidate = Schema.decodeUnknownSync(PeerKnowledgeCandidate);
export const knowledgeHub = (
  client: PeerHubClient.PeerHubClient["Service"],
  skipped: (count: number) => Effect.Effect<void> = () => Effect.void,
) => ({
  /** A project's knowledge candidates: proposed first, most independent finders first. */
  candidates: (workspace: string, project: string) =>
    client
      .request(Schema.Array(CandidateWithFutureState), {
        workspace,
        path: candidatesOf(project),
        notFound: { value: [] },
      })
      .pipe(
        Effect.flatMap((rows) => {
          const supported = rows.filter(isKnown).map((row) => decodeCandidate(row));
          return rows.length === supported.length
            ? Effect.succeed(supported)
            : skipped(rows.length - supported.length).pipe(Effect.as(supported));
        }),
      ),

  /** A person dismisses a candidate, promotes it (naming the entry it became), or proposes it again. */
  decide: (
    workspace: string,
    project: string,
    id: string,
    status: "proposed" | "dismissed" | "promoted",
    keptAs?: PeerKeptAs,
  ) =>
    client.request(PeerKnowledgeCandidate, {
      workspace,
      path: candidatesOf(project, id),
      method: "POST",
      body: keptAs === undefined ? { status } : { status, keptAs },
    }),

  /** Something a person's Peer proposes for the project, e.g. read from a task's shared context. */
  propose: (
    workspace: string,
    project: string,
    body: {
      readonly text: string;
      readonly kind?: string;
      readonly detail?: string;
      readonly task?: string;
      readonly origin: string;
    },
  ) =>
    client.request(PeerKnowledgeCandidate, {
      workspace,
      path: candidatesOf(project),
      method: "POST",
      body,
    }),
});
