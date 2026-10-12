// @effect-diagnostics preferSchemaOverJson:off - a view is compared with the last one by its JSON.
/**
 * Ownership: what this computer knows of who owns what in the projects its person is on, as the Hub
 * last said: the owner of each task, each area's and each path pattern's, the patterns where the
 * owner decides, and the owner's calls. It is read from each workspace when the Hub pings
 * `ownership`, `work`, `coord` or `requests` (an accepted request makes its recipient the task's
 * owner), when pings may have been missed (a resync, connecting), and every 30 seconds. Verdicts,
 * notices and `peer status` read it from memory and never wait on the Hub, so a Hub that cannot be
 * reached leaves them the last view; the commands and the app's actions go to the Hub.
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
  /** The project's name, else its id. */
  readonly projectName: string;
  /** The people on the project now, by address in lower case. */
  readonly people: ReadonlyMap<string, string>;
  readonly task: (id: string | undefined) => PeerTask | undefined;
  /** A task as agents say it: its key, else its title, else its id. */
  readonly label: (id: string) => string;
  /** What the workspace calls a person. */
  readonly name: (email: string) => string;
}

/** Who a session's verdicts and notices are for, and what the Hub last said of its project. */
export interface Standing {
  readonly project: PeerOwnershipProject;
  /** The signed-in person, in lower case. */
  readonly person: string;
  /** This computer's id, as the Hub knows it. */
  readonly environment: string;
}

