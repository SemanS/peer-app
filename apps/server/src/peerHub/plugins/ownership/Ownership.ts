// @effect-diagnostics preferSchemaOverJson:off - a view is compared with the last one by its JSON.
/**
 * Ownership: what this computer knows of who owns what in the projects its person is on, as the Hub
 * last said: the owner of each task, each area's and each path pattern's, the patterns where the
 * owner decides, and the owner's calls. It is read from each workspace when the Hub pings
 * `ownership`, `work`, `coord` or `requests` (an accepted request makes its recipient a task's
 * owner), when pings may have been missed (a resync, connecting) and every 30 seconds. Verdicts,
 * notices and `peer status` read it from memory and never wait on the Hub, so a Hub that cannot be
 * reached leaves them the last view; the commands and the apps' actions go to the Hub.
 *
 * @module peerHub/plugins/ownership/Ownership
 */
import {
  PeerHubError,
  type PeerOwnerCall,
  type PeerOwnershipAskResult,
  type PeerOwnershipCallResult,
  type PeerOwnershipDecideInput,
  type PeerOwnershipListInput,
  type PeerOwnershipProject,
  type PeerOwnershipSetMapInput,
  type PeerOwnershipSetMapResult,
  type PeerOwnershipSetTaskOwnerInput,
  type PeerOwnershipSetTaskOwnerResult,
  type PeerOwnershipStatus,
  type PeerOwnershipView,
  type PeerTask,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import type { PeerSessionView } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { ownershipHub } from "./client/hub.ts";

/** How long the views stand without a ping before Peer reads them again. */
const VIEW_INTERVAL = "30 seconds";

/** A project's people and tasks as the workspace's manifest and the Hub's work name them. */
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

/** What a session's verdicts and notices go by: the Hub's last view of its project, and who and where it is. */
export interface Standing {
  readonly project: PeerOwnershipProject;
  /** The signed-in person, in lower case. */
  readonly person: string;
  /** This computer's id, as the Hub knows it. */
  readonly environment: string;
}

type Failing<A> = Effect.Effect<A, PeerHubError>;

export class Ownership extends Context.Service<
  Ownership,
  {
    /** One project's ownership as the Hub last said, with when; undefined while none was read. */
    readonly project: (workspace: string, project: string) => PeerOwnershipProject | undefined;
    /** From memory; undefined while the project's view is unknown or nobody is signed in. */
    readonly standing: (session: PeerSessionView) => Standing | undefined;
    readonly directory: (workspace: string, project: string) => Directory;
    /** Every project's ownership read, for the status. */
    readonly status: Effect.Effect<PeerOwnershipStatus>;
    /** Reads a workspace soon; a burst of these reads it once. */
    readonly readSoon: (workspace: string) => Effect.Effect<void>;
    /** Reads a workspace now (every workspace without one). */
    readonly refresh: (workspace?: string) => Effect.Effect<void>;
    /** Forgets one workspace's view, or every one's: signing out, leaving, turning the plugin off. */
    readonly forget: (workspace?: string) => Effect.Effect<void>;
    /** Forgets the views of every workspace but these, which the person still belongs to. */
    readonly keep: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
    /** Reads the views now, then as they change and every 30 seconds, until interrupted. */
    readonly follow: Effect.Effect<never>;
    readonly list: (input: PeerOwnershipListInput) => Failing<PeerOwnershipView>;
    readonly setTaskOwner: (
      input: PeerOwnershipSetTaskOwnerInput,
    ) => Failing<PeerOwnershipSetTaskOwnerResult>;
    readonly setMap: (input: PeerOwnershipSetMapInput) => Failing<PeerOwnershipSetMapResult>;
    readonly decide: (input: PeerOwnershipDecideInput) => Failing<PeerOwnershipCallResult>;
    readonly withdraw: (input: {
      readonly workspace: string;
      readonly project: string;
      readonly id: string;
    }) => Failing<PeerOwnershipCallResult>;
    /** One project's view read from the Hub now, for the command that prints it. */
    readonly read: (workspace: string, project: string) => Failing<PeerOwnershipProject>;
    /** A session asks the owners of paths; the Hub must know the session, so Peer reports it first. */
    readonly ask: (
      session: PeerSessionView,
      paths: ReadonlyArray<string>,
      reason: string,
    ) => Failing<PeerOwnershipAskResult>;
    /** A session takes one of its pending calls back. */
    readonly withdrawCall: (session: PeerSessionView, id: string) => Failing<PeerOwnerCall>;
  }
>()("t3/peerHub/plugins/ownership/Ownership") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const agents = yield* PeerAgents.PeerAgents;
  const hub = ownershipHub(yield* PeerHubClient.PeerHubClient);
  const entries = new Map<string, PeerOwnershipView>();
  const changed = yield* Queue.unbounded<string>();
  let generation = 0;

  const project: Ownership["Service"]["project"] = (workspace, id) => {
    const view = entries.get(workspace);
    const found =
      view !== undefined && Object.hasOwn(view.projects, id) ? view.projects[id] : undefined;
    return view === undefined || found === undefined
      ? undefined
      : { workspace, project: id, at: view.at, ...found };
  };

  /** Keeps a workspace's view (or one project of it); whether what it says of its projects changed. */
  const put = (workspace: string, view: PeerOwnershipView, only?: string) => {
    const before = entries.get(workspace);
    const next: PeerOwnershipView =
      only === undefined || before === undefined || !Object.hasOwn(view.projects, only)
        ? view
        : { at: view.at, projects: { ...before.projects, [only]: view.projects[only]! } };
    entries.set(workspace, next);
    return JSON.stringify(before?.projects) !== JSON.stringify(next.projects);
  };

  /** What follows a change: clients see it, and coordination looks at the agents that wait for it. */
  const changedNow = Effect.andThen(status.publish, agents.hubChanged);

  const read = (workspace: string) =>
    Effect.gen(function* () {
      const before = generation;
      const view = yield* hub.view(workspace);
      if (before === generation && put(workspace, view)) yield* changedNow;
    }).pipe(Effect.ignore);

  const keep: Ownership["Service"]["keep"] = (workspaces) =>
    Effect.sync(() => {
      for (const workspace of entries.keys())
        if (!workspaces.includes(workspace)) entries.delete(workspace);
    });

  const readAll = Effect.gen(function* () {
    const slugs = (yield* state.workspaces).map((workspace) => workspace.slug);
    for (const workspace of slugs) yield* read(workspace);
    const known = entries.size;
    yield* keep(slugs);
    if (entries.size !== known) yield* status.publish;
  });

  const refresh: Ownership["Service"]["refresh"] = (workspace) =>
    workspace === undefined ? readAll : read(workspace);

  const follow: Ownership["Service"]["follow"] = Effect.gen(function* () {
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
  });

  const forget: Ownership["Service"]["forget"] = (workspace) =>
    Effect.gen(function* () {
      generation++;
      if (workspace === undefined) entries.clear();
      else entries.delete(workspace);
      yield* Queue.clear(changed);
    });

  const directory: Ownership["Service"]["directory"] = (workspace, id) => {
    const runtime = state.current();
    const found = runtime.persisted.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.manifest?.projects.find((candidate) => candidate.id === id);
    const tasks = runtime.work.get(PeerState.projectKey(workspace, id))?.tasks ?? [];
    const task = (wanted: string | undefined) => tasks.find((candidate) => candidate.id === wanted);
    return {
      projectName: found?.name ?? id,
      people: new Map((found?.members ?? []).map(({ email, name }) => [email.toLowerCase(), name])),
      task,
      label: (wanted) => task(wanted)?.key ?? task(wanted)?.title ?? wanted,
      name: (email) => state.nameOf(workspace, email),
    };
  };

  const standing: Ownership["Service"]["standing"] = (session) => {
    const view = project(session.workspace, session.project);
    const person = state.current().persisted.email?.toLowerCase();
    return view === undefined || person === undefined
      ? undefined
      : { project: view, person, environment: state.environmentId };
  };

  /** A change of the person's in a project they are on: the Hub is asked, then the view is read again. */
  const act = <A>(workspace: string, id: string, call: Failing<A>) =>
    Effect.gen(function* () {
      yield* state.project(workspace, id);
      const result = yield* call;
      yield* refresh(workspace);
      return result;
    });

  const list: Ownership["Service"]["list"] = Effect.fn("Ownership.list")(function* (input) {
    if (input.project !== undefined) yield* state.project(input.workspace, input.project);
    else if (!(yield* state.workspaces).some((workspace) => workspace.slug === input.workspace))
      return yield* new PeerHubError({ detail: "You are not in that workspace.", refused: true });
    const view = yield* hub.view(input.workspace, input.project);
    if (put(input.workspace, view, input.project)) yield* changedNow;
    return view;
  });

  const readProject: Ownership["Service"]["read"] = Effect.fn("Ownership.read")(
    function* (workspace, id) {
      const view = yield* hub.view(workspace, id);
      if (put(workspace, view, id)) yield* changedNow;
      return (
        project(workspace, id) ??
        (yield* new PeerHubError({ detail: "This project has no ownership here.", refused: true }))
      );
    },
  );

  const agent = (session: PeerSessionView) => ({
    environment: state.environmentId,
    session: session.id,
  });

  return Ownership.of({
    project,
    standing,
    directory,
    status: Effect.sync(() => ({
      projects: [...entries].flatMap(([workspace, view]) =>
        Object.keys(view.projects).flatMap((id) => project(workspace, id) ?? []),
      ),
    })),
    readSoon: (workspace) => Queue.offer(changed, workspace).pipe(Effect.asVoid),
    refresh,
    forget,
    keep,
    follow,
    list,
    read: readProject,
    setTaskOwner: (input) =>
      act(input.workspace, input.project, hub.setTaskOwner(input)).pipe(
        Effect.withSpan("Ownership.setTaskOwner"),
      ),
    setMap: (input) =>
      act(input.workspace, input.project, hub.setMap(input)).pipe(
        Effect.withSpan("Ownership.setMap"),
      ),
    decide: (input) =>
      act(
        input.workspace,
        input.project,
        hub.decide(input.workspace, input.project, input.id, input.decision, input.note).pipe(
          Effect.map((call) => ({ call })),
          Effect.tap(() =>
            agents.log("ownership.call", {
              outcome: input.decision === "accept" ? "accepted" : "declined",
            }),
          ),
        ),
      ).pipe(Effect.withSpan("Ownership.decide")),
    withdraw: (input) =>
      act(
        input.workspace,
        input.project,
        hub
          .withdraw(input.workspace, input.project, input.id)
          .pipe(Effect.map((call) => ({ call }))),
      ).pipe(Effect.withSpan("Ownership.withdraw")),
    ask: (session, paths, reason) =>
      agents.report(session.workspace).pipe(
        // The Hub opens a call only for a session it has heard of.
        Effect.ignore,
        Effect.andThen(
          act(
            session.workspace,
            session.project,
            hub.ask(session.workspace, session.project, {
              ...agent(session),
              paths: [...paths],
              reason,
            }),
          ),
        ),
      ),
    withdrawCall: (session, id) =>
      act(
        session.workspace,
        session.project,
        hub.withdraw(session.workspace, session.project, id, agent(session)),
      ),
  });
});

export const layer = Layer.effect(Ownership, make);
