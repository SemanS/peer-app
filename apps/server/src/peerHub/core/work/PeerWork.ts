/**
 * PeerWork: the work of this environment's workspaces as their Hub keeps it — tasks, every
 * member's threads, and the task each of this computer's threads is on.
 *
 * Peer reports this computer's threads to each workspace and reads everyone's work back: on a
 * timer, after each change made here, and when the Hub says a workspace's work changed. Peer's own
 * threads come from T3's projections; plugins add to the report through their capability slots
 * (a runtime's threads, whether a thread may be watched, a git host's pull requests), so the report
 * holds only what active plugins say. A thread's view (its latest steps) comes from its timeline,
 * or from the runtime that runs it.
 *
 * @module peerHub/core/work/PeerWork
 */
import {
  PeerHubError,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type PeerAgentView,
  type PeerHubAssignThreadInput,
  type PeerHubCreateTaskInput,
  type PeerHubStatus,
  type PeerHubTaskInput,
  type PeerHubUpdateTaskInput,
  type PeerManifest,
  type PeerTask,
  type PeerWorkStatus,
  type PeerWorkThread,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import {
  readHubPolicyState,
  type HubBoundProject,
  type HubSharedInstance,
} from "../../hubPolicy.ts";
import * as Option from "effect/Option";

import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as AgentTranscript from "../../agentTranscript.ts";
import { harnessForDriver } from "../../hubPolicy.ts";
import { nativeRuntimePresent, nativeWorkPullRequests } from "../../workLifecycle.ts";
import type { ReportedThread } from "../hub/hubApi.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import {
  assignedTask,
  projectKey,
  safeId,
  type PersistedState,
  type PersistedWorkspace,
  type ProjectWork,
} from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import { checkoutKind } from "../vcs.ts";
import { shellStatus, taskName, tasksOf, workOf, workspaceReport } from "./report.ts";

/** How plugins find the task a session's branch or title names by key, as hook sessions do. */
export { taskNamed } from "./report.ts";

export interface PeerWorkPass {
  readonly at: number;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly assignment: (thread: string, workspace: string, project: string) => string | undefined;
  readonly projectOf: ReadonlyMap<string, HubBoundProject>;
  readonly sharedInstance: ReadonlyMap<string, HubSharedInstance>;
  readonly turnsOf: (
    thread: string,
  ) => Effect.Effect<
    ProjectionStore.ProjectionRecords<"providerThreads" | "providerTurns">,
    ProjectionStore.ProjectionStoreV2Error
  >;
}

/** The task one of this computer's threads works on. */
export type PeerAssignment = NonNullable<PersistedState["assignments"]>[string];

/** How long the last report's view of Peer threads' provider runtimes stands. */
const NATIVE_RUNTIMES_MS = 180_000;

const hubError = (detail: string) => new PeerHubError({ detail });

const goneView = (agentId: string): PeerAgentView => ({
  agentId,
  title: "",
  status: "unknown",
  gone: true,
});

