/**
 * PeerIndex: what an agent chooses its context from, as plugins read it: the other works on its
 * project, and the entries the active index source (knowledge's `.ai`) has for its checkout.
 *
 * The coordination broker keeps the works while coordination is on; PeerCoordination hands it over
 * here as it starts and stops it. While coordination is off there are none, and while no active
 * plugin fills the index source there are no entries.
 *
 * @module peerHub/core/index/PeerIndex
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { CoordinationBroker } from "../../coordinationBroker.ts";
import type { PeerIndexEntry, PeerSessionView } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";

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
    /** The index source's entries for a session's checkout, newest first; none without one. */
    readonly entries: (session: PeerSessionView) => Effect.Effect<ReadonlyArray<PeerIndexEntry>>;
    /**
     * The work a handle names in a project (`task:<id>`, or `project`): a task by its key or id,
     * also one the Hub knows of before Peer's list of tasks does; none when nothing has it.
     */
    readonly scope: (
      workspace: string,
      project: string,
      handle: string,
    ) => Effect.Effect<string | undefined>;
    /** What a work is called: its task's name, or the project's work outside tasks. */
    readonly subject: (workspace: string, project: string, scope: string) => Effect.Effect<string>;
    /** Where a work's shared context is and how to read it; null while nobody wrote it. */
    readonly pointer: (
      workspace: string,
      project: string,
      scope: string,
    ) => Effect.Effect<string | null>;
    /** Hands over the broker coordination runs on, or none once it stops (PeerCoordination does). */
    readonly attach: (broker: CoordinationBroker | null) => Effect.Effect<void>;
  }
>()("t3/peerHub/core/index/PeerIndex") {}

const make = Effect.gen(function* () {
  const plugins = yield* PeerPlugins.PeerPlugins;
  let broker: CoordinationBroker | null = null;
  return PeerIndex.of({
    works: (session) => Effect.sync(() => broker?.worksFor(session.id) ?? []),
    scope: (workspace, project, handle) =>
      Effect.sync(() => broker?.scopeNamed(workspace, project, handle)),
    subject: (workspace, project, scope) =>
      Effect.sync(() => broker?.subjectOf(workspace, project, scope) ?? scope),
    pointer: (workspace, project, scope) =>
      Effect.sync(() => broker?.contextPointer(workspace, project, scope) ?? null),
    entries: (session) =>
      Effect.gen(function* () {
        const source = PeerPlugins.capability(yield* plugins.contributions, "indexSource");
        return source === undefined ? [] : yield* source.entries(session);
      }),
    attach: (next) =>
      Effect.sync(() => {
        broker = next;
      }),
  });
});

export const layer = Layer.effect(PeerIndex, make);
