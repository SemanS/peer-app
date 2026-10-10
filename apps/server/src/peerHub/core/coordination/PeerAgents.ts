/**
 * PeerAgents: the agent sessions coordination knows on this computer, as plugins reach them.
 *
 * The coordination broker keeps the sessions while coordination is on; PeerCoordination hands it
 * over here as it starts and stops it. While coordination is off, no session is known, every view
 * is empty and no view changes.
 *
 * @module peerHub/core/coordination/PeerAgents
 */
import { PeerHubError, type PeerStaleReads } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as AgentTranscript from "../../agentTranscript.ts";
import type { CoordinationBroker } from "../broker/Broker.ts";
import type { HubCoordView } from "../hub/coordApi.ts";
import {
  CliError,
  PeerPromptStale,
  refused,
  type PeerPromptExpect,
  type PeerSessionView,
  type PeerToolBinding,
} from "../plugin.ts";
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

const isHubError = Schema.is(PeerHubError);
const isPromptStale = Schema.is(PeerPromptStale);
/** How much of the end of a transcript `lastMessage` reads. */
const LAST_MESSAGE_BYTES = 16 * 1024;
const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export class PeerAgents extends Context.Service<
  PeerAgents,
  {
    /** This computer's sessions now. */
    readonly sessions: Effect.Effect<ReadonlyArray<PeerSessionView>>;
    /** Rechecks a previously refused handoff; unknown/ended sessions have no stale inputs. */
    readonly staleReads: (session: string) => Effect.Effect<PeerStaleReads, PeerHubError>;
    readonly bindTools: (input: PeerToolBinding) => Effect.Effect<PeerSessionView, CliError>;
    readonly callTools: (
      session: string,
      command: string,
      args: ReadonlyArray<string>,
      first: boolean,
    ) => Effect.Effect<{ readonly text: string; readonly isError: boolean }, CliError>;
    readonly endTools: (session: string) => Effect.Effect<void>;
    readonly runtimeAgents: Effect.Effect<
      ReadonlyArray<import("@t3tools/contracts").PeerLocalAgent>
    >;
    /**
     * Types a prompt into one of this computer's coordinated runtime agents (`PeerLocalAgent.id`).
     * With `expect`, the text goes in only if the agent is still the session at the turn the caller
     * read and is idle or done: an agent that is gone or has moved on since fails with
     * `PeerPromptStale` and nothing is typed. Without it nothing beyond the agent being live and
     * coordinated is checked.
     */
    readonly promptRuntime: (
      agent: string,
      text: string,
      expect?: PeerPromptExpect,
    ) => Effect.Effect<void, PeerHubError | PeerPromptStale>;
    /**
     * The last words the agent said in the session most recently active in a runtime's pane, read
     * from its Claude Code transcript (the last 16 KiB of it at most). Undefined when no session
     * is known there, its transcript cannot be found or read, or its end holds no words of the
     * agent's, such as a last message longer than that.
     */
    readonly lastMessage: (pane: string) => Effect.Effect<string | undefined>;
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
  const tools = <A>(run: (running: CoordinationBroker) => Promise<A>) =>
    Effect.tryPromise({
      try: () => {
        if (broker === null)
          throw refused(
            "coordination is not running",
            "turn coordination on in Settings, Workspaces.",
          );
        return run(broker);
      },
      catch: (error) =>
        error instanceof CliError
          ? error
          : refused(
              "Peer could not bind this agent",
              "restart the agent in its workspace project.",
            ),
    });

  return PeerAgents.of({
    sessions: ask((running) => running.sessionViews(), []),
    staleReads: (id) =>
      Effect.suspend(() => {
        const session = broker?.sessions.get(id);
        const read = broker?.host.staleReads;
        return !session || !read
          ? Effect.succeed({ fresh: true, stale: [] })
          : Effect.tryPromise({
              try: () => read(session.workspace, session.project, session.id),
              catch: () =>
                new PeerHubError({ detail: "Could not recheck the agent's shared inputs." }),
            });
      }),
    bindTools: (input) => tools((running) => running.bindTools(input)),
    callTools: (session, command, args, first) =>
      tools((running) => running.callTools(session, command, args, first)),
    endTools: (session) => tools((running) => running.endTools(session)).pipe(Effect.ignore),
    runtimeAgents: tools((running) => running.localRuntimeAgents()).pipe(
      Effect.orElseSucceed(() => []),
    ),
    promptRuntime: (id, text, expect) =>
      Effect.tryPromise({
        try: async () => {
          const running = broker;
          const runtime =
            running && (await running.localRuntimeAgents()).find((row) => row.id === id);
          const session = running
            ?.sessionViews()
            .find((row) => row.pane === runtime?.paneId && `herdr:${row.id}` === id);
          // A caller that read the agent earlier asks for that agent, so one that has gone or
          // waits for an answer is not the one it read, rather than a prompt that failed.
          if (expect !== undefined && running && (!runtime || runtime.status === "blocked"))
            throw new PeerPromptStale({ reason: runtime ? "busy" : "gone" });
          if (
            !running ||
            !runtime ||
            !session ||
            running.coordinationLevel(session.id) === "C" ||
            runtime.status === "blocked"
          )
            throw new PeerHubError({
              detail: "That agent no longer coordinates here or waits for an answer.",
            });
          const provider = (await running.plugins()).runtime;
          if (!provider?.prompt || !id.startsWith(provider.prefix))
            throw new PeerHubError({ detail: "This runtime cannot accept that prompt." });
          await running.host.run(provider.prompt(id, text, expect));
        },
        catch: (failure) =>
          isHubError(failure) || isPromptStale(failure)
            ? failure
            : new PeerHubError({
                detail: "The runtime could not confirm the prompt. Read the agent before retrying.",
              }),
      }),
    lastMessage: (pane) =>
      Effect.gen(function* () {
        const hooked = broker?.sessionInPane(pane);
        if (hooked === undefined) return undefined;
        const path = yield* Effect.tryPromise(() =>
          AgentTranscript.findClaudeTranscript(hooked),
        ).pipe(Effect.orElseSucceed(() => null));
        if (path === null) return undefined;
        const lines = yield* Effect.tryPromise(() =>
          AgentTranscript.readTranscriptTail(path, LAST_MESSAGE_BYTES),
        ).pipe(Effect.orElseSucceed(() => []));
        return AgentTranscript.transcriptEntries(lines).findLast((entry) => entry.kind === "text")
          ?.text;
      }),
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
            catch: (failure) =>
              isHubError(failure) ? failure : new PeerHubError({ detail: messageOf(failure) }),
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
