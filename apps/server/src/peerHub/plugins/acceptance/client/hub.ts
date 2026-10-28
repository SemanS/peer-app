/**
 * The Hub's `acceptance` routes (design D4), below `/v1/workspaces/{slug}/acceptance`: the caller's
 * projects' acceptances (`GET`), a lead's acceptance of a task (`POST …/{project}/{task}`) and its
 * withdrawal (`DELETE …/{project}/{task}`), each with an `op` and an optional note. A task that is
 * still open answers `409 not_delivered`; every other refusal fails as the Hub words it.
 *
 * @module peerHub/plugins/acceptance/client/hub
 */
import {
  PeerAcceptance,
  PeerAcceptanceEvent,
  PeerHubError,
  type PeerAcceptanceInput,
  type PeerTaskAcceptance,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";

/**
 * One task's row as `GET /acceptance` lists it. The current acceptance comes flat on the row (`by`,
 * `at`, `note`, `statusThen`) or as `current`, which is null once it was withdrawn; `history` is
 * absent from a Hub that sends none. Both forms decode, so this app reads the Hub's first release
 * whichever it chose.
 */
const Row = Schema.Struct({
  project: Schema.String,
  task: Schema.String,
  by: Schema.optional(Schema.String),
  at: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  statusThen: Schema.optional(Schema.String),
  current: Schema.optional(Schema.NullOr(PeerAcceptance)),
  history: Schema.optional(Schema.Array(PeerAcceptanceEvent)),
});
type Row = typeof Row.Type;

const Listed = Schema.Struct({ acceptances: Schema.Array(Row) });
/** A write's answer: what it carries is read again from the list, with its history. */
const Written = Schema.Struct({});

const unsupported = {
  value: null,
  when: (_status: number, message: string) => message === "no such route",
};

/** A row as the plugin keeps it: the current acceptance or null, and the history oldest first. */
export function taskOf(workspace: string, row: Row): PeerTaskAcceptance {
  const current =
    row.current !== undefined
      ? row.current
      : row.by !== undefined && row.at !== undefined
        ? {
            by: row.by,
            at: row.at,
            ...(row.note === undefined ? {} : { note: row.note }),
            statusThen: row.statusThen ?? "done",
          }
        : null;
  return {
    workspace,
    project: row.project,
    task: row.task,
    current,
    history: [...(row.history ?? [])].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export const NOT_DELIVERED =
  "This task is not delivered yet: a lead accepts a task once it is in review or done.";

export function hubCalls(client: PeerHubClient.PeerHubClient["Service"]) {
  const write = (method: "POST" | "DELETE", input: PeerAcceptanceInput) =>
    client
      .request<typeof Written, { readonly notDelivered: true } | null>(Written, {
        workspace: input.workspace,
        path: `/acceptance/${encodeURIComponent(input.project)}/${encodeURIComponent(input.task)}`,
        method,
        body: { op: input.op, ...(input.note === undefined ? {} : { note: input.note }) },
        timeoutMs: 6000,
        unsupported,
        conflict: (code) => (code === "not_delivered" ? { notDelivered: true } : undefined),
      })
      .pipe(
        Effect.flatMap((answer) =>
          answer === null
            ? Effect.fail(
                new PeerHubError({
                  detail: "This Peer Hub cannot keep acceptances.",
                  refused: true,
                }),
              )
            : "notDelivered" in answer
              ? Effect.fail(
                  new PeerHubError({
                    code: "not_delivered",
                    detail: NOT_DELIVERED,
                    refused: true,
                    status: 409,
                  }),
                )
              : Effect.void,
        ),
      );
  return {
    /** Every acceptance on the caller's projects; null from a Hub that serves none. */
    list: (workspace: string) =>
      client
        .request(Listed, { workspace, path: "/acceptance", unsupported })
        .pipe(
          Effect.map((answer) =>
            answer === null ? null : answer.acceptances.map((row) => taskOf(workspace, row)),
          ),
        ),
    accept: (input: PeerAcceptanceInput) => write("POST", input),
    withdraw: (input: PeerAcceptanceInput) => write("DELETE", input),
  };
}

export type AcceptanceHub = ReturnType<typeof hubCalls>;
