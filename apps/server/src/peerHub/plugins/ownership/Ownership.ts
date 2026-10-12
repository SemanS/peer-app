/**
 * Ownership: what this computer knows of who owns what in the projects its person is on, as the Hub
 * last said (`client/views.ts`). It is read when the Hub pings `ownership`, `work`, `coord` or
 * `requests`, when pings may have been missed (a resync, connecting) and every 30 seconds. Verdicts,
 * notices and `peer status` read it from memory and never wait on the Hub, so a Hub that cannot be
 * reached leaves them the last view; the commands and the apps' actions go to the Hub. The
 * service's interface is what `make` returns, each member described where it is made.
 *
 * @module peerHub/plugins/ownership/Ownership
 */
import { PeerHubError, type PeerTask } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import type { PeerSessionView } from "../../core/plugin.ts";
import { plain } from "../../peerText.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { ownershipHub } from "./client/hub.ts";
import { makeViews, type Standing } from "./client/views.ts";

export type { Standing };

/** How long the views stand without a ping before Peer reads them again. */
const VIEW_INTERVAL = "30 seconds";

/**
 * A project's people and tasks as the workspace's manifest and the Hub's work name them. What it
 * says of them (names, labels) is cleaned for agents' eyes, as other people's words are.
 */
export interface Directory {
  readonly projectName: string;
  /** The people on the project now, by address in lower case, with their names. */
  readonly people: ReadonlyMap<string, string>;
  readonly task: (id: string | undefined) => PeerTask | undefined;
  /** A task as agents say it: its key, else its title, else its id. */
  readonly label: (id: string) => string;
  /** What the workspace calls a person. */
  readonly name: (email: string) => string;
}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const agents = yield* PeerAgents.PeerAgents;
  const hub = ownershipHub(yield* PeerHubClient.PeerHubClient);
  const views = makeViews();
  const changed = yield* Queue.unbounded<string>();
  let generation = 0;

  /** A change: clients see it, and coordination looks at the agents that wait for it. */
  const changedNow = Effect.andThen(status.publish, agents.hubChanged);
  const read = (workspace: string) =>
    Effect.gen(function* () {
      const before = generation;
      const view = yield* hub.view(workspace);
      if (before === generation && views.put(workspace, view)) yield* changedNow;
    }).pipe(Effect.ignore);
  const readAll = Effect.gen(function* () {
    const slugs = (yield* state.workspaces).map((workspace) => workspace.slug);
    for (const workspace of slugs) yield* read(workspace);
    if (views.keep(slugs) > 0) yield* status.publish;
  });
  /** Reads a workspace's view (or one project of it) from the Hub now, and keeps it. */
  const fetch = (workspace: string, project?: string) =>
    hub
      .view(workspace, project)
      .pipe(Effect.tap((view) => (views.put(workspace, view, project) ? changedNow : Effect.void)));
  /** A change of the person's in a project they are on: the Hub is asked, then the view is read again. */
  const act = <A>(workspace: string, project: string, call: Effect.Effect<A, PeerHubError>) =>
    Effect.gen(function* () {
      yield* state.project(workspace, project);
      const result = yield* call;
      yield* read(workspace);
      return result;
    });
  const asker = (session: PeerSessionView) => ({
    environment: state.environmentId,
    session: session.id,
  });

  return {
    /** What a session's verdicts and notices go by; undefined while its view or its person is unknown. */
    standing: (session: PeerSessionView): Standing | undefined => {
      const project = views.project(session.workspace, session.project);
      const person = state.current().persisted.email?.toLowerCase();
      return project === undefined || person === undefined
        ? undefined
        : { project, person, environment: state.environmentId };
    },
    directory: (workspace: string, id: string): Directory => {
      const runtime = state.current();
      const found = runtime.persisted.workspaces
        .find((candidate) => candidate.slug === workspace)
        ?.manifest?.projects.find((candidate) => candidate.id === id);
      const tasks = runtime.work.get(PeerState.projectKey(workspace, id))?.tasks ?? [];
      const task = (wanted: string | undefined) =>
        tasks.find((candidate) => candidate.id === wanted);
      return {
        projectName: plain(found?.name ?? id, 60),
        people: new Map(
          (found?.members ?? []).map(({ email, name }) => [email.toLowerCase(), name]),
        ),
        task,
        label: (wanted) => plain(task(wanted)?.key ?? task(wanted)?.title ?? wanted, 40),
        name: (email) => plain(state.nameOf(workspace, email), 60),
      };
    },
    /** Every project's ownership read, for the status. */
    status: Effect.sync(() => ({ projects: views.all() })),
    /** Reads a workspace soon; a burst of these reads it once. */
    readSoon: (workspace: string) => Queue.offer(changed, workspace).pipe(Effect.asVoid),
    /** Forgets one workspace's view, or every one's: signing out, leaving, turning the plugin off. */
    forget: (workspace?: string) =>
      Effect.gen(function* () {
        generation++;
        views.drop(workspace);
        yield* Queue.clear(changed);
      }),
    /** Forgets the views of every workspace but these, which the person still belongs to. */
    keep: (workspaces: ReadonlyArray<string>) => Effect.sync(() => void views.keep(workspaces)),
    /** Reads the views now, then as they change and every 30 seconds, until interrupted. */
    follow: Effect.gen(function* () {
      yield* readAll;
      while (true) {
        const woken = yield* Queue.take(changed).pipe(Effect.timeoutOption(VIEW_INTERVAL));
        if (Option.isNone(woken)) yield* readAll;
        else {
          yield* Effect.sleep("300 millis");
          for (const workspace of new Set([woken.value, ...(yield* Queue.clear(changed))]))
            yield* read(workspace);
        }
      }
    }),

    // The apps' methods: the person must be on the project before the Hub hears of it.
    list: Effect.fn("Ownership.list")(function* (input: {
      readonly workspace: string;
      readonly project?: string | undefined;
    }) {
      if (input.project !== undefined) yield* state.project(input.workspace, input.project);
      else if (!(yield* state.workspaces).some((workspace) => workspace.slug === input.workspace))
        return yield* new PeerHubError({ detail: "You are not in that workspace.", refused: true });
      return yield* fetch(input.workspace, input.project);
    }),
    setTaskOwner: (input: Parameters<typeof hub.setTaskOwner>[0]) =>
      act(input.workspace, input.project, hub.setTaskOwner(input)),
    setMap: (input: Parameters<typeof hub.setMap>[0]) =>
      act(input.workspace, input.project, hub.setMap(input)),
    decide: (input: {
      readonly workspace: string;
      readonly project: string;
      readonly id: string;
      readonly decision: "accept" | "decline";
      readonly note?: string | undefined;
    }) =>
      act(
        input.workspace,
        input.project,
        hub
          .decide(input.workspace, input.project, input.id, input.decision, input.note)
          .pipe(Effect.map((call) => ({ call }))),
      ),
    withdraw: (input: {
      readonly workspace: string;
      readonly project: string;
      readonly id: string;
    }) =>
      act(
        input.workspace,
        input.project,
        hub
          .withdraw(input.workspace, input.project, input.id)
          .pipe(Effect.map((call) => ({ call }))),
      ),

    // The commands': an ask opens a call only for a session the Hub has heard of, so Peer reports first.
    /** One project's view read from the Hub now, for the command that prints it. */
    read: Effect.fn("Ownership.read")(function* (workspace: string, project: string) {
      yield* fetch(workspace, project);
      return (
        views.project(workspace, project) ??
        (yield* new PeerHubError({ detail: "This project has no ownership here.", refused: true }))
      );
    }),
    ask: (session: PeerSessionView, paths: ReadonlyArray<string>, reason: string) =>
      agents.report(session.workspace).pipe(
        Effect.ignore,
        Effect.andThen(
          act(
            session.workspace,
            session.project,
            hub.ask(session.workspace, session.project, {
              ...asker(session),
              paths: [...paths],
              reason,
            }),
          ),
        ),
      ),
    /** A session takes one of its pending calls back. */
    withdrawCall: (session: PeerSessionView, id: string) =>
      act(
        session.workspace,
        session.project,
        hub.withdraw(session.workspace, session.project, id, asker(session)),
      ),
  };
});

export class Ownership extends Context.Service<Ownership, Effect.Success<typeof make>>()(
  "t3/peerHub/plugins/ownership/Ownership",
) {}

export const layer = Layer.effect(Ownership, make);
