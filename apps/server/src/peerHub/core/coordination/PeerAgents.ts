/**
 * PeerAgents: the agent sessions coordination knows on this computer, as plugins reach them.
 *
 * The coordination broker keeps the sessions while coordination is on; PeerCoordination hands it
 * over here as it starts and stops it. While coordination is off, no session is known.
 *
 * @module peerHub/core/coordination/PeerAgents
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { CoordinationBroker } from "../../coordinationBroker.ts";

export class PeerAgents extends Context.Service<
  PeerAgents,
  {
    /**
     * The session most recently active in a runtime's pane (herdr's), as its hooks reported it: its
     * native id and the transcript its harness keeps; none when no session there is known.
     */
    readonly inPane: (
      pane: string,
    ) => { readonly id: string; readonly path: string | undefined } | undefined;
    /**
     * How closely Peer follows a session (`<agent>:<native id>`): A while Peer Mod answered for it
     * lately, B through its hooks, C not at all.
     */
    readonly level: (session: string) => "A" | "B" | "C";
    /** Hands over the broker coordination runs on, or none once it stops (PeerCoordination does). */
    readonly attach: (broker: CoordinationBroker | null) => Effect.Effect<void>;
  }
>()("t3/peerHub/core/coordination/PeerAgents") {}

const make = Effect.sync(() => {
  let broker: CoordinationBroker | null = null;
  return PeerAgents.of({
    inPane: (pane) => broker?.sessionInPane(pane),
    level: (session) => broker?.coordinationLevel(session) ?? "C",
    attach: (next) =>
      Effect.sync(() => {
        broker = next;
      }),
  });
});

export const layer = Layer.effect(PeerAgents, make);
