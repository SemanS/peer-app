/**
 * MemoryRuntime: binds memory's operations to the agent runtime that asks for them, so an agent
 * can only act as itself. An agent session coordination knows (its hooks reported it) is bound by
 * its native id; a Peer thread's live runtime calling memory's MCP tools is bound to its agent
 * session, or to one the app runs for it while its thread runs. The app-run ones are carried in
 * every coordination report, so the Hub knows their runtime generations.
 *
 * Its `authLayer` gives memory the signed-in identity and the checkouts it may read knowledge from.
 *
 * @module peerHub/plugins/memory/MemoryRuntime
 */
import {
  PeerHubError,
  type PeerHubMemoryExecuteInput,
  type PeerHubMemoryProjectInput,
  type PeerMemoryProjection,
  type PeerMemoryReceipt,
  type PeerMemoryReceiptInput,
  type PeerMemoryWriteResult,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerSessionView, ReportedSession } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { assignedTask, safeId } from "../../core/state/PeerState.ts";
import * as MemoryCli from "./MemoryCli.ts";
import * as MemoryService from "./MemoryService.ts";
import { MemoryAuth, MemoryError } from "./MemoryTransport.ts";

const hubError = (detail: string) => new PeerHubError({ detail });
/** A memory failure as Peer's requests and tools report it. */
export const hubFailure = (error: { readonly detail: string }) => hubError(error.detail);

/** A receipt as a runtime gives it; the host binds the session, environment and generation. */
type RuntimeReceipt = Omit<
  PeerMemoryReceiptInput,
  "sessionId" | "environmentId" | "runtimeGeneration" | "runtimeProjectId"
> & { readonly workspace?: string | undefined; readonly project?: string | undefined };

export class MemoryRuntime extends Context.Service<
  MemoryRuntime,
  {
    /** The memory session of the agent session a native id names, the Hub told of it first. */
    readonly agent: (
      nativeSessionId: string,
    ) => Effect.Effect<MemoryService.MemorySession, PeerHubError>;
    /** The memory session of a Peer thread's live runtime: its agent session's, or the app's own. */
    readonly runtime: (
      threadId: ThreadId,
      providerSessionId: string,
      providerInstanceId: ProviderInstanceId,
    ) => Effect.Effect<MemoryService.MemorySession, PeerHubError>;
    /** Where a runtime's private companion context and notices are, or a checkpoint of it. */
    readonly context: (
      nativeSessionId: string,
      action: "notice" | "checkpoint",
      reason?: string,
    ) => Effect.Effect<{ readonly text: string }, PeerHubError>;
    /** An operation of a runtime, in its own project, as itself. */
    readonly execute: (
      nativeSessionId: string,
      input: PeerHubMemoryExecuteInput,
    ) => Effect.Effect<PeerMemoryWriteResult, PeerHubError>;
    /** A projection for a runtime, of its project or its company scope. */
    readonly project: (
      nativeSessionId: string,
      input: PeerHubMemoryProjectInput,
    ) => Effect.Effect<PeerMemoryProjection, PeerHubError>;
    readonly receipt: (
      nativeSessionId: string,
      input: RuntimeReceipt,
    ) => Effect.Effect<PeerMemoryReceipt, PeerHubError>;
    /** A workspace's app-run runtimes, as its coordination report carries them. */
    readonly reported: (workspace: string) => ReadonlyArray<ReportedSession>;
    /** Ends the app-run runtimes whose thread no longer runs. */
    readonly prune: Effect.Effect<void>;
    /** Forgets the app-run runtimes, writing and sending nothing (memory turned off). */
    readonly forget: Effect.Effect<void>;
  }
>()("t3/peerHub/plugins/memory/MemoryRuntime") {}

