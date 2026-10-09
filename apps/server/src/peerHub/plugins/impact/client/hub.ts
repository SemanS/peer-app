import { PeerImpactView, PeerHubError, type PeerImpactFootprint } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { PeerHubClient } from "../../../core/hub/PeerHubClient.ts";
export function impactHub(client: PeerHubClient["Service"]) {
  const unsupported = {
    value: null,
    when: (_status: number, message: string) => message === "no such route",
  };
  return {
    report: (
      workspace: string,
      environment: string,
      footprints: ReadonlyArray<PeerImpactFootprint>,
    ) =>
      client.request(PeerImpactView, {
        workspace,
        path: "/impact",
        method: "PUT",
        body: { environment, footprints },
        unsupported,
      }),
    view: (workspace: string) =>
      client.request(PeerImpactView, { workspace, path: "/impact", unsupported }),
    act: (
      workspace: string,
      project: string,
      id: string,
      action: "dismiss" | "reopen",
      actor?: { session: string; environment: string },
    ) =>
      client
        .request(Schema.Struct({ id: Schema.String, changed: Schema.Boolean }), {
          workspace,
          path: `/impact/${encodeURIComponent(project)}/${encodeURIComponent(id)}/${action}`,
          method: "POST",
          body: actor ?? {},
          unsupported,
        })
        .pipe(
          Effect.flatMap((v) =>
            v === null
              ? Effect.fail(
                  new PeerHubError({
                    detail: "This Peer Hub cannot manage impact overlaps.",
                    refused: true,
                  }),
                )
              : Effect.succeed(v),
          ),
        ),
  };
}
