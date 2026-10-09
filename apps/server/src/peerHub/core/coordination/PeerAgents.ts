/**
 * PeerAgents: the agent sessions coordination knows on this computer, as plugins reach them.
 *
 * The coordination broker keeps the sessions while coordination is on; PeerCoordination hands it
 * over here as it starts and stops it. While coordination is off, no session is known, every view
 * is empty and no view changes.
 *
 * @module peerHub/core/coordination/PeerAgents
 */
import { PeerHubError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import type { CoordinationBroker } from "../broker/Broker.ts";
import type { HubCoordView } from "../hub/hubApi.ts";
import type { PeerSessionView } from "../plugin.ts";
import type { CoordinationView } from "./edits.ts";

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

const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export class PeerAgents extends Context.Service<
  PeerAgents,
  {
    /** This computer's sessions now. */
    readonly sessions: Effect.Effect<ReadonlyArray<PeerSessionView>>;
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
    /**
     * Reports a workspace's sessions and reads its view again, waiting until that is done however
     * long it takes: a request that names a session's runtime generation needs the Hub to know it
     * first, which `sync`'s budget does not promise. Fails when the report could not run.
     */
    readonly report: (workspace: string) => Effect.Effect<void, PeerHubError>;
    /** A workspace's sessions (this computer's as they are now) and overlaps, as last read. */
    readonly view: (workspace: string) => Effect.Effect<CoordinationView>;
    /** The workspaces whose view changes, as they change. */
    readonly viewChanges: Stream.Stream<string>;
    /**
     * Each workspace's coordination view as the Hub last sent it, with what the Hub's features add
     * to it (knowledge's waiting candidates).
     */
    readonly hubViews: Effect.Effect<
      ReadonlyArray<{ readonly workspace: string; readonly view: HubCoordView }>
    >;
    /** Something changed at the Hub: every workspace's view is read again within a moment. */
    readonly hubChanged: Effect.Effect<void>;
    /** A session claims a path (`task:<id>` while it asks that task's agents); the Hub hears soon. */
    readonly claim: (session: string, path: string) => Effect.Effect<void>;
    /** A session gives up its claim on a path; the Hub hears soon. */
    readonly release: (session: string, path: string) => Effect.Effect<void>;
    /**
     * A session's note on one of its overlaps; both its agents hear it. The same `op` adds no
     * second note.
     */
    readonly note: (input: {
      readonly session: string;
      readonly overlap: string;
      readonly text: string;
      readonly op: string;
    }) => Effect.Effect<void, PeerHubError>;
    /** Notes for people in Peer what a session did with the team's work or knowledge. */
    readonly advise: (session: string, advice: PeerAdvice) => Effect.Effect<void>;
    /** A line in the coordination log; a plugin's events start with its id. */
    readonly log: (event: string, fields: Readonly<Record<string, unknown>>) => Effect.Effect<void>;
    /** Hands over the broker coordination runs on, or none once it stops (PeerCoordination does). */
    readonly attach: (broker: CoordinationBroker | null) => Effect.Effect<void>;
  }
>()("t3/peerHub/core/coordination/PeerAgents") {}

const make = Effect.gen(function* () {
  const changes = yield* Effect.acquireRelease(PubSub.unbounded<string>(), PubSub.shutdown);
  let broker: CoordinationBroker | null = null;
  let stopHearing: (() => void) | undefined;

  /** What the running broker answers, or `none` while coordination is off. */
  const ask = <A>(run: (running: CoordinationBroker) => A, none: A) =>
    Effect.sync(() => (broker === null ? none : run(broker)));

  return PeerAgents.of({
    sessions: ask((running) => running.sessionViews(), []),
    inPane: (pane) => broker?.sessionInPane(pane),
    level: (session) => broker?.coordinationLevel(session) ?? "C",
    sync: (workspace, budgetMs) => {
      const running = broker;
      return running === null
        ? Effect.void
        : Effect.promise(() => running.syncWithin(workspace, budgetMs));
    },
    report: (workspace) => {
      const running = broker;
      return running === null
        ? Effect.void
        : Effect.tryPromise({
            try: () => running.reportNow(workspace),
            catch: (failure) =>
              new PeerHubError({
                detail: `This computer's sessions could not be reported to the Hub: ${messageOf(failure)}`,
              }),
          });
    },
    view: (workspace) =>
      ask((running) => running.viewOf(workspace), { sessions: [], overlaps: [] }),
    viewChanges: Stream.fromPubSub(changes),
    hubViews: ask((running) => running.hubViews(), []),
    hubChanged: ask((running) => running.hubChanged(), undefined),
    claim: (session, path) => ask((running) => running.claimFor(session, path), undefined),
    release: (session, path) => ask((running) => running.releaseFor(session, path), undefined),
    note: ({ session, overlap, text, op }) => {
      const running = broker;
      return running === null
        ? Effect.void
        : Effect.tryPromise({
            try: () => running.noteFor(session, overlap, text, op),
            catch: (failure) => new PeerHubError({ detail: messageOf(failure) }),
          });
    },
    advise: (session, advice) => ask((running) => running.adviseOn(session, advice), undefined),
    log: (event, fields) => ask((running) => running.logEvent(event, fields), undefined),
    attach: (next) =>
      Effect.sync(() => {
        stopHearing?.();
        stopHearing = next?.onViewChange((workspace) => {
          PubSub.publishUnsafe(changes, workspace);
        });
        broker = next;
      }),
  });
});

export const layer = Layer.effect(PeerAgents, make);