/** The signed-in identity, and the checkouts memory reads approved knowledge from. */
export const authLayer = Layer.effect(
  MemoryAuth,
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const client = yield* PeerHubClient.PeerHubClient;
    const signedIn = client.session.pipe(
      Effect.mapError((error) => new MemoryError({ code: "not_found", detail: error.detail })),
    );
    return MemoryAuth.of({
      identity: signedIn.pipe(
        Effect.map(({ hubUrl, session }) => ({
          hubUrl,
          token: session,
          email: state.current().persisted.email!,
          environmentId: state.environmentId,
        })),
      ),
      repository: (scope, repositoryId) =>
        Effect.gen(function* () {
          const { hubUrl, session } = yield* signedIn;
          const manifest = yield* client.api
            .manifest(hubUrl, session, scope.workspace)
            .pipe(
              Effect.mapError(
                (error) => new MemoryError({ code: "not_found", detail: error.detail }),
              ),
            );
          if (!safeId(scope.workspace) || !safeId(scope.project))
            return yield* new MemoryError({
              code: "not_found",
              detail: "The memory repository is unavailable.",
            });
          if (scope.project === "company") {
            const company = manifest.knowledge.company;
            if (repositoryId !== "company" || company === undefined)
              return yield* new MemoryError({
                code: "not_found",
                detail: "The company knowledge repository is unavailable.",
              });
            return { root: state.knowledgePath(scope.workspace), branch: company.branch };
          }
          const project = manifest.projects.find((candidate) => candidate.id === scope.project);
          const repository = project?.repositories.find(
            (candidate) => candidate.id === repositoryId,
          );
          if (repository === undefined || !safeId(repository.id))
            return yield* new MemoryError({
              code: "not_found",
              detail: "The memory repository is unavailable.",
            });
          return {
            root: state.checkoutPath(
              state.current().persisted,
              scope.workspace,
              scope.project,
              repository.id,
            ),
            branch: repository.branch,
          };
        }),
    });
  }),
);

/** An agent session as memory binds its operations to it. */
export const memorySessionOf = (
  session: PeerSessionView,
  environmentId: string,
): MemoryService.MemorySession => ({
  workspace: session.workspace,
  project: session.project,
  sessionId: session.id,
  environmentId,
  runtimeGeneration: session.runtimeGeneration,
  workId: session.thread ?? (session.pane === undefined ? session.id : `herdr:${session.pane}`),
  ...(session.task === undefined ? {} : { taskId: session.task }),
  ...(session.repositoryId === undefined ? {} : { repositoryId: session.repositoryId }),
  adapter: session.agent,
  root: session.root,
});

