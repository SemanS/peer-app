/**
 * The agreements plugin: what the agents of two tasks agreed when they settled an overlap is kept
 * by the Hub for that pair of tasks (the Hub's `agreements` feature), and reaches the sessions and
 * the people who were not there. It is active while the signed-in Hub serves that feature and the
 * environment does not force it off with `PEER_AGREEMENTS=off`.
 *
 * @module peerHub/plugins/agreements
 */
import {
  AgreementsRpcGroup,
  PEER_AGREEMENTS_METHODS,
  PEER_AGREEMENTS_PLUGIN,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Agreements from "./Agreements.ts";

export const AgreementsPlugin = bindPlugin({
  ...PEER_AGREEMENTS_PLUGIN,
  id: "agreements",
  forcedOff: () => (Agreements.forcedOff() ? "PEER_AGREEMENTS=off" : undefined),
  layer: Agreements.layer,
  make: Effect.gen(function* () {
    const agreements = yield* Agreements.Agreements;
    return {
      // An agreement settled by this computer's own agent comes back as an echo, and is news to its
      // later sessions: so are the tasks of `work`, which is how an agreement falls due.
      hubChanges: {
        changes: ["agreements", "work", "resync"],
        ownEcho: true,
        onPing: (ping) => agreements.readSoon(ping.workspace, ping.change),
      },
      // Connecting to a workspace's events reads it again, as every listener's `resync` does.
      lifecycle: (event) =>
        event.kind === "synced"
          ? Effect.forEach(event.workspaces, (workspace) => agreements.readSoon(workspace.slug), {
              discard: true,
            })
          : Effect.void,
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? agreements.forget()
          : event.kind === "left-workspace"
            ? agreements.forget(event.workspace)
            : agreements.keep(event.workspaces.map((workspace) => workspace.slug)),
      status: { read: agreements.status },
      rpc: {
        group: AgreementsRpcGroup,
        handlers: (wrap) =>
          AgreementsRpcGroup.of({
            [PEER_AGREEMENTS_METHODS.peerAgreementsView]: (place) =>
              wrap.effect(PEER_AGREEMENTS_METHODS.peerAgreementsView, agreements.view(place)),
            [PEER_AGREEMENTS_METHODS.peerAgreementsClose]: (input) =>
              wrap.effect(PEER_AGREEMENTS_METHODS.peerAgreementsClose, agreements.close(input)),
            [PEER_AGREEMENTS_METHODS.peerAgreementsReopen]: (input) =>
              wrap.effect(PEER_AGREEMENTS_METHODS.peerAgreementsReopen, agreements.reopen(input)),
          }),
      },
      turnOff: agreements.forget(),
      run: agreements.run,
    } satisfies PeerContributions;
  }),
});
