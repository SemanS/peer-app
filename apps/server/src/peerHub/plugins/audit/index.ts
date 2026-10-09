import { AuditRpcGroup, PEER_AUDIT_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { auditHub } from "./hub.ts";

export const AuditPlugin = bindPlugin({
  id: "audit",
  title: "Audit log",
  summary: "Read workspace access and configuration history as an administrator.",
  defaultEnabled: true,
  // The route reports unsupported for older Hubs, so administrators see how to enable recording.
  layer: Layer.empty,
  make: Effect.gen(function* () {
    const hub = auditHub(yield* PeerHubClient.PeerHubClient);
    return {
      rpc: {
        group: AuditRpcGroup,
        handlers: (wrap) =>
          AuditRpcGroup.of({
            [PEER_AUDIT_METHODS.peerAuditList]: (input) =>
              wrap.effect(PEER_AUDIT_METHODS.peerAuditList, hub.list(input), {
                "rpc.aggregate": "peerHub",
              }),
          }),
      },
    } satisfies PeerContributions;
  }),
});
