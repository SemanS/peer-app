// @effect-diagnostics nodeBuiltinImport:off - a policy save's operation id.
/**
 * The Hub's `acceptance` routes (design D4), below `/v1/workspaces/{slug}/acceptance`: the caller's
 * projects' acceptances (`GET`), a lead's acceptance of a task (`POST …/{project}/{task}`) and its
 * withdrawal (`DELETE …/{project}/{task}`), each with an `op` and an optional note. A task that is
 * still open answers `409 not_delivered`; every other refusal fails as the Hub words it. A project's
 * review policy (`GET`/`PUT …/{project}/policy`, `acceptance` revision 2) is read by its members and
 * saved by a lead or an admin from the version read; `409 stale_policy` names the stored one.
 *
 * @module peerHub/plugins/acceptance/client/hub
 */
import * as NodeCrypto from "node:crypto";

import {
  PeerAcceptanceEvent,
  PeerAcceptanceVia,
  PeerHandoffSignals,
  PeerHubError,
  PeerReviewPolicy,
  type PeerAcceptanceInput,
  type PeerReviewPolicyPlace,
  type PeerSetReviewPolicyInput,
  type PeerSetReviewPolicyResult,
  type PeerTaskAcceptance,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";

/** The current acceptance as the Hub keeps it (`Acceptance`, camelCase); `project` and `task` repeat the keys. */
const Current = Schema.Struct({
  by: Schema.String,
  at: Schema.String,
  note: Schema.optional(Schema.String),
  statusThen: Schema.String,
  via: Schema.optional(PeerAcceptanceVia),
});

/**
 * One task's entry of `GET /acceptance`: its current acceptance or null, whether the task was
 * reopened after it, and the history newest first (`seq` is dropped: the times order it).
 */
const Entry = Schema.Struct({
  acceptance: Schema.NullOr(Current),
  beforeReopening: Schema.Boolean,
  history: Schema.Array(PeerAcceptanceEvent),
});
type Entry = typeof Entry.Type;

/** `{ projects: { <project>: { <task>: Entry } }, at }`: tasks with neither are left out. */
const Listed = Schema.Struct({
  projects: Schema.Record(Schema.String, Schema.Record(Schema.String, Entry)),
});
/** A write's answer: the task's current acceptance after it (null once withdrawn). */
const Written = Schema.Struct({ acceptance: Schema.NullOr(Current) });

const unsupported = {
  value: null,
  when: (_status: number, message: string) => message === "no such route",
};

const currentOf = (row: typeof Current.Type) => ({
  by: row.by,
  at: row.at,
  ...(row.note === undefined ? {} : { note: row.note }),
  statusThen: row.statusThen,
  ...(row.via === undefined ? {} : { via: row.via }),
});

/** An entry as the plugin keeps it: the current acceptance or null, and the history oldest first. */
export function taskOf(
  place: { readonly workspace: string; readonly project: string; readonly task: string },
  entry: Entry,
): PeerTaskAcceptance {
  return {
    ...place,
    current: entry.acceptance === null ? null : currentOf(entry.acceptance),
    beforeReopening: entry.acceptance !== null && entry.beforeReopening,
    history: [...entry.history]
      .map(({ kind, by, at, note, via }) => ({
        kind,
        by,
        at,
        ...(note === undefined ? {} : { note }),
        ...(via === undefined ? {} : { via }),
      }))
      .sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export const NOT_DELIVERED =
  "This task is not delivered yet: a lead accepts a task once it is in review or done.";

/** A policy as the Hub answers it; `signals`, `changed` and `replayed` are dropped. */
const policyOf = (row: PeerReviewPolicy): PeerReviewPolicy => ({
  mode: row.mode,
  version: row.version,
  ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
  ...(row.updatedBy === undefined ? {} : { updatedBy: row.updatedBy }),
  ...(row.leadLeft === undefined ? {} : { leadLeft: row.leadLeft }),
});
const decodeStale = Schema.decodeUnknownOption(Schema.Struct({ policy: PeerReviewPolicy }));
const policyPath = (project: string) => `/acceptance/${encodeURIComponent(project)}/policy`;
const newOp = () => NodeCrypto.randomBytes(12).toString("hex");

export function hubCalls(client: PeerHubClient.PeerHubClient["Service"]) {
  /** Whether the Hub keeps review policies, as its catalog says (`acceptance` 2). */
  const keepsPolicy = Effect.map(client.features, ({ acceptance = 0 }) => acceptance >= 2);
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
              : Effect.succeed(answer.acceptance === null ? null : currentOf(answer.acceptance)),
        ),
      );
  return {
    /** Every task with an acceptance or a history on the caller's projects; null from a Hub that serves none. */
    list: (workspace: string) =>
      client
        .request(Listed, { workspace, path: "/acceptance", unsupported })
        .pipe(
          Effect.map((answer) =>
            answer === null
              ? null
              : Object.entries(answer.projects).flatMap(([project, tasks]) =>
                  Object.entries(tasks).map(([task, entry]) =>
                    taskOf({ workspace, project, task }, entry),
                  ),
                ),
          ),
        ),
    keepsPolicy,
    /** A handoff's current signals (`acceptance` 3); null from a Hub that does not read them. */
    signals: (place: {
      readonly workspace: string;
      readonly project: string;
      readonly task: string;
    }) =>
      Effect.gen(function* () {
        const { acceptance = 0 } = yield* client.features;
        if (acceptance < 3) return null;
        return yield* client.request(PeerHandoffSignals, {
          workspace: place.workspace,
          path: `/acceptance/${encodeURIComponent(place.project)}/${encodeURIComponent(place.task)}/signals`,
          unsupported,
        });
      }),
    /** A project's review policy; null from a Hub that keeps none. */
    policy: (place: PeerReviewPolicyPlace) =>
      Effect.gen(function* () {
        if (!(yield* keepsPolicy)) return null;
        const answer = yield* client.request(PeerReviewPolicy, {
          workspace: place.workspace,
          path: policyPath(place.project),
          unsupported,
        });
        return answer === null ? null : policyOf(answer);
      }),
    /**
     * Saves a mode from the version read: `saved`, or `stale` with what is stored now; null from a
     * Hub that keeps none. A member's save fails as the Hub words it (403).
     */
    setPolicy: (input: PeerSetReviewPolicyInput) =>
      Effect.gen(function* () {
        if (!(yield* keepsPolicy)) return null;
        const answer = yield* client.request<
          typeof PeerReviewPolicy,
          { readonly stale: PeerReviewPolicy } | null
        >(PeerReviewPolicy, {
          workspace: input.workspace,
          path: policyPath(input.project),
          method: "PUT",
          body: { mode: input.mode, version: input.version, op: newOp() },
          timeoutMs: 6000,
          unsupported,
          conflict: (code, details) => {
            if (code !== "stale_policy") return undefined;
            const stale = decodeStale(details);
            return stale._tag === "Some" ? { stale: policyOf(stale.value.policy) } : undefined;
          },
        });
        if (answer === null) return null;
        return "stale" in answer
          ? ({ kind: "stale", policy: answer.stale } satisfies PeerSetReviewPolicyResult)
          : ({ kind: "saved", policy: policyOf(answer) } satisfies PeerSetReviewPolicyResult);
      }),
    accept: (input: PeerAcceptanceInput) => write("POST", input),
    withdraw: (input: PeerAcceptanceInput) => write("DELETE", input),
  };
}

export type AcceptanceHub = ReturnType<typeof hubCalls>;
