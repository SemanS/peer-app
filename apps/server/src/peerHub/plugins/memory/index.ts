/**
 * The memory plugin: Peer Memory, a project's durable shared findings, contexts and decisions,
 * which the Hub's `memory` feature keeps. It is frozen during the coordination pilot, so a normal
 * build excludes it (`PEER_MEMORY_AVAILABLE`), and a build that includes it lists it as off until
 * the environment's owner turns it on.
 *
 * @module peerHub/plugins/memory
 */
import { PEER_MEMORY_AVAILABLE, PEER_MEMORY_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";

/** The plugin, included in the build or not; tests build both without touching the constant. */
export const makeMemoryPlugin = (options: { readonly available: boolean }) =>
  bindPlugin({
    ...PEER_MEMORY_PLUGIN,
    defaultEnabled: false,
    available: options.available,
    hubFeature: { id: "memory", revision: 1 },
    layer: Layer.empty,
    make: Effect.succeed({} satisfies PeerContributions),
  });

export const MemoryPlugin = makeMemoryPlugin({ available: PEER_MEMORY_AVAILABLE });
