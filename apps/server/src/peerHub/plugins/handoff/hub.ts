import {
  PeerHandoffPackage,
  PeerHandoffSummary,
  PeerHubError,
  type PeerHandoffPlace,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
const unsupported = {
  value: null,
  when: (_s: number, message: string) => message === "no such route",
};
export function hubCalls(c: PeerHubClient.PeerHubClient["Service"]) {
  const path = (p: PeerHandoffPlace) =>
    `/handoffs/${encodeURIComponent(p.projectId)}/${encodeURIComponent(p.taskId)}`;
  const supported = <A>(effect: Effect.Effect<A | null, PeerHubError>) =>
    effect.pipe(
      Effect.flatMap((a) =>
        a === null
          ? Effect.fail(
              new PeerHubError({
                detail: "This Peer Hub cannot store handoff packages.",
                refused: true,
              }),
            )
          : Effect.succeed(a),
      ),
    );
  return {
    compose: (
      p: PeerHandoffPlace,
      body: { environment: string; session: string } | Record<string, never>,
    ) =>
      supported(
        c.request(Schema.Struct({ package: PeerHandoffPackage, changed: Schema.Boolean }), {
          workspace: p.workspace,
          path: path(p),
          method: "POST",
          body,
          timeoutMs: 4000,
          unsupported,
        }),
      ),
    read: (p: PeerHandoffPlace) =>
      supported(
        c.request(Schema.Struct({ packages: Schema.Array(PeerHandoffPackage) }), {
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