export class PeerWork extends Context.Service<
  PeerWork,
  {
    readonly latestPass: Effect.Effect<PeerWorkPass | null>;
    /** A project's tasks, as the Hub last said. */
    readonly tasks: (
      workspace: string,
      projectId: string,
    ) => Effect.Effect<ReadonlyArray<PeerTask>>;
    /** A project's threads, every member's, as the Hub last said. */
    readonly threads: (
      workspace: string,
      projectId: string,
    ) => Effect.Effect<ReadonlyArray<PeerWorkThread>>;
    readonly localThreads: Effect.Effect<ReadonlyMap<string, ReadonlyArray<ReportedThread>>>;
    /** A task as people name it (`KRK-335 · DNS errors`), or its id when Peer does not know it. */
    readonly taskName: (
      workspace: string,
      projectId: string,
      task: string,
    ) => Effect.Effect<string>;
    /** The task one of this computer's threads (`peer:…`, `herdr:…`) was put on. */
    readonly assignment: (thread: string) => Effect.Effect<Option.Option<PeerAssignment>>;
    /** Puts one of this computer's threads under a task, or under none. */
    readonly assign: (
      thread: string,
      assignment: PeerAssignment | null,
    ) => Effect.Effect<void, PeerHubError>;
    /**
     * Some of this computer's threads go by new keys (a runtime learned their sessions): what
     * `peer-hub.json` keeps under an old key follows it, the task it is on (unless the new key has
     * one) and whether the team may watch it.
     */
    readonly rename: (
      renames: ReadonlyArray<{ readonly from: string; readonly to: string }>,
    ) => Effect.Effect<void, PeerHubError>;
    /**
     * Reports this computer's threads to each workspace, or only to `only`, and reads everyone's
     * work back. Run it under the state lock.
     */
    readonly refresh: (only?: string) => Effect.Effect<void>;
    /** Reads one workspace's work again, without reporting: the Hub said it changed. */
    readonly readWork: (workspace: string) => Effect.Effect<void, PeerHubError>;
    /**
     * One of this computer's threads as people watch it: its title, state and latest steps, from
     * its timeline (`peer:…`) or from the runtime that runs it; gone when nothing runs it.
     */
    readonly view: (thread: string) => Effect.Effect<PeerAgentView>;
    /**
     * How the provider runtime of a Peer thread's session ran at the last report; null when it did
     * not run, or that report is too old to say.
     */
    readonly runtimeOf: (thread: string, session: string) => PeerWorkStatus | null;
    readonly createTask: (
      input: PeerHubCreateTaskInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly updateTask: (
      input: PeerHubUpdateTaskInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly deleteTask: (input: PeerHubTaskInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Puts one of this computer's threads under a task, or under none, and reports it. */
    readonly assignThread: (
      input: PeerHubAssignThreadInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
  }
>()("t3/peerHub/core/work/PeerWork") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const status = yield* PeerStatus.PeerStatus;
  const projects = yield* ProjectService.ProjectService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* Settings.ServerSettingsService;
  const clock = yield* Clock.Clock;
  const { environmentId, lock } = state;
  const hubApi = client.api;

  /** `<peer thread>/<harness>:<native session>` → how its runtime ran at the last report. */
  const nativeRuntimes = new Map<string, PeerWorkStatus>();
  let nativeRuntimesAt = 0;
  let reportRound = 0;
  const latestPass = yield* Ref.make<PeerWorkPass | null>(null);

  /** This computer's Peer threads in a workspace's checkouts, as its report names them. */
  const peerThreads = (
    workspace: PersistedWorkspace,
    manifest: PeerManifest,
    persisted: PersistedState,
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
    driverOf: (instanceId: string) => string,
  ) =>
    Effect.gen(function* () {
      // T3 project id → workspace project id, for the threads running here.
      const roots = new Map<string, { projectId: string; repositoryId: string; jj: boolean }>();
      for (const project of manifest.projects) {
        if (!safeId(project.id)) continue;
        for (const repo of project.repositories) {
          if (!safeId(repo.id)) continue;
          const t3 = yield* projects
            .getByWorkspaceRoot(state.checkoutPath(persisted, workspace.slug, project.id, repo.id))
            .pipe(Effect.orElseSucceed(() => Option.none()));
          if (Option.isSome(t3))
            roots.set(t3.value.id, {
              projectId: project.id,
              repositoryId: repo.id,
              jj:
                (yield* Effect.promise(() => checkoutKind(t3.value.workspaceRoot)))?.kind === "jj",
            });
        }
      }
      const reported: ReportedThread[] = [];
      for (const thread of threads) {
        const place = roots.get(thread.projectId);
        if (place === undefined) continue;
        const { projectId, repositoryId } = place;
        const id = `peer:${thread.id}`;
        const task = assignedTask(persisted, id, workspace.slug, projectId);
        const harness = harnessForDriver(driverOf(thread.providerInstanceId));
        const records = yield* projections
          .getThreadRecords(thread.id, ["providerThreads", "providerSessions"])
          .pipe(Effect.option);
        const provider = Option.isSome(records)
          ? records.value.providerThreads.find((p) => p.id === thread.activeProviderThreadId)
          : undefined;
        const nativeId = provider?.nativeThreadRef?.nativeId;
        const runtimePresent = nativeRuntimePresent(
          provider,
          Option.isSome(records) ? records.value.providerSessions : [],
        );
        const nativeHarness =
          provider === undefined ? undefined : harnessForDriver(provider.driver);
        if (runtimePresent && nativeId !== undefined && nativeHarness !== undefined) {
          nativeRuntimes.set(`${id}/${nativeHarness}:${nativeId}`, shellStatus(thread));
        }
        const repo = manifest.projects
          .find((p) => p.id === projectId)
          ?.repositories.find((r) => r.id === repositoryId);
        const pullRequests =
          repo === undefined
            ? undefined
            : nativeWorkPullRequests(repo.url, thread.branch, thread.pullRequests ?? []);
        reported.push({
          id,
          project: projectId,
          repository: repositoryId,
          ...(task === undefined ? {} : { task }),
          title: thread.title.slice(0, 300),
          status: shellStatus(thread),
          ...(harness === undefined ? {} : { harness }),
          ...(thread.branch === null ? {} : { branch: thread.branch }),
          ...(place.jj ? { vcs: "jj" as const } : {}),
          ...(thread.branchRenamedFrom == null
            ? {}
            : { branchRenamedFrom: thread.branchRenamedFrom }),
          source: "peer",
          runtimePresent,
          ...(pullRequests === undefined ? {} : { pullRequests }),
        });
      }
      return reported;
    });

  const refresh: PeerWork["Service"]["refresh"] = (only) =>
    Effect.gen(function* () {
      const signedIn = yield* client.session.pipe(Effect.option);
      if (Option.isNone(signedIn)) return;
      const { hubUrl, session } = signedIn.value;
      const currentSettings = yield* settings.getSettings.pipe(Effect.option);
      const driverOf = (instanceId: string) =>
        Option.match(currentSettings, {
          onNone: () => instanceId,
          onSome: (value) =>
            value.providerInstances[instanceId as ProviderInstanceId]?.driver ?? instanceId,
        });
      const shell = yield* projections.getShellSnapshot({ location: "active" }).pipe(Effect.option);
      const threads = Option.isSome(shell) ? shell.value.threads : [];
      if (Option.isSome(shell)) {
        nativeRuntimes.clear();
        nativeRuntimesAt = DateTime.toEpochMillis(yield* DateTime.now);
      }
      const providers = yield* plugins.contributions;
      const runtime = PeerPlugins.capability(providers, "runtime");
      const gitHost = PeerPlugins.capability(providers, "gitHost");
      const threadReports = providers.flatMap((provider) =>
        provider.threadReport === undefined ? [] : [provider.threadReport],
      );
      const observable = (thread: string) =>
        threadReports.some((report) => report(thread).observable === true);

      const before = yield* state.read;
      // Reporting to one workspace leaves what Peer read of the others as it is.
      const work = new Map<string, ProjectWork>(
        only === undefined ? [] : [...before.work].filter(([key]) => !key.startsWith(`${only}/`)),
      );
      for (const workspace of before.persisted.workspaces) {
        const manifest = workspace.manifest;
        if (manifest === null || (only !== undefined && workspace.slug !== only)) continue;
        const s = yield* state.read;
        const live = [
          ...(yield* peerThreads(workspace, manifest, s.persisted, threads, driverOf)),
          ...(runtime === undefined ? [] : yield* runtime.threads(workspace.slug)),
        ];
        const report = workspaceReport({
          workspace: workspace.slug,
          projects: manifest.projects,
          persisted: s.persisted,
          environmentId,
          previous: before.work,
          live,
          observable,
          gitHost,
          round: reportRound,
        });
        // Consumers of local facts must not depend on this report reaching the Hub.
        yield* state.updateRuntime((s) => ({
          ...s,
          localThreads: new Map(s.localThreads).set(workspace.slug, report),
        }));
        yield* hubApi
          .reportThreads(hubUrl, session, workspace.slug, {
            environment: environmentId,
            threads: report,
          })
          .pipe(Effect.ignoreCause({ log: true }));

        const fetched = yield* hubApi.work(hubUrl, session, workspace.slug).pipe(Effect.option);
        if (Option.isNone(fetched)) {
          // Keep the last good view of a workspace the hub did not answer for.
          for (const [key, value] of before.work) {
            if (key.startsWith(`${workspace.slug}/`)) work.set(key, value);
          }
          continue;
        }
        for (const [key, value] of workOf(workspace.slug, fetched.value)) work.set(key, value);
      }
      reportRound += 1;
      yield* state.updateRuntime((current) => ({ ...current, work }));
      const policy = readHubPolicyState();
      yield* Ref.set(latestPass, {
        at: clock.currentTimeMillisUnsafe(),
        threads,
        assignment: (thread, workspace, project) =>
          assignedTask(before.persisted, thread, workspace, project),
        projectOf: new Map(policy?.projects),
        sharedInstance: new Map(policy?.sharedInstances),
        turnsOf: (thread) =>
          projections.getThreadRecords(ThreadId.make(thread), ["providerThreads", "providerTurns"]),
      });
    });

  const readWork: PeerWork["Service"]["readWork"] = (slug) =>
    Effect.gen(function* () {
      const { hubUrl, session } = yield* client.session;
      const fetched = yield* hubApi.work(hubUrl, session, slug);
      yield* state.updateRuntime((current) => {
        const work = new Map([...current.work].filter(([key]) => !key.startsWith(`${slug}/`)));
        for (const [key, value] of workOf(slug, fetched)) work.set(key, value);
        return { ...current, work };
      });
    }).pipe(lock.withPermits(1));

  /** One of this computer's Peer threads as a view: its latest steps, from its own timeline. */
  const peerThreadView = (key: string, threadId: ThreadId) =>
    Effect.gen(function* () {
      const shell = yield* projections.getThreadShell(threadId);
      if (shell === null) return goneView(key);
      const head = yield* projections.getTimelinePage(threadId, { view: "activity", limit: 0 });
      const page = yield* projections.getTimelinePage(threadId, {
        view: "activity",
        limit: 80,
        afterPosition: Math.max(-1, head.totalItems - 81),
      });
      return {
        agentId: key,
        title: shell.title,
        status: shellStatus(shell),
        gone: false,
        entries: AgentTranscript.timelineEntries(page.items),
      } satisfies PeerAgentView;
    }).pipe(Effect.orElseSucceed(() => goneView(key)));

  const view: PeerWork["Service"]["view"] = (thread) =>
    thread.startsWith("peer:")
      ? peerThreadView(thread, ThreadId.make(thread.slice("peer:".length)))
      : Effect.flatMap(plugins.contributions, (providers) => {
          const runtime = PeerPlugins.capability(providers, "runtime");
          return runtime !== undefined && thread.startsWith(runtime.prefix)
            ? runtime.view(thread)
            : Effect.succeed(goneView(thread));
        });

  const assign: PeerWork["Service"]["assign"] = (thread, assignment) =>
    state.updatePersisted((p) => {
      const { [thread]: _previous, ...assignments } = p.assignments ?? {};
      return {
        ...p,
        assignments: assignment === null ? assignments : { ...assignments, [thread]: assignment },
      };
    });

  const rename: PeerWork["Service"]["rename"] = (renames) =>
    Effect.gen(function* () {
      const { persisted } = yield* state.read;
      const assignments = persisted.assignments ?? {};
      const shared = persisted.sharedThreads ?? [];
      const moves = renames.flatMap(({ from, to }) => {
        const assignment = assignments[from];
        return from !== to && assignment !== undefined && assignments[to] === undefined
          ? [{ from, to, assignment }]
          : [];
      });
      const renamed = new Map(
        renames.flatMap(({ from, to }) =>
          from !== to && shared.includes(from) ? [[from, to] as const] : [],
        ),
      );
      if (moves.length === 0 && renamed.size === 0) return;
      yield* state.updatePersisted((p) => {
        const next = { ...p.assignments };
        for (const move of moves) {
          delete next[move.from];
          next[move.to] = move.assignment;
        }
        return {
          ...p,
          assignments: next,
          sharedThreads: (p.sharedThreads ?? []).map((key) => renamed.get(key) ?? key),
        };
      });
    });

  const createTask: PeerWork["Service"]["createTask"] = Effect.fn("PeerWork.createTask")(function* (
    input,
  ) {
    const { hubUrl, session } = yield* client.session;
    yield* state.project(input.workspace, input.projectId);
    const key = input.key?.trim();
    const area = input.area?.trim();
    yield* hubApi.createTask(hubUrl, session, input.workspace, input.projectId, {
      title: input.title,
      ...(key ? { key } : {}),
      ...(area ? { area } : {}),
    });
    yield* refresh();
    return yield* status.publish;
  }, lock.withPermits(1));

  const updateTask: PeerWork["Service"]["updateTask"] = Effect.fn("PeerWork.updateTask")(function* (
    input,
  ) {
    const { hubUrl, session } = yield* client.session;
    yield* state.project(input.workspace, input.projectId);
    yield* hubApi.updateTask(hubUrl, session, input.workspace, input.projectId, input.taskId, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.area === undefined ? {} : { area: input.area }),
      ...(input.status === undefined ? {} : { status: input.status }),
    });
    yield* refresh();
    return yield* status.publish;
  }, lock.withPermits(1));

  const deleteTask: PeerWork["Service"]["deleteTask"] = Effect.fn("PeerWork.deleteTask")(function* (
    input,
  ) {
    const { hubUrl, session } = yield* client.session;
    yield* state.project(input.workspace, input.projectId);
    yield* hubApi.deleteTask(hubUrl, session, input.workspace, input.projectId, input.taskId);
    // Threads that worked on it go back to the project's unsorted work.
    yield* state.updatePersisted((p) => ({
      ...p,
      assignments: Object.fromEntries(
        Object.entries(p.assignments ?? {}).filter(
          ([, a]) =>
            !(
              a.workspace === input.workspace &&
              a.project === input.projectId &&
              a.task === input.taskId
            ),
        ),
      ),
    }));
    yield* refresh();
    return yield* status.publish;
  }, lock.withPermits(1));

  const assignThread: PeerWork["Service"]["assignThread"] = Effect.fn("PeerWork.assignThread")(
    function* (input) {
      yield* state.project(input.workspace, input.projectId);
      const now = yield* state.read;
      const key = projectKey(input.workspace, input.projectId);
      const ownsRetained = now.work
        .get(key)
        ?.threads.some(
          (thread) =>
            thread.id === input.thread &&
            thread.email === now.persisted.email &&
            thread.environment === environmentId,
        );
      const runtime = PeerPlugins.capability(yield* plugins.contributions, "runtime");
      const runsHere =
        input.thread.startsWith("peer:") ||
        (runtime !== undefined && input.thread.startsWith(runtime.prefix));
      if (!runsHere && !(input.thread.startsWith("retained:") && ownsRetained)) {
        return yield* hubError("Only this computer's work can be placed.");
      }
      yield* assign(
        input.thread,
        input.taskId === null
          ? null
          : { workspace: input.workspace, project: input.projectId, task: input.taskId },
      );
      // Apply a placement to saved work as well, including clearing an old assignment.
      // Mark it open until the hub derives delivery from the newly selected task.
      yield* state.updateRuntime((current) => {
        const project = current.work.get(key);
        if (project === undefined) return current;
        const work = new Map(current.work);
        work.set(key, {
          ...project,
          threads: project.threads.map((thread) => {
            if (
              thread.id !== input.thread ||
              thread.email !== current.persisted.email ||
              thread.environment !== environmentId
            )
              return thread;
            const { task: _task, ...rest } = thread;
            return {
              ...rest,
              delivery: "open",
              ...(input.taskId === null ? {} : { task: input.taskId }),
            };
          }),
        });
        return { ...current, work };
      });
      yield* refresh();
      return yield* status.publish;
    },
    lock.withPermits(1),
  );

  return PeerWork.of({
    localThreads: state.read.pipe(Effect.map((s) => s.localThreads)),
    latestPass: Ref.get(latestPass),
    tasks: (workspace, projectId) =>
      state.read.pipe(Effect.map((s) => tasksOf(s.work, workspace, projectId))),
    threads: (workspace, projectId) =>
      state.read.pipe(
        Effect.map((s) => s.work.get(projectKey(workspace, projectId))?.threads ?? []),
      ),
    taskName: (workspace, projectId, task) =>
      state.read.pipe(Effect.map((s) => taskName(s.work, workspace, projectId, task))),
    assignment: (thread) =>
      state.read.pipe(Effect.map((s) => Option.fromNullishOr(s.persisted.assignments?.[thread]))),
    assign,
    rename,
    refresh,
    readWork,
    view,
    runtimeOf: (thread, session) =>
      clock.currentTimeMillisUnsafe() - nativeRuntimesAt < NATIVE_RUNTIMES_MS
        ? (nativeRuntimes.get(`${thread}/${session}`) ?? null)
        : null,
    createTask,
    updateTask,
    deleteTask,
    assignThread,
  });
});

export const layer = Layer.effect(PeerWork, make);