export class Ownership extends Context.Service<
  Ownership,
  {
    /** One project's ownership as the Hub last said, with when; undefined while none was read. */
    readonly project: (workspace: string, project: string) => PeerOwnershipProject | undefined;
    /** What a session's verdicts and notices go by, from memory; undefined while there is none. */
    readonly standing: (session: PeerSessionView) => Standing | undefined;
    readonly directory: (workspace: string, project: string) => Directory;
    /** Every project's ownership read, for the status. */
    readonly status: Effect.Effect<PeerOwnershipStatus>;
    /** Reads a workspace's views soon; a burst of these reads them once. */
    readonly readSoon: (workspace: string) => Effect.Effect<void>;
    /** Reads a workspace's views now (every workspace's without one). */
    readonly refresh: (workspace?: string) => Effect.Effect<void>;
    /** Forgets what was read of one workspace, or of every one: signing out, leaving, turning off. */
    readonly forget: (workspace?: string) => Effect.Effect<void>;
    /** Forgets the views of every workspace but these: the ones the person still belongs to. */
    readonly keep: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
    /** Reads the views now, then as they change and every 30 seconds, until interrupted. */
    readonly follow: Effect.Effect<never>;
    readonly list: (
      input: PeerOwnershipListInput,
    ) => Effect.Effect<PeerOwnershipView, PeerHubError>;
    readonly setTaskOwner: (
      input: PeerOwnershipSetTaskOwnerInput,
    ) => Effect.Effect<PeerOwnershipSetTaskOwnerResult, PeerHubError>;
    readonly setMap: (
      input: PeerOwnershipSetMapInput,
    ) => Effect.Effect<PeerOwnershipSetMapResult, PeerHubError>;
    readonly decide: (
      input: PeerOwnershipDecideInput,
    ) => Effect.Effect<PeerOwnershipCallResult, PeerHubError>;
    readonly withdraw: (input: {
      readonly workspace: string;
      readonly project: string;
      readonly id: string;
    }) => Effect.Effect<PeerOwnershipCallResult, PeerHubError>;
    /** One project's view read from the Hub now, for the command that prints it. */
    readonly read: (
      workspace: string,
      project: string,
    ) => Effect.Effect<PeerOwnershipProject, PeerHubError>;
    /** A session asks the owners of paths; the Hub must know the session, so Peer reports it first. */
    readonly ask: (
      session: PeerSessionView,
      paths: ReadonlyArray<string>,
      reason: string,
    ) => Effect.Effect<PeerOwnershipAskResult, PeerHubError>;
    /** A session takes one of its pending calls back. */
    readonly withdrawCall: (
      session: PeerSessionView,
      id: string,
    ) => Effect.Effect<PeerOwnerCall, PeerHubError>;
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

  /** What follows a change: clients see it, and agents that wait for a decision are looked at. */
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
    const task = (task: string | undefined) => tasks.find((candidate) => candidate.id === task);
    return {
      projectName: found?.name ?? id,
      people: new Map((found?.members ?? []).map(({ email, name }) => [email.toLowerCase(), name])),
      task,
      label: (wanted) => {
        const found = task(wanted);
        return found?.key ?? found?.title ?? wanted;
      },
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

  /** A project of a workspace the person belongs to, before the Hub is asked about it. */
  const member = (workspace: string, id: string) => state.project(workspace, id);

  /** Reads a workspace's views again after the Hub accepted a change, so the next status says so. */
  const changedAt = <A>(workspace: string, result: A) => refresh(workspace).pipe(Effect.as(result));

  const list: Ownership["Service"]["list"] = Effect.fn("Ownership.list")(function* (input) {
    if (input.project !== undefined) yield* member(input.workspace, input.project);
    else if (!(yield* state.workspaces).some((workspace) => workspace.slug === input.workspace))
      return yield* new PeerHubError({ detail: "You are not in that workspace.", refused: true });
    const view = yield* hub.view(input.workspace, input.project);
    if (put(input.workspace, view, input.project)) yield* changedNow;
    return view;
  });

  const setTaskOwner: Ownership["Service"]["setTaskOwner"] = Effect.fn("Ownership.setTaskOwner")(
    function* (input) {
      yield* member(input.workspace, input.project);
      return yield* hub
        .setTaskOwner(input)
        .pipe(Effect.flatMap((result) => changedAt(input.workspace, result)));
    },
  );

  const setMap: Ownership["Service"]["setMap"] = Effect.fn("Ownership.setMap")(function* (input) {
    yield* member(input.workspace, input.project);
    return yield* hub
      .setMap(input)
      .pipe(Effect.flatMap((result) => changedAt(input.workspace, result)));
  });

  const decide: Ownership["Service"]["decide"] = Effect.fn("Ownership.decide")(function* (input) {
    yield* member(input.workspace, input.project);
    const call = yield* hub.decide(
      input.workspace,
      input.project,
      input.id,
      input.decision,
      input.note,
    );
    return yield* changedAt(input.workspace, { call });
  });

  const withdraw: Ownership["Service"]["withdraw"] = Effect.fn("Ownership.withdraw")(
    function* (input) {
      yield* member(input.workspace, input.project);
      const call = yield* hub.withdraw(input.workspace, input.project, input.id);
      return yield* changedAt(input.workspace, { call });
    },
  );

  const readProject: Ownership["Service"]["read"] = Effect.fn("Ownership.read")(
    function* (workspace, id) {
      const view = yield* hub.view(workspace, id);
      if (put(workspace, view, id)) yield* changedNow;
      const found = project(workspace, id);
      return (
        found ??
        (yield* new PeerHubError({ detail: "This project has no ownership here.", refused: true }))
      );
    },
  );

  const ask: Ownership["Service"]["ask"] = Effect.fn("Ownership.ask")(
    function* (session, paths, reason) {
      // The Hub opens a call only for a session it has heard of.
      yield* agents.report(session.workspace).pipe(Effect.ignore);
      const answer = yield* hub.ask(session.workspace, session.project, {
        environment: state.environmentId,
        session: session.id,
        paths: [...paths],
        reason,
      });
      return yield* changedAt(session.workspace, answer);
    },
  );

  const withdrawCall: Ownership["Service"]["withdrawCall"] = Effect.fn("Ownership.withdrawCall")(
    function* (session, id) {
      const call = yield* hub.withdraw(session.workspace, session.project, id, {
        environment: state.environmentId,
        session: session.id,
      });
      return yield* changedAt(session.workspace, call);
    },
  );

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
    setTaskOwner,
    setMap,
    decide,
    withdraw,
    read: readProject,
    ask,
    withdrawCall,
  });
});

export const layer = Layer.effect(Ownership, make);
