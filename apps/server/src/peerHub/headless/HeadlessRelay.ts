/**
 * The app's agent-awareness relay and provider wake queue, absent in Peer Core: no app threads
 * publish activity and no provider adapters drain wake requests, so both take calls and do nothing.
 *
 * @module peerHub/headless/HeadlessRelay
 */
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AgentAwarenessRelay } from "../../relay/AgentAwarenessRelay.ts";

/** `AgentAwarenessRelay` that publishes nothing (no relay link headless). */
export const relayLayer = Layer.succeed(
  AgentAwarenessRelay,
  AgentAwarenessRelay.of({
    publishThread: () => Effect.void,
    publishExternal: () => Effect.void,
    externalCatchUp: () => Effect.void,
    publishingState: Effect.succeed("unlinked"),
    drain: Effect.void,
    requestCatchUp: () => Effect.void,
    start: () => Effect.void,
  }),
);

/** Provider wake requests dropped: Peer Core runs no provider sessions to wake. */
export const continuationLayer = Layer.succeed(
  ProviderContinuationRequests.ProviderContinuationRequests,
  { offer: () => Effect.void, take: Effect.never },
);

export const layer = Layer.merge(relayLayer, continuationLayer);
