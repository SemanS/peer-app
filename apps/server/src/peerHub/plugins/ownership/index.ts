/**
 * The ownership plugin: who answers for a task, an area and a path of a project, and the owner's
 * call (the Hub's `ownership` feature). It is active while the signed-in Hub serves that feature
 * and the environment does not force it off with `PEER_OWNERSHIP=off`. This module is its
 * definition; what it contributes to agents and clients is added to `make` as it is built.
 *
 * @module peerHub/plugins/ownership
 */
import { PEER_OWNERSHIP_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";

export const OwnershipPlugin = bindPlugin({
  ...PEER_OWNERSHIP_PLUGIN,
  id: "ownership",
  forcedOff: () => (process.env.PEER_OWNERSHIP === "off" ? "PEER_OWNERSHIP=off" : undefined),
  layer: Layer.empty,
  make: Effect.succeed({} satisfies PeerContributions),
});
