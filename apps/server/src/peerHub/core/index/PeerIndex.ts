/**
 * PeerIndex: what an agent chooses its context from, as plugins read it: the other works on its
 * project, and the entries of the project's `.ai` that stand in its checkout.
 *
 * The coordination broker keeps the index while coordination is on; PeerCoordination hands it over
 * here as it starts and stops it. While coordination is off, the index is empty.
 *
 * @module peerHub/core/index/PeerIndex
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { CoordinationBroker } from "../../coordinationBroker.ts";
import type { PeerIndexEntry, PeerSessionView } from "../plugin.ts";

/** Another work on a session's project, as its index shows it. */
export interface PeerIndexWork {
  /** `task:<id>`, or `project` for the work outside tasks. */
  readonly scope: string;
  /** What agents type for it in `peer context` and `peer ask`: its task's key, else its id. */
  readonly handle: string;
  /** How people name it, e.g. `VL1 · Speakers can be named`. */
  readonly name: string;
  /** The agents at work on it, each described with what it does now. */
  readonly agents: ReadonlyArray<string>;
  /** Where the work stands, in its keeper's words. */
  readonly gist: string | undefined;
  /** What its agents were asked and say they do. */
  readonly labels: ReadonlyArray<string>;
  /** What its shared context says, as this computer keeps it. */
  readonly text: string | undefined;
}

export class PeerIndex extends Context.Service<
  PeerIndex,
  {
    /** The other works on a session's project, those with agents at work on them first. */
    readonly works: (session: PeerSessionView) => Effect.Effect<ReadonlyArray<PeerIndexWork>>;
    /** The entries of the project's `.ai` that stand in a session's checkout, newest first. */
    readonly entries: (session: PeerSessionView) => Effect.Effect<ReadonlyArray<PeerIndexEntry>>;
    /** Hands over the broker coordination runs on, or none once it stops (PeerCoordination does). */
    readonly attach: (broker: CoordinationBroker | null) => Effect.Effect<void>;
  }
>()("t3/peerHub/core/index/PeerIndex") {}

const make = Effect.sync(() => {
  let broker: CoordinationBroker | null = null;
  return PeerIndex.of({
    works: (session) => Effect.sync(() => broker?.worksFor(session.id) ?? []),
    entries: (session) => {
      const running = broker;
      return running === null
        ? Effect.succeed([])
        : Effect.promise(() => running.entriesFor(session.id));
    },
    attach: (next) =>
      Effect.sync(() => {
        broker = next;
      }),
  });
});

export const layer = Layer.effect(PeerIndex, make);
