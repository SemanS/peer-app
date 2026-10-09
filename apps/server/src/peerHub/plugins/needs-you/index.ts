import { NeedsYouRpcGroup, PEER_NEEDS_YOU_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { NeedsYou, layer } from "./service.ts";
import { needsYouView } from "./view.ts";

export const NeedsYouPlugin = bindPlugin({
  id: "needs-you",
  title: "Needs You",
  summary: "Decisions waiting for you, with optional Phone alerts.",
  defaultEnabled: true,
  layer,
  make: Effect.gen(function* () {
    const service = yield* NeedsYou;
    return {
      status: { read: service.read },
      statusViews: { "needs-you": needsYouView },
      hooks: {
        handoffRefused: (session, scopes) => service.refuse(session.id, scopes),
        sessionEnding: ({ session }) => service.end(session.id),
      },
      lifecycle: (event) => (event.kind === "signing-out" ? service.stop : Effect.void),
      turnOff: service.stop,
      run: service.run,
      rpc: {
        group: NeedsYouRpcGroup,
        handlers: (wrap) =>
          NeedsYouRpcGroup.of({
            [PEER_NEEDS_YOU_METHODS.peerNeedsYouSetAlerts]: (input) =>
              wrap.effect(
                PEER_NEEDS_YOU_METHODS.peerNeedsYouSetAlerts,
                service.setAlerts(input.enabled),
                { "rpc.aggregate": "peerHub" },
              ),
          }),
      },
    } satisfies PeerContributions;
  }),
});
