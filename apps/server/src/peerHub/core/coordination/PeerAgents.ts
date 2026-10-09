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

/** What an agent did with the team's work or knowledge, for people to see in Peer. */
export interface PeerAdvice {
  readonly about: "work" | "knowledge";
  /** A work's scope, or `kx:<entry id>`. */
  readonly scope: string;
  readonly name: string;
  /** It read it, asked its agents, a model found it for it, or an entry governs files it changes. */
  readonly how: "read" | "asked" | "found" | "governs";
  readonly why: string;
  readonly entryKind?: string;
  readonly path?: string;
}

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
    /** Reports a workspace's sessions and reads its view again, waiting at most `budgetMs`. */
    readonly sync: (workspace: string, budgetMs: number) => Effect.Effect<void>;
    /** Notes for people in Peer what a session did with the team's work or knowledge. */
    readonly advise: (session: string, advice: PeerAdvice) => Effect.Effect<void>;
    /** A line in the coordination log; a plugin's events start with its id. */
    readonly log: (event: string, fields: Readonly<Record<string, unknown>>) => Effect.Effect<void>;
    /** Hands over the broker coordination runs on, or none once it stops (PeerCoordination does). */
    readonly attach: (broker: CoordinationBroker | null) => Effect.Effect<void>;
  }
>()("t3/peerHub/core/coordination/PeerAgents") {}

const make = Effect.sync(() => {
  let broker: CoordinationBroker | null = null;
  return PeerAgents.of({
    inPane: (pane) => broker?.sessionInPane(pane),
    level: (session) => broker?.coordinationLevel(session) ?? "C",
    sync: (workspace, budgetMs) => {
      const running = broker;
      return running === null
        ? Effect.void
        : Effect.promise(() => running.syncWithin(workspace, budgetMs));
    },
    advise: (session, advice) => Effect.sync(() => broker?.adviseOn(session, advice)),
    log: (event, fields) => Effect.sync(() => broker?.logEvent(event, fields)),
    attach: (next) =>
      Effect.sync(() => {
        broker = next;
      }),
  });
});

export const layer = Layer.effect(PeerAgents, make);