const make = Effect.gen(function* () {
  const memory = yield* MemoryService.MemoryService;
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const agents = yield* PeerAgents.PeerAgents;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const { environmentId } = state;

  /** The runtimes the app runs for Peer threads, by their session id (`peer:<thread id>`). */
  const appSessions = new Map<
    string,
    {
      session: MemoryService.MemorySession;
      threadId: ThreadId;
      providerInstanceId: ProviderInstanceId;
      label: string;
    }
  >();

  /** Whether a thread still runs on the provider instance its runtime was bound to. */
  const stillRuns = (threadId: ThreadId, providerInstanceId: ProviderInstanceId) =>
    projections
      .getThreadShell(threadId)
      .pipe(
        Effect.map(
          (caller) =>
            caller !== null &&
            caller.deletedAt === null &&
            caller.archivedAt === null &&
            caller.activeRunId !== null &&
            caller.providerInstanceId === providerInstanceId,
        ),
      );

  /** The agent session coordination knows by a native id, with or without its `claude:` prefix. */
  const agentSession = (nativeSessionId: string) =>
    Effect.map(agents.sessions, (sessions) => {
      const matches = sessions.filter(
        (session) =>
          session.id === nativeSessionId ||
          session.id.slice(session.agent.length + 1) === nativeSessionId,
      );
      return matches.length === 1 ? matches[0] : undefined;
    });

  const agent: MemoryRuntime["Service"]["agent"] = (nativeSessionId) =>
    Effect.gen(function* () {
      const app = appSessions.get(nativeSessionId);
      const known = app === undefined ? yield* agentSession(nativeSessionId) : undefined;
      const session =
        app?.session ?? (known === undefined ? undefined : memorySessionOf(known, environmentId));
      if (session === undefined)
        return yield* hubError(
          "This runtime has no registered Peer memory session. Its coordination hooks must start first.",
        );
      if (app !== undefined) {
        const runs = yield* stillRuns(app.threadId, app.providerInstanceId).pipe(
          Effect.mapError(() => hubError("The runtime is unavailable.")),
        );
        if (!runs)
          return yield* hubError("The calling runtime no longer owns an active thread run.");
      } else yield* agents.report(session.workspace);
      return session;
    });

  const reported: MemoryRuntime["Service"]["reported"] = (workspace) =>
    [...appSessions.values()]
      .filter(({ session }) => session.workspace === workspace)
      .map(({ session, label }) => ({
        id: session.sessionId,
        runtimeGeneration: session.runtimeGeneration,
        project: session.project,
        label,
        agent: session.adapter,
        status: "working",
        files: [],
        claims: [],
        ...(session.taskId === undefined ? {} : { task: session.taskId }),
      }));

  const runtime: MemoryRuntime["Service"]["runtime"] = (
    threadId,
    providerSessionId,
    providerInstanceId,
  ) =>
    Effect.gen(function* () {
      const caller = yield* projections
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => hubError("The calling thread is unavailable.")));
      if (
        caller === null ||
        caller.deletedAt !== null ||
        caller.archivedAt !== null ||
        caller.activeRunId === null ||
        caller.providerInstanceId !== providerInstanceId
      )
        return yield* hubError("The calling runtime no longer owns an active thread run.");
      const records = yield* projections
        .getThreadRecords(threadId, ["providerThreads"])
        .pipe(Effect.mapError(() => hubError("The calling runtime is unavailable.")));
      const provider = records.providerThreads.find(
        (entry) => entry.id === caller.activeProviderThreadId,
      );
      const nativeId = provider?.nativeThreadRef?.nativeId;
      if (
        nativeId !== undefined &&
        nativeId !== null &&
        (yield* agentSession(nativeId)) !== undefined
      )
        return yield* agent(nativeId);
      const t3Project = yield* projects
        .getById(caller.projectId)
        .pipe(Effect.mapError(() => hubError("The runtime project is unavailable.")));
      if (Option.isNone(t3Project)) return yield* hubError("The runtime project is unavailable.");
      const place = state.projectOfPath(state.current().persisted, t3Project.value.workspaceRoot);
      if (place === undefined) return yield* hubError("The runtime is outside a Peer Hub project.");
      const sessionId = `peer:${threadId}`;
      const previous = appSessions.get(sessionId);
      const taskId = assignedTask(
        state.current().persisted,
        sessionId,
        place.workspace,
        place.projectId,
      );
      const session: MemoryService.MemorySession =
        previous?.session.runtimeGeneration === providerSessionId
          ? previous.session
          : {
              workspace: place.workspace,
              project: place.projectId,
              sessionId,
              runtimeGeneration: providerSessionId,
              environmentId,
              workId: sessionId,
              repositoryId: place.repositoryId,
              adapter: provider?.driver ?? String(providerInstanceId),
              root: t3Project.value.workspaceRoot,
              ...(taskId === undefined ? {} : { taskId }),
            };
      if (
        previous !== undefined &&
        previous.session.runtimeGeneration !== session.runtimeGeneration
      )
        yield* memory.endSession(previous.session).pipe(Effect.mapError(hubFailure));
      appSessions.set(sessionId, {
        session,
        threadId,
        providerInstanceId,
        label: caller.title.slice(0, 300),
      });
      if (previous?.session.runtimeGeneration !== session.runtimeGeneration)
        yield* memory.prepareSession(session, "resume").pipe(Effect.mapError(hubFailure));
      const auth = yield* client.session;
      // Runtime provenance is archived before queued commands are replayed. A missing
      // live report during an outage must not prevent the local durable write.
      yield* Effect.gen(function* () {
        const view = yield* client.api.coordination(auth.hubUrl, auth.session, session.workspace);
        const others = view.sessions.filter(
          (entry) =>
            entry.environment === environmentId &&
            entry.email === state.current().persisted.email &&
            !appSessions.has(entry.id),
        );
        yield* client.api.reportCoordination(auth.hubUrl, auth.session, session.workspace, {
          environment: environmentId,
          sessions: [
            ...others.map((entry) => ({
              id: entry.id,
              project: entry.project,
              label: entry.label,
              status: entry.status,
              files: entry.files,
              claims: entry.claims,
              ...(entry.runtimeGeneration === undefined
                ? {}
                : { runtimeGeneration: entry.runtimeGeneration }),
              ...(entry.agent === undefined ? {} : { agent: entry.agent }),
              ...(entry.task === undefined ? {} : { task: entry.task }),
              ...(entry.branch === undefined ? {} : { branch: entry.branch }),
              ...(entry.intent === undefined ? {} : { intent: entry.intent }),
              ...(entry.activeAt === undefined ? {} : { activeAt: entry.activeAt }),
            })),
            ...reported(session.workspace),
          ],
        });
      }).pipe(Effect.catchTag("PeerHubError", () => Effect.void));
      return session;
    });

  const context: MemoryRuntime["Service"]["context"] = (nativeSessionId, action, reason) =>
    Effect.gen(function* () {
      const session = yield* agent(nativeSessionId);
      return {
        text:
          action === "checkpoint"
            ? (yield* memory
                .checkpoint(session, reason ?? "runtime checkpoint")
                .pipe(Effect.mapError(hubFailure))).path
            : (yield* memory.prepareSession(session, "resume").pipe(Effect.mapError(hubFailure)))
                .notice,
      };
    });

  const execute: MemoryRuntime["Service"]["execute"] = (nativeSessionId, input) =>
    Effect.gen(function* () {
      const session = yield* agent(nativeSessionId);
      if (session.workspace !== input.workspace || session.project !== input.project)
        return yield* hubError("The memory operation must belong to this runtime's project.");
      yield* MemoryCli.assertAgentCommand(input.command).pipe(Effect.mapError(hubFailure));
      return yield* memory
        .execute({ ...input, command: MemoryCli.agentCommand(session, input.command) })
        .pipe(Effect.mapError(hubFailure));
    });

  const project: MemoryRuntime["Service"]["project"] = (nativeSessionId, input) =>
    Effect.gen(function* () {
      const session = yield* agent(nativeSessionId);
      if (
        session.workspace !== input.workspace ||
        (session.project !== input.project && input.project !== "company")
      )
        return yield* hubError(
          "The projection must belong to this runtime's project or company scope.",
        );
      return (yield* memory
        .projectForSession(session, input.projection, {
          workspace: input.workspace,
          project: input.project,
        })
        .pipe(Effect.mapError(hubFailure))).projection;
    });

  const receipt: MemoryRuntime["Service"]["receipt"] = (nativeSessionId, input) =>
    Effect.gen(function* () {
      const session = yield* agent(nativeSessionId);
      const { workspace = session.workspace, project = session.project, ...rest } = input;
      if (workspace !== session.workspace || (project !== session.project && project !== "company"))
        return yield* hubError(
          "The receipt must belong to this runtime's project or company scope.",
        );
      return yield* memory
        .receipt(session, rest, { workspace, project })
        .pipe(Effect.mapError(hubFailure));
    });

  const prune: MemoryRuntime["Service"]["prune"] = Effect.gen(function* () {
    for (const [id, app] of appSessions) {
      const runs = yield* stillRuns(app.threadId, app.providerInstanceId).pipe(
        Effect.orElseSucceed(() => false),
      );
      if (runs) continue;
      yield* memory.endSession(app.session).pipe(Effect.ignore);
      appSessions.delete(id);
    }
  });

  return MemoryRuntime.of({
    agent,
    runtime,
    context,
    execute,
    project,
    receipt,
    reported,
    prune,
    forget: Effect.sync(() => appSessions.clear()),
  });
});

export const layer = Layer.effect(MemoryRuntime, make);
