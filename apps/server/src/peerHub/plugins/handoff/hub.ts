import {
  type PeerHandoffDelivery,
  PeerHandoffPackage,
  PeerHandoffSummary,
  PeerHubError,
  type PeerHandoffPlace,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
const unsupported = { value: null, when: (_s: number, m: string) => m === "no such route" };
/** The task's runs a Hub with runs lists in a package (design D4); agents read them as JSON. */
const S = Schema.String;
const Runs = Schema.Array(Schema.Struct({ id: S, agent: S, runtime: S, state: S }));
const Package = Schema.Struct({ ...PeerHandoffPackage.fields, runs: Schema.optional(Runs) });
type Body =
  | {
      environment: string;
      session: string;
      run?: string | undefined;
      delivery?: PeerHandoffDelivery | undefined;
    }
  | Record<string, never>;
/**
 * What a Hub of this `handoff` revision takes: one before 2 refuses a package that names a run
 * (400), one before 3 a delivery.
 */
export function bodyFor(body: Body, handoff: number): Body {
  if (!("session" in body)) return body;
  const { run, delivery, environment, session } = body;
  return {
    environment,
    session,
    ...(run === undefined || handoff < 2 ? {} : { run }),
    ...(delivery === undefined || handoff < 3 ? {} : { delivery }),
  };
}
export function hubCalls(c: PeerHubClient.PeerHubClient["Service"]) {
  const path = (p: PeerHandoffPlace) =>
    `/handoffs/${encodeURIComponent(p.projectId)}/${encodeURIComponent(p.taskId)}`;
  const refusal = new PeerHubError({
    detail: "This Peer Hub cannot store handoff packages.",
    refused: true,
  });
  const supported = <A>(effect: Effect.Effect<A | null, PeerHubError>) =>
    effect.pipe(Effect.flatMap((a) => (a === null ? Effect.fail(refusal) : Effect.succeed(a))));
  return {
    /** Whether the Hub keeps a handoff's delivery (`handoff` 3, as its catalog says). */
    keepsDelivery: Effect.map(c.features, ({ handoff = 0 }) => handoff >= 3),
    compose: (p: PeerHandoffPlace, body: Body) =>
      Effect.flatMap(c.features, ({ handoff = 0 }) =>
        supported(
          c.request(Schema.Struct({ package: Package, changed: Schema.Boolean }), {
            workspace: p.workspace,
            path: path(p),
            method: "POST",
            body: bodyFor(body, handoff),
            timeoutMs: 4000,
            unsupported,
          }),
        ),
      ),
    read: (p: PeerHandoffPlace) =>
      supported(
        c.request(Schema.Struct({ packages: Schema.Array(Package) }), {
          workspace: p.workspace,
          path: path(p),
          unsupported,
        }),
      ).pipe(Effect.map((a) => a.packages)),
    list: (workspace: string) =>
      supported(
        c.request(Schema.Struct({ summaries: Schema.Array(PeerHandoffSummary) }), {
          workspace,
          path: "/handoffs",
          unsupported,
        }),
      ).pipe(Effect.map((a) => a.summaries)),
    remove: (p: PeerHandoffPlace) =>
      supported(
        c.request(Schema.Struct({ removed: Schema.Boolean }), {
          workspace: p.workspace,
          path: path(p),
          method: "DELETE",
          timeoutMs: 4000,
          unsupported,
        }),
      ).pipe(Effect.map((a) => a.removed)),
  };
}
