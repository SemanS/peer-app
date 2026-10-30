// @effect-diagnostics nodeBuiltinImport:off globalDate:off - where a review's own checkout goes, and the RFC 3339 times the Hub's rows carry.
/**
 * Roles: what this computer knows of the session roles in the projects its person is on (design
 * D2), as the Hub last said, and the threads its person started as reviews. Both are kept in the
 * plugin's `pluginData`, so a review session's deny holds from memory across Peer's restarts and
 * while the Hub cannot be reached. The Hub's rows are read when it pings `roles.changed` or `coord`,
 * after a resync and every minute; the commands and the apps' actions go to the Hub. The interface
 * is what `make` returns, each member described there.
 *
 * @module peerHub/plugins/roles/Roles
 */
import * as NodePath from "node:path";

import {
  PeerHubError,
  PeerRolesProject,
  PeerRolesThread,
  type PeerRoleRow,
  type PeerRolesClearInput,
  type PeerRolesSetInput,
  type PeerRolesStartReviewInput,
  type PeerRolesStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";

import type { PeerSessionView, ReportedSession } from "../../core/plugin.ts";
import { isSafeGitRef } from "../../gitSafety.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { rolesHub } from "./hub.ts";
import { reviewPrompt } from "./text.ts";

/** How long the rows stand without a ping before Peer reads them again. */
const READ_INTERVAL = "60 seconds";

/** A session of a thread started as a review, so clearing the thread clears its sessions' rows. */
const Bound = Schema.Struct({ session: Schema.String, thread: Schema.String });

/** The plugin's `pluginData`: the Hub's rows as last read, the review threads and their sessions. */
const RolesData = Schema.Struct({
  projects: Schema.Array(PeerRolesProject),
  threads: Schema.Array(PeerRolesThread),
  bound: Schema.Array(Bound),
});
type RolesData = typeof RolesData.Type;

/** What the plugin keeps per session (`session.local("roles")`). */
export interface Local {
  /** The role the agent took itself (`peer role review`), and when, before the Hub's rows say it. */
  role: string | undefined;
  at: number;
  /** Files it changed through the shell and has not reverted; told once each. */
  readonly outstanding: Set<string>;
  /** Whether the Hub's row says its files changed. */
  flagged: boolean;
  /** What it was told, where core keeps no told set for it. */
  readonly told: Set<string>;
}

export const localOf = (session: PeerSessionView) =>
  session.local<Local>("roles", () => ({
    role: undefined,
    at: 0,
    outstanding: new Set(),
    flagged: false,
    told: new Set(),
  }));

type Job =
  | { readonly kind: "read"; readonly workspace: string }
  | {
      readonly kind: "changed";
      readonly workspace: string;
      readonly project: string;
      readonly session: string;
      readonly changed: boolean;
    };

const failure = (detail: string) => new PeerHubError({ detail, refused: true });
const iso = (ms: number) => new Date(ms).toISOString();

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const agents = yield* PeerAgents.PeerAgents;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const work = yield* PeerWork.PeerWork;
  const hub = rolesHub(yield* PeerHubClient.PeerHubClient);
  const stored = state.pluginData("roles", RolesData);
  let data: RolesData = Option.getOrElse(yield* stored.read, () => ({
    projects: [],
    threads: [],
    bound: [],
  }));
  const jobs = yield* Queue.unbounded<Job>();

  const save = (next: RolesData) =>
    Effect.suspend(() => {
      data = next;
      return stored.update(() => next).pipe(Effect.ignore, Effect.andThen(status.publish));
    });
  const projectOf = (workspace: string, project: string) =>
    data.projects.find((view) => view.workspace === workspace && view.project === project);
  const withProject = (view: PeerRolesProject): RolesData => ({
    ...data,
    projects: [
      ...data.projects.filter((p) => p.workspace !== view.workspace || p.project !== view.project),
      view,
    ],
  });
  /** The project's rows with `row` in place of the session's, or without the session's. */
  const withRow = (workspace: string, project: string, session: string, row?: PeerRoleRow) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const current = projectOf(workspace, project);
      const roles = (current?.roles ?? []).filter((r) => r.session !== session);
      // A row the Hub dropped is known gone now; one it took is known only once read.
      const at = row === undefined ? iso(now) : (current?.at ?? iso(0));
      return withProject({ workspace, project, at, roles: row ? [...roles, row] : roles });
    });

  /** Reads one project's rows from the Hub and keeps them. */
  const read = (workspace: string, project: string) =>
    Effect.gen(function* () {
      const at = iso(yield* Clock.currentTimeMillis);
      const roles = yield* hub.list(workspace, project);
      yield* save(withProject({ workspace, project, at, roles }));
      return projectOf(workspace, project)!;
    });
  /** The projects of a workspace the person is on, by its manifest. */
  const projectsOf = (workspace: string) =>
    state
      .current()
      .persisted.workspaces.find((candidate) => candidate.slug === workspace)
      ?.manifest?.projects.map((project) => project.id) ?? [];
  const readWorkspace = (workspace: string) =>
    Effect.forEach(
      projectsOf(workspace),
      (project) => read(workspace, project).pipe(Effect.ignore),
      {
        discard: true,
      },
    ).pipe(Effect.andThen(bindPending(workspace)));

  /**
   * The review thread a session belongs to. A herdr agent's session never learns its thread (only
   * a Peer thread's does), so a review started in herdr is known by the run the session joined.
   */
  const threadOf = (session: PeerSessionView) =>
    data.threads.find(
      (candidate) =>
        candidate.thread === session.thread ||
        (candidate.run !== undefined && candidate.run === session.run),
    );

  /** What the role of a session is, from memory: the Hub's row, its review thread, what it took. */
  const roleOf = (session: PeerSessionView): string | undefined => {
    const view = projectOf(session.workspace, session.project);
    const row = view?.roles.find((candidate) => candidate.session === session.id);
    if (row !== undefined) return row.role;
    const thread = threadOf(session);
    if (thread !== undefined) return thread.role;
    const own = localOf(session);
    // The agent's own role stands until a read of the Hub after it no longer lists it.
    return own.role !== undefined && (view === undefined || Date.parse(view.at) <= own.at)
      ? own.role
      : undefined;
  };

  const put = (session: PeerSessionView, role: string, setBy: "person" | "agent") =>
    Effect.gen(function* () {
      yield* agents.report(session.workspace).pipe(Effect.ignore);
      yield* hub.put(session.workspace, session.project, session.id, {
        role,
        environment: state.environmentId,
        setBy,
        ...(session.run === undefined ? {} : { run: session.run }),
      });
      const row: PeerRoleRow = {
        session: session.id,
        role,
        email: state.current().persisted.email ?? "",
        environment: state.environmentId,
        setBy,
        at: iso(yield* Clock.currentTimeMillis),
      };
      yield* save(yield* withRow(session.workspace, session.project, session.id, row));
    });

  /** A session of a review thread takes the role on the Hub once it reports (the thread's person set it). */
  const bind = (session: PeerSessionView) =>
    Effect.gen(function* () {
      const thread = threadOf(session);
      if (thread === undefined) return;
      const has = projectOf(session.workspace, session.project)?.roles.some(
        (row) => row.session === session.id,
      );
      if (has !== true) yield* put(session, thread.role, "person");
      if (!data.bound.some((b) => b.session === session.id))
        yield* save({
          ...data,
          bound: [...data.bound, { session: session.id, thread: thread.thread }],
        });
    });
  /** The live sessions of review threads in a workspace that the Hub has no row of yet. */
  const bindPending = (workspace: string) =>
    agents.sessions.pipe(
      Effect.flatMap((sessions) =>
        Effect.forEach(
          sessions.filter((session) => session.workspace === workspace),
          (session) => bind(session).pipe(Effect.ignore),
          { discard: true },
        ),
      ),
    );

  const liveOf = (thread: string) =>
    agents.sessions.pipe(
      Effect.map((sessions) => sessions.filter((s) => threadOf(s)?.thread === thread)),
    );

  return {
    roleOf,
    /** The Hub's row of a session as last read. */
    rowOf: (session: PeerSessionView) =>
      projectOf(session.workspace, session.project)?.roles.find(
        (row) => row.session === session.id,
      ),
    status: Effect.sync((): PeerRolesStatus => ({
      projects: data.projects,
      threads: data.threads,
    })),
    /** A session starts: one of a review thread takes its role on the Hub, in the background. */
    started: (session: PeerSessionView) =>
      threadOf(session) !== undefined
        ? Queue.offer(jobs, { kind: "read", workspace: session.workspace }).pipe(Effect.asVoid)
        : Effect.void,
    /** The session's files changed through the shell, or it reverted them: the Hub's row says so. */
    markChanged: (session: PeerSessionView, changed: boolean) =>
      Queue.offer(jobs, {
        kind: "changed",
        workspace: session.workspace,
        project: session.project,
        session: session.id,
        changed,
      }).pipe(Effect.asVoid),
    /** Reads a workspace soon; a burst reads it once. This computer's own coordination reports are no news. */
    readSoon: (workspace: string, ping?: { change: string; origin: string | null }) =>
      ping?.origin === state.environmentId && ping.change === "coord"
        ? Effect.void
        : Queue.offer(jobs, { kind: "read", workspace }).pipe(Effect.asVoid),
    /** Forgets one workspace's rows and threads, or every one's: signing out, leaving, turning off. */
    forget: (workspace?: string) =>
      Queue.clear(jobs).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            const keep = <A extends { readonly workspace: string }>(rows: ReadonlyArray<A>) =>
              workspace === undefined ? [] : rows.filter((row) => row.workspace !== workspace);
            const threads = keep(data.threads);
            return save({
              projects: keep(data.projects),
              threads,
              bound: data.bound.filter((b) => threads.some((t) => t.thread === b.thread)),
            });
          }),
        ),
      ),
    /** Forgets every workspace's but these, which the person still belongs to. */
    keep: (workspaces: ReadonlyArray<string>) =>
      Effect.suspend(() => {
        const threads = data.threads.filter((t) => workspaces.includes(t.workspace));
        return save({
          projects: data.projects.filter((p) => workspaces.includes(p.workspace)),
          threads,
          bound: data.bound.filter((b) => threads.some((t) => t.thread === b.thread)),
        });
      }),
    /** Reads the rows now, then as pings come and every minute, and patches rows, until interrupted. */
    follow: Effect.gen(function* () {
      const readAll = Effect.gen(function* () {
        for (const workspace of yield* state.workspaces) yield* readWorkspace(workspace.slug);
      });
      yield* readAll;
      while (true) {
        const woken = yield* Queue.take(jobs).pipe(Effect.timeoutOption(READ_INTERVAL));
        if (Option.isNone(woken)) yield* readAll;
        else {
          const job = woken.value;
          const more = yield* Queue.clear(jobs);
          for (const next of [job, ...more]) {
            if (next.kind === "changed")
              yield* hub
                .changed(next.workspace, next.project, next.session, next.changed)
                .pipe(Effect.ignore);
          }
          for (const workspace of new Set([job, ...more].map((next) => next.workspace)))
            yield* readWorkspace(workspace);
        }
      }
    }),

    // The commands' and the apps' methods. The person must be on the project first.
    /** The agent takes the role itself. A refusal leaves it none; no answer leaves the deny on. */
    take: (session: PeerSessionView, role: string) =>
      Effect.gen(function* () {
        const own = localOf(session);
        own.role = role;
        own.at = yield* Clock.currentTimeMillis;
        yield* put(session, role, "agent").pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (error.refused === true) own.role = undefined;
            }),
          ),
        );
      }),
    list: Effect.fn("Roles.list")(function* (input: { workspace: string; project: string }) {
      yield* state.project(input.workspace, input.project);
      return yield* read(input.workspace, input.project);
    }),
    set: Effect.fn("Roles.set")(function* (input: PeerRolesSetInput) {
      yield* state.project(input.workspace, input.project);
      const { workspace, project, role } = input;
      if ((input.session === undefined) === (input.thread === undefined))
        return yield* failure("Name one session or one thread.");
      if (input.thread !== undefined) {
        const thread = input.thread;
        const at = iso(yield* Clock.currentTimeMillis);
        yield* save({
          ...data,
          threads: [
            ...data.threads.filter((t) => t.thread !== thread),
            { thread, workspace, project, role, at },
          ],
        });
        for (const session of yield* liveOf(thread)) yield* bind(session);
      } else {
        const session = (yield* agents.sessions).find((s) => s.id === input.session);
        if (session === undefined || session.workspace !== workspace || session.project !== project)
          return yield* failure("That agent session is not running on this computer.");
        yield* put(session, role, "person");
      }
      return yield* read(workspace, project).pipe(
        Effect.orElseSucceed(() => projectOf(workspace, project)!),
      );
    }),
    clear: Effect.fn("Roles.clear")(function* (input: PeerRolesClearInput) {
      yield* state.project(input.workspace, input.project);
      const { workspace, project } = input;
      if ((input.session === undefined) === (input.thread === undefined))
        return yield* failure("Name one session or one thread.");
      const ofThread = input.thread === undefined ? [] : yield* liveOf(input.thread);
      const sessions = new Set([
        ...(input.session === undefined ? [] : [input.session]),
        ...ofThread.map((s) => s.id),
        ...data.bound.filter((b) => b.thread === input.thread).map((b) => b.session),
      ]);
      const live = yield* agents.sessions;
      for (const session of sessions) {
        const run =
          projectOf(workspace, project)?.roles.find((row) => row.session === session)?.run ??
          live.find((s) => s.id === session)?.run;
        yield* hub.clear(workspace, project, session, run);
        yield* save(yield* withRow(workspace, project, session));
      }
      for (const session of live) if (sessions.has(session.id)) localOf(session).role = undefined;
      yield* save({
        ...data,
        threads: data.threads.filter((t) => t.thread !== input.thread),
        bound: data.bound.filter((b) => !sessions.has(b.session)),
      });
      return yield* read(workspace, project).pipe(
        Effect.orElseSucceed(() => projectOf(workspace, project)!),
      );
    }),
    /**
     * Starts an agent on a task in its own checkout, through the task launcher, with the review
     * prompt or the one a plugin gives (`reviewStarter`); the thread's sessions take the role
     * `review`. Core's checks of a start apply.
     */
    /**
     * A review session reports no files and no claims: the Hub pairs those into overlaps, and an
     * overlap wakes the other agent, so a question would cost the author's person a turn.
     */
    reportSessions: (_workspace: string, reported: ReadonlyArray<ReportedSession>) =>
      Effect.map(agents.sessions, (live) =>
        reported.map((session) => {
          const view = live.find((candidate) => candidate.id === session.id);
          return view !== undefined && roleOf(view) === "review"
            ? { ...session, files: [], claims: [] }
            : session;
        }),
      ),
    reviewRuns: (workspace: string, project: string) =>
      Effect.sync(
        (): ReadonlySet<string> =>
          new Set(
            [
              ...data.threads.filter(
                (row) => row.workspace === workspace && row.project === project,
              ),
              ...(projectOf(workspace, project)?.roles ?? []),
            ].flatMap((row) => (row.role === "review" && row.run !== undefined ? [row.run] : [])),
          ),
      ),
    startReview: Effect.fn("Roles.startReview")(function* (
      input: PeerRolesStartReviewInput & { readonly prompt?: string },
    ) {
      const { workspace, project } = yield* state.project(input.workspace, input.projectId);
      const task = (yield* work.tasks(workspace.slug, project.id)).find(
        (candidate) => candidate.id === input.taskId,
      );
      if (task === undefined || task.status === "done")
        return yield* failure("Select an open task in this project first.");
      const repository = project.repositories.find((r) => r.id === input.repositoryId);
      if (repository === undefined)
        return yield* failure("That repository does not belong to this project.");
      if (input.baseBranch !== undefined && !isSafeGitRef(input.baseBranch))
        return yield* failure("That branch name is not a safe Git ref.");
      if (project.capacity.personal !== "any")
        return yield* failure(
          "This project needs an approved commercial or shared provider. Start a Peer thread with an allowed provider instead.",
        );
      const launcher = yield* plugins.require("taskLauncher");
      const unavailable = yield* launcher.unavailable;
      if (unavailable !== null) return yield* failure(unavailable);
      const checkout = state.checkoutPath(
        (yield* state.read).persisted,
        workspace.slug,
        project.id,
        repository.id,
      );
      // The review agent works in a run of its own on the task, as one startAgent starts does.
      const { run, started } = yield* work.launchRun(
        {
          workspace: workspace.slug,
          project: project.id,
          task: task.id,
          agent: input.harness,
          runtime: "herdr",
        },
        (env) =>
          launcher.launch({
            checkout,
            baseBranch: input.baseBranch ?? repository.branch,
            worktrees: NodePath.join(
              state.workspaceRoot,
              ".worktrees",
              workspace.slug,
              project.id,
              repository.id,
            ),
            task,
            harness: input.harness,
            prompt: input.prompt ?? reviewPrompt(task),
            env,
          }),
      );
      const at = iso(yield* Clock.currentTimeMillis);
      yield* save({
        ...data,
        threads: [
          ...data.threads.filter((t) => t.thread !== started.threadKey),
          {
            thread: started.threadKey,
            run,
            workspace: workspace.slug,
            project: project.id,
            role: "review",
            at,
          },
        ],
      });
      yield* work.refresh().pipe(state.lock.withPermits(1));
      yield* status.publish;
      return {
        thread: started.threadKey,
        run,
        paneId: started.paneId,
        terminalId: started.terminalId,
        ...(started.promptError === undefined ? {} : { promptError: started.promptError }),
      };
    }),
  };
});

export class Roles extends Context.Service<Roles, Effect.Success<typeof make>>()(
  "t3/peerHub/plugins/roles/Roles",
) {}

export const layer = Layer.effect(Roles, make);
