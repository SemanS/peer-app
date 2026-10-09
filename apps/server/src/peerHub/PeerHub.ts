// @effect-diagnostics nodeBuiltinImport:off - git subprocesses and checkout probes against the person's own disk.
/**
 * PeerHub — this environment's link to a Peer Hub and its workspaces.
 *
 * A person signs in with their email address (the hub mails a one-time
 * code), then joins the workspaces their address qualifies for — by its
 * domain or an invite — or creates one. Each workspace tells this environment
 * which projects to check out, which agent tools and knowledge they use, and
 * what shared AI capacity each one has. Provisioning stays local:
 * repositories are cloned with the person's own git credentials, projects are
 * ordinary T3 projects, and shared capacity becomes an ordinary provider
 * instance holding a per-member, per-project gateway key.
 *
 * Personal capacity never passes through here. The hub never sees provider
 * logins, and `hubPolicy` keeps hub-provisioned (shared) instances on their
 * own project and personal ones on projects that accept them.
 *
 * @module peerHub/PeerHub
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type * as MemoryContract from "@t3tools/contracts";

import {
  PEER_CORE_METHODS,
  PEER_MEMORY_AVAILABLE,
  PEER_CAPACITY_METHODS,
  PEER_MEMORY_METHODS,
  CapacityRpcGroup,
  PeerCoreRpcGroup,
  PeerRpcGroup,
  WsPeerMemoryRpcGroup,
  PeerHubError,
  PeerHubStatus,
  ProviderDriverKind,
  ProviderInstanceId,
  PeerAgentView,
  ThreadId,
  type PeerHubAgentInput,
  type PeerHubContextInput,
  type PeerHubContextVersionInput,
  type PeerHubCandidatesInput,
  type PeerHubDecideCandidateInput,
  type PeerHubCandidateInput,
  type PeerHubHarvestInput,
  type PeerKeptCandidate,
  type PeerKnowledgeCandidate,
  type PeerKnowledgeStatus,
  type PeerStagedEntry,
  type PeerContextVersion,
  type PeerContextVersionText,
  type PeerHubAssignThreadInput,
  type PeerHubCreateTaskInput,
  type PeerHubCreateWorkspaceInput,
  type PeerFoundWorkspace,
  type PeerHubFindWorkspaceInput,
  type PeerHubFinishSignInInput,
  type PeerHubFocusAgentInput,
  type PeerHubInviteInput,
  type PeerHubOverlapNoteInput,
  type PeerHubProjectInput,
  type PeerHubResolveOverlapInput,
  type PeerHubSettleOverlapInput,
  type PeerHubSetCoordinationInput,
  type PeerHubSetPluginInput,
  type PeerHubProjectUsage,
  type PeerHubPromptAgentInput,
  type PeerHubStartAgentInput,
  type PeerHubStartAgentResult,
  type PeerHubCoordEventsInput,
  type PeerHubStaleReadsInput,
  type PeerCoordEvent,
  type PeerStaleReads,
  type PeerHubShareProjectInput,
  type PeerHubSharedCapacityInput,
  type PeerHubStartSignInInput,
  type PeerHubTaskInput,
  type PeerHubUpdateTaskInput,
  type PeerHubWorkspaceInput,
  type PeerLocalAgent,
  type PeerProject,
  type PeerWorkContextText,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpServer } from "effect/unstable/ai";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Settings from "../serverSettings.ts";
import * as AgentTranscript from "./agentTranscript.ts";
import * as Herdr from "./herdr.ts";
import * as Knowledge from "./knowledge.ts";
import * as HubApi from "./core/hub/hubApi.ts";
import * as PeerHubClient from "./core/hub/PeerHubClient.ts";
import * as PeerHubEvents from "./core/hub/PeerHubEvents.ts";
import { hasGitCheckout, run } from "./core/local.ts";
import type {
  PeerLifecycleEvent,
  PeerRpcContribution,
  PeerRpcWrap,
  PeerRuntimeProvider,
} from "./core/plugin.ts";
import * as PeerPlugins from "./core/plugins/PeerPlugins.ts";
import * as PeerStatus from "./core/status/PeerStatus.ts";
import * as PeerState from "./core/state/PeerState.ts";
import {
  projectKey,
  safeId,
  type HerdrAgentState,
  type PersistedWorkspace,
  type RuntimeState,
} from "./core/state/PeerState.ts";
import * as PeerAdapters from "./core/coordination/PeerAdapters.ts";
import * as PeerCoordination from "./core/coordination/PeerCoordination.ts";
import * as PeerWork from "./core/work/PeerWork.ts";
import * as PeerWorkspaces from "./core/workspaces/PeerWorkspaces.ts";
import { assignedTask, taskName } from "./core/work/report.ts";
import * as MemoryService from "./memory/MemoryService.ts";
import * as MemoryTransport from "./memory/MemoryTransport.ts";
import * as MemoryCli from "./memory/MemoryCli.ts";
import * as MemoryKnowledge from "./memory/knowledge.ts";

const WORK_INTERVAL = "30 seconds";
/**
 * How often Peer reads herdr's agents when herdr sends no events, and when it
 * does (agents' titles change without an event).
 */
const HERDR_POLL_MS = 4_000;
const HERDR_RESYNC_MS = 15_000;
/** A change in herdr's agents reaches the hub at most this often. */
const HERDR_REPORT_GAP_MS = 2_000;
const MANIFEST_INTERVAL = "10 minutes";

/**
 * What Peer shows and reports of herdr's agents, to tell a change from a re-read.
 * The completion is in it because a turn can start and finish between two reads
 * and leave the state as it was.
 */
function herdrSignature(
  agents: ReadonlyArray<HerdrAgentState> | null,
  keyOf: (agent: HerdrAgentState) => string,
): string {
  if (agents === null) return "";
  return agents
    .map((a) =>
      [keyOf(a), a.paneId, a.status, a.completionSeq, a.title, a.cwd, a.branch].join("\u0000"),
    )
    .toSorted()
    .join("\u0001");
}

const sameAgentView = Schema.toEquivalence(PeerAgentView);

export class PeerHub extends Context.Service<
  PeerHub,
  {
    readonly status: Effect.Effect<PeerHubStatus>;
    readonly memoryQueue: (
      input: MemoryContract.PeerMemoryScope,
    ) => Effect.Effect<MemoryContract.PeerMemoryQueue, PeerHubError>;
    readonly memoryRetry: (
      input: MemoryContract.PeerHubMemoryRetryInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryWriteResult, PeerHubError>;
    readonly memoryDiscard: (
      input: MemoryContract.PeerHubMemoryDiscardInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryDiscarded, PeerHubError>;
    readonly memoryState: (
      input: MemoryContract.PeerMemoryScope,
    ) => Effect.Effect<MemoryContract.PeerMemoryState, PeerHubError>;
    readonly memoryMode: (
      input: MemoryContract.PeerMemoryScope,
    ) => Effect.Effect<{ readonly mode: MemoryContract.PeerMemoryMode }, PeerHubError>;
    readonly memorySetMode: (
      input: MemoryContract.PeerHubMemorySetModeInput,
    ) => Effect.Effect<{ readonly mode: MemoryContract.PeerMemoryMode }, PeerHubError>;
    readonly memoryExecute: (
      input: MemoryContract.PeerHubMemoryExecuteInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryWriteResult, PeerHubError>;
    readonly memorySearch: (
      input: MemoryContract.PeerHubMemorySearchInput,
    ) => Effect.Effect<MemoryContract.PeerMemorySearchResult, PeerHubError>;
    readonly memoryRead: (
      input: MemoryContract.PeerHubMemoryReadInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryRecordView, PeerHubError>;
    readonly memoryProject: (
      input: MemoryContract.PeerHubMemoryProjectInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryProjection, PeerHubError>;
    readonly memoryChanges: (
      input: MemoryContract.PeerHubMemoryChangesInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryChanges, PeerHubError>;
    readonly memoryReceipts: (
      input: MemoryContract.PeerHubMemoryReceiptsInput,
    ) => Effect.Effect<
      { readonly receipts: ReadonlyArray<MemoryContract.PeerMemoryReceipt> },
      PeerHubError
    >;
    readonly memoryKeep: (
      input: MemoryContract.PeerHubMemoryKeepInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryKept, PeerHubError>;
    readonly memoryImportKnowledge: (
      input: MemoryContract.PeerHubMemoryImportKnowledgeInput,
    ) => Effect.Effect<
      { readonly operations: ReadonlyArray<MemoryContract.PeerMemoryWriteResult> },
      PeerHubError
    >;
    readonly memoryAgent: (
      nativeSessionId: string,
    ) => Effect.Effect<MemoryService.MemorySession, PeerHubError>;
    readonly memoryRuntime: (
      threadId: ThreadId,
      providerSessionId: string,
      providerInstanceId: ProviderInstanceId,
    ) => Effect.Effect<MemoryService.MemorySession, PeerHubError>;
    readonly memoryAgentContext: (
      nativeSessionId: string,
      action: "notice" | "checkpoint",
      reason?: string,
    ) => Effect.Effect<{ readonly text: string }, PeerHubError>;
    readonly memoryAgentExecute: (
      nativeSessionId: string,
      input: MemoryContract.PeerHubMemoryExecuteInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryWriteResult, PeerHubError>;
    readonly memoryAgentProject: (
      nativeSessionId: string,
      input: MemoryContract.PeerHubMemoryProjectInput,
    ) => Effect.Effect<MemoryContract.PeerMemoryProjection, PeerHubError>;
    readonly memoryAgentReceipt: (
      nativeSessionId: string,
      input: Omit<
        MemoryContract.PeerMemoryReceiptInput,
        "sessionId" | "environmentId" | "runtimeGeneration" | "runtimeProjectId"
      > & { readonly workspace?: string | undefined; readonly project?: string | undefined },
    ) => Effect.Effect<MemoryContract.PeerMemoryReceipt, PeerHubError>;
    /** The current status followed by every change. */
    readonly streamStatus: Stream.Stream<PeerHubStatus>;
    /** Mails a sign-in code to the address. */
    readonly startSignIn: (
      input: PeerHubStartSignInInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly finishSignIn: (
      input: PeerHubFinishSignInInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Also cancels a sign-in waiting for its code. */
    readonly signOut: Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly sync: Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly createWorkspace: (
      input: PeerHubCreateWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly joinWorkspace: (
      input: PeerHubWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly leaveWorkspace: (
      input: PeerHubWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly invite: (input: PeerHubInviteInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A workspace by its short name (null when there is none), to join it by name. */
    readonly findWorkspace: (
      input: PeerHubFindWorkspaceInput,
    ) => Effect.Effect<PeerFoundWorkspace | null, PeerHubError>;
    /** Clones the project's repositories (in the background) and registers them as projects. */
    readonly openProject: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Agent coordination on or off, its policy, and Peer's hooks in Claude Code and Codex. */
    readonly setCoordination: (
      input: PeerHubSetCoordinationInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Turns one of Peer's optional plugins on or off on this environment. */
    readonly setPlugin: (
      input: PeerHubSetPluginInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A person's note on an overlap; both agents hear it. */
    readonly noteOverlap: (
      input: PeerHubOverlapNoteInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly resolveOverlap: (
      input: PeerHubResolveOverlapInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A person asks the agents on an overlap to settle it between them and close it. */
    readonly settleOverlap: (
      input: PeerHubSettleOverlapInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly setSharedCapacity: (
      input: PeerHubSharedCapacityInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly projectUsage: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubProjectUsage, PeerHubError>;
    /** Any member of a project adds, changes and closes its tasks. */
    readonly createTask: (
      input: PeerHubCreateTaskInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly updateTask: (
      input: PeerHubUpdateTaskInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly deleteTask: (input: PeerHubTaskInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Puts one of this computer's threads under a task, or under none. */
    readonly assignThread: (
      input: PeerHubAssignThreadInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Brings a herdr agent's pane forward in herdr. */
    readonly focusAgent: (
      input: PeerHubFocusAgentInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A herdr agent's work as it happens: its view now, then each change. */
    readonly watchAgent: (input: PeerHubAgentInput) => Stream.Stream<PeerAgentView>;
    /** Sends one of this computer's herdr agents a prompt, as if typed in its terminal. */
    readonly promptAgent: (
      input: PeerHubPromptAgentInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Starts a task agent in its own checkout and assigns its durable work identity. */
    readonly startAgent: (
      input: PeerHubStartAgentInput,
    ) => Effect.Effect<PeerHubStartAgentResult, PeerHubError>;
    readonly getCoordEvents: (
      input: PeerHubCoordEventsInput,
    ) => Effect.Effect<ReadonlyArray<PeerCoordEvent>, PeerHubError>;
    readonly getStaleReads: (
      input: PeerHubStaleReadsInput,
    ) => Effect.Effect<PeerStaleReads, PeerHubError>;
    /** A task's shared context with its text; null when it has none yet. */
    readonly readContext: (
      input: PeerHubContextInput,
    ) => Effect.Effect<PeerWorkContextText | null, PeerHubError>;
    /** The versions of a shared context the hub keeps, newest first. */
    readonly contextVersions: (
      input: PeerHubContextInput,
    ) => Effect.Effect<ReadonlyArray<PeerContextVersion>, PeerHubError>;
    readonly readContextVersion: (
      input: PeerHubContextVersionInput,
    ) => Effect.Effect<PeerContextVersionText | null, PeerHubError>;
    /** Brings an older version of a shared context back; its keeper goes on from it. */
    readonly restoreContext: (
      input: PeerHubContextVersionInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** What agents found that a project may want to keep, weighed by independent finders. */
    readonly knowledgeCandidates: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<ReadonlyArray<PeerKnowledgeCandidate>, PeerHubError>;
    /** A person dismisses a knowledge candidate, promotes it, or proposes it again. */
    readonly decideCandidate: (
      input: PeerHubDecideCandidateInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A project's knowledge on this computer: its checkout, kontext there, its guidance for agents. */
    readonly knowledgeStatus: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<PeerKnowledgeStatus, PeerHubError>;
    /** Runs `kontext init` in the project's checkout here. */
    readonly setupKnowledge: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<PeerKnowledgeStatus, PeerHubError>;
    /** Writes a candidate into the project's knowledge, staged, and marks it kept for everyone. */
    readonly keepCandidate: (
      input: PeerHubCandidateInput,
    ) => Effect.Effect<PeerKeptCandidate, PeerHubError>;
    /** Reads a shared context with kontext for what the project should keep, and proposes it. */
    readonly harvestContext: (
      input: PeerHubHarvestInput,
    ) => Effect.Effect<{ readonly proposed: number }, PeerHubError>;
    /** Proposes the project's guidance for its agents from what people kept and dismissed. */
    readonly improveGuidance: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<PeerStagedEntry, PeerHubError>;
    /** Shares a local project's repository with a workspace, as a project everyone works on. */
    readonly shareProject: (
      input: PeerHubShareProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly unshareProject: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
  }
>()("t3/peerHub/PeerHub") {}

function sharedInstanceId(workspace: string, projectId: string): ProviderInstanceId {
  const id = `peer-${workspace}-${projectId}-claude`;
  if (id.length <= 64) return ProviderInstanceId.make(id);
  const digest = NodeCrypto.createHash("sha256")
    .update(projectKey(workspace, projectId))
    .digest("hex");
  return ProviderInstanceId.make(`peer-${digest.slice(0, 16)}-claude`);
}

/** A directory as the file system knows it (macOS keeps /var under /private). */
function realDirectory(path: string): string {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return NodePath.resolve(path);
  }
}

const hubError = (detail: string) => new PeerHubError({ detail });

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const projects = yield* ProjectService.ProjectService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const hubApi = client.api;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const events = yield* PeerHubEvents.PeerHubEvents;
  const work = yield* PeerWork.PeerWork;
  const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
  const coordination = yield* PeerCoordination.PeerCoordination;
  const adapters = yield* PeerAdapters.PeerAdapters;
  const environmentId = state.environmentId;
  const layerScope = yield* Effect.scope;

  const { hubHome, knowledgePath, workspaceRoot, checkoutPath, lock } = state;
  const { updatePersisted, updateRuntime } = state;
  const currentState = state.current;
  const peerStatus = yield* PeerStatus.PeerStatus;
  const herdrReportsSkipped = new Map<string, number>();
  /** cwd → its git branch, refreshed every 30 s, for herdr agents. */
  const branches = new Map<string, { readonly branch: string | undefined; readonly at: number }>();

  const readSession = client.storedSession;
  const hubUrlOf = client.hubUrl;
  const requireSession = client.session;

  const memoryFailure = (error: MemoryTransport.MemoryError) =>
    new PeerHubError({ detail: error.detail });
  const appMemorySessions = new Map<
    string,
    {
      session: MemoryService.MemorySession;
      threadId: ThreadId;
      providerInstanceId: ProviderInstanceId;
      label: string;
    }
  >();
  const memoryAuth = MemoryTransport.MemoryAuth.of({
    identity: requireSession.pipe(
      Effect.map(({ hubUrl, session }) => ({
        hubUrl,
        token: session,
        email: currentState().persisted.email!,
        environmentId,
      })),
      Effect.mapError(
        (error) => new MemoryTransport.MemoryError({ code: "not_found", detail: error.detail }),
      ),
    ),
    repository: (scope, repositoryId) =>
      Effect.gen(function* () {
        const { hubUrl, session } = yield* requireSession.pipe(
          Effect.mapError(
            (error) => new MemoryTransport.MemoryError({ code: "not_found", detail: error.detail }),
          ),
        );
        const manifest = yield* hubApi
          .manifest(hubUrl, session, scope.workspace)
          .pipe(
            Effect.mapError(
              (error) =>
                new MemoryTransport.MemoryError({ code: "not_found", detail: error.detail }),
            ),
          );
        if (!safeId(scope.workspace) || !safeId(scope.project))
          return yield* new MemoryTransport.MemoryError({
            code: "not_found",
            detail: "The memory repository is unavailable.",
          });
        if (scope.project === "company") {
          const company = manifest.knowledge.company;
          if (repositoryId !== "company" || company === undefined)
            return yield* new MemoryTransport.MemoryError({
              code: "not_found",
              detail: "The company knowledge repository is unavailable.",
            });
          return { root: knowledgePath(scope.workspace), branch: company.branch };
        }
        const project = manifest.projects.find((candidate) => candidate.id === scope.project);
        const repository = project?.repositories.find((candidate) => candidate.id === repositoryId);
        if (repository === undefined || !safeId(repository.id))
          return yield* new MemoryTransport.MemoryError({
            code: "not_found",
            detail: "The memory repository is unavailable.",
          });
        return {
          root: checkoutPath(
            currentState().persisted,
            scope.workspace,
            scope.project,
            repository.id,
          ),
          branch: repository.branch,
        };
      }),
  });
  const memoryAuthLayer = Layer.succeed(MemoryTransport.MemoryAuth, memoryAuth);
  const memory = yield* MemoryService.MemoryService.pipe(
    Effect.provide(
      MemoryService.layer.pipe(
        Layer.provide(MemoryTransport.layer),
        Layer.provide(memoryAuthLayer),
      ),
    ),
  );
  const memoryCli = yield* MemoryCli.MemoryCli.pipe(
    Effect.provide(
      MemoryCli.layer.pipe(Layer.provide(Layer.succeed(MemoryService.MemoryService, memory))),
    ),
  );
  const memoryQueue: PeerHub["Service"]["memoryQueue"] = (input) =>
    memory.queue(input).pipe(Effect.mapError(memoryFailure));
  const memoryRetry: PeerHub["Service"]["memoryRetry"] = (input) =>
    memory.retry(input).pipe(Effect.mapError(memoryFailure));
  const memoryDiscard: PeerHub["Service"]["memoryDiscard"] = (input) =>
    memory.discard(input).pipe(Effect.mapError(memoryFailure));
  const memoryState: PeerHub["Service"]["memoryState"] = (input) =>
    memory.synchronize(input).pipe(Effect.mapError(memoryFailure));
  const memoryMode: PeerHub["Service"]["memoryMode"] = (input) =>
    memory.mode(input).pipe(Effect.mapError(memoryFailure));
  const memorySetMode: PeerHub["Service"]["memorySetMode"] = (input) =>
    memory.setMode(input).pipe(Effect.mapError(memoryFailure));
  const memorySearch: PeerHub["Service"]["memorySearch"] = (input) =>
    memory.search(input).pipe(Effect.mapError(memoryFailure));
  const memoryRead: PeerHub["Service"]["memoryRead"] = (input) =>
    memory.read(input).pipe(Effect.mapError(memoryFailure));
  const memoryProject: PeerHub["Service"]["memoryProject"] = (input) =>
    memory.project(input).pipe(Effect.mapError(memoryFailure));
  const memoryChanges: PeerHub["Service"]["memoryChanges"] = (input) =>
    memory.changes(input).pipe(Effect.mapError(memoryFailure));
  const memoryReceipts: PeerHub["Service"]["memoryReceipts"] = (input) =>
    memory.receipts(input).pipe(Effect.mapError(memoryFailure));
  const memoryKeep: PeerHub["Service"]["memoryKeep"] = (input) =>
    memory.keep(input).pipe(Effect.provide(memoryAuthLayer), Effect.mapError(memoryFailure));
  const memoryImportKnowledge: PeerHub["Service"]["memoryImportKnowledge"] = (input) =>
    memory
      .importKnowledge(input)
      .pipe(Effect.provide(memoryAuthLayer), Effect.mapError(memoryFailure));
  const memoryExecute: PeerHub["Service"]["memoryExecute"] = (input) => {
    const {
      sessionId: _session,
      environmentId: _environment,
      runtimeGeneration: _generation,
      ...command
    } = input.command;
    return memory.execute({ ...input, command }).pipe(Effect.mapError(memoryFailure));
  };
  const memoryAgent: PeerHub["Service"]["memoryAgent"] = (nativeSessionId) =>
    Effect.gen(function* () {
      const app = appMemorySessions.get(nativeSessionId);
      const session = app?.session ?? coordination.broker()?.memorySession(nativeSessionId);
      if (session === undefined)
        return yield* hubError(
          "This runtime has no registered Peer memory session. Its coordination hooks must start first.",
        );
      if (app !== undefined) {
        const caller = yield* projections
          .getThreadShell(app.threadId)
          .pipe(Effect.mapError(() => hubError("The runtime is unavailable.")));
        if (
          caller === null ||
          caller.deletedAt !== null ||
          caller.archivedAt !== null ||
          caller.activeRunId === null ||
          caller.providerInstanceId !== app.providerInstanceId
        )
          return yield* hubError("The calling runtime no longer owns an active thread run.");
      } else
        yield* Effect.tryPromise({
          try: () => coordination.broker()!.registerMemoryRuntime(nativeSessionId),
          catch: () => hubError("The runtime could not report its Peer memory generation."),
        });
      return session;
    });
  const appMemoryReport = (workspace: string): ReadonlyArray<HubApi.ReportedSession> =>
    [...appMemorySessions.values()]
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
  const memoryRuntime: PeerHub["Service"]["memoryRuntime"] = (
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
        coordination.broker()?.memorySession(nativeId) !== undefined
      )
        return yield* memoryAgent(nativeId);
      const t3Project = yield* projects
        .getById(caller.projectId)
        .pipe(Effect.mapError(() => hubError("The runtime project is unavailable.")));
      if (Option.isNone(t3Project)) return yield* hubError("The runtime project is unavailable.");
      const place = projectOfPath(currentState(), t3Project.value.workspaceRoot);
      if (place === undefined) return yield* hubError("The runtime is outside a Peer Hub project.");
      const sessionId = `peer:${threadId}`;
      const previous = appMemorySessions.get(sessionId);
      const taskId = assignedTask(
        currentState().persisted,
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
        yield* memory.endSession(previous.session).pipe(Effect.mapError(memoryFailure));
      appMemorySessions.set(sessionId, {
        session,
        threadId,
        providerInstanceId,
        label: caller.title.slice(0, 300),
      });
      if (previous?.session.runtimeGeneration !== session.runtimeGeneration)
        yield* memory.prepareSession(session, "resume").pipe(Effect.mapError(memoryFailure));
      const auth = yield* requireSession;
      // Runtime provenance is archived before queued commands are replayed. A missing
      // live report during an outage must not prevent the local durable write.
      yield* Effect.gen(function* () {
        const view = yield* hubApi.coordination(auth.hubUrl, auth.session, session.workspace);
        const others = view.sessions.filter(
          (entry) =>
            entry.environment === environmentId &&
            entry.email === currentState().persisted.email &&
            !appMemorySessions.has(entry.id),
        );
        yield* hubApi.reportCoordination(auth.hubUrl, auth.session, session.workspace, {
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
            ...appMemoryReport(session.workspace),
          ],
        });
      }).pipe(Effect.catchTag("PeerHubError", () => Effect.void));
      return session;
    });
  const memoryAgentContext: PeerHub["Service"]["memoryAgentContext"] = (
    nativeSessionId,
    action,
    reason,
  ) =>
    Effect.gen(function* () {
      const session = yield* memoryAgent(nativeSessionId);
      return {
        text:
          action === "checkpoint"
            ? (yield* memory
                .checkpoint(session, reason ?? "runtime checkpoint")
                .pipe(Effect.mapError(memoryFailure))).path
            : (yield* memory.prepareSession(session, "resume").pipe(Effect.mapError(memoryFailure)))
                .notice,
      };
    });
  const memoryAgentExecute: PeerHub["Service"]["memoryAgentExecute"] = (nativeSessionId, input) =>
    Effect.gen(function* () {
      const session = yield* memoryAgent(nativeSessionId);
      if (session.workspace !== input.workspace || session.project !== input.project)
        return yield* hubError("The memory operation must belong to this runtime's project.");
      yield* MemoryCli.assertAgentCommand(input.command).pipe(Effect.mapError(memoryFailure));
      return yield* memory
        .execute({ ...input, command: MemoryCli.agentCommand(session, input.command) })
        .pipe(Effect.mapError(memoryFailure));
    });
  const memoryAgentProject: PeerHub["Service"]["memoryAgentProject"] = (nativeSessionId, input) =>
    Effect.gen(function* () {
      const session = yield* memoryAgent(nativeSessionId);
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
        .pipe(Effect.mapError(memoryFailure))).projection;
    });
  const memoryAgentReceipt: PeerHub["Service"]["memoryAgentReceipt"] = (nativeSessionId, input) =>
    Effect.gen(function* () {
      const session = yield* memoryAgent(nativeSessionId);
      const { workspace = session.workspace, project = session.project, ...receipt } = input;
      if (workspace !== session.workspace || (project !== session.project && project !== "company"))
        return yield* hubError(
          "The receipt must belong to this runtime's project or company scope.",
        );
      return yield* memory
        .receipt(session, receipt, { workspace, project })
        .pipe(Effect.mapError(memoryFailure));
    });

  /** The workspace project whose checkout holds `path`, if any. */
  const projectOfPath = (s: RuntimeState, path: string | undefined) =>
    state.projectOfPath(s.persisted, path);

  /** The session an agent in a pane runs, as herdr's integration or Peer's own hooks say. */
  const sessionOf = (agent: HerdrAgentState) =>
    agent.session ?? coordination.broker()?.sessionInPane(agent.paneId) ?? undefined;

  /**
   * A herdr agent's thread key: its own session once known, so the thread
   * outlives the pane and a herdr restart; its terminal until then.
   */
  const agentKey = (agent: HerdrAgentState) => {
    const session = sessionOf(agent)?.id;
    return session === undefined
      ? `herdr:${agent.terminalId}`
      : `herdr:${agent.agent ?? "agent"}:${session}`;
  };

  const localAgentView = (s: RuntimeState, agent: HerdrAgentState): PeerLocalAgent => {
    const place = agent.place ?? projectOfPath(s, agent.cwd);
    return {
      id: agentKey(agent),
      paneId: agent.paneId,
      ...(agent.agent === undefined ? {} : { agent: agent.agent }),
      title: agent.title,
      status: agent.status,
      ...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
      ...(agent.branch === undefined ? {} : { branch: agent.branch }),
      coordinationLevel:
        coordination.broker()?.coordinationLevel(agentKey(agent).replace(/^herdr:/, "")) ?? "C",
      ...(agent.postHocPaths === undefined ? {} : { postHocPaths: agent.postHocPaths }),
      ...(agent.postHocPathsTruncated === undefined
        ? {}
        : { postHocPathsTruncated: agent.postHocPathsTruncated }),
      ...(place === undefined ? {} : place),
    };
  };

  // The status's coordination and herdr agents come from here until their services move out.
  yield* peerStatus.setFacadeParts((s) =>
    Effect.gen(function* () {
      return {
        agents: {
          herdr: s.herdr === null ? "not-running" : "running",
          list: (s.herdr ?? []).map((agent) => localAgentView(s, agent)),
          postHocSkipped: s.persisted.workspaces.reduce(
            (count, workspace) => count + (herdrReportsSkipped.get(workspace.slug) ?? 0),
            0,
          ),
        },
        coordination: yield* adapters.status(s),
      };
    }),
  );
  const publish = peerStatus.publish;

  const background = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.andThen(publish),
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(layerScope),
      Effect.asVoid,
    );

  /** Drops the local provider instances of a workspace project's shared capacity. */
  const removeSharedInstances = (key: string) =>
    Effect.gen(function* () {
      const ids = (yield* state.read).persisted.sharedInstances[key] ?? [];
      for (const id of ids) {
        yield* settings
          .updateProviderInstance({ operation: "remove", instanceId: ProviderInstanceId.make(id) })
          .pipe(Effect.ignoreCause({ log: true }));
      }
      yield* updatePersisted((p) => {
        const { [key]: _removed, ...rest } = p.sharedInstances;
        return { ...p, sharedInstances: rest };
      });
    });

  /** Revokes this environment's gateway key for the project, then drops its instances. */
  const turnOffShared = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      const { persisted } = yield* state.read;
      const session = yield* readSession;
      if (Option.isSome(session)) {
        yield* hubApi
          .revokeCredentials(
            hubUrlOf(persisted),
            session.value,
            workspace,
            projectId,
            environmentId,
          )
          .pipe(Effect.ignoreCause({ log: true }));
      }
      yield* removeSharedInstances(projectKey(workspace, projectId));
    });

  /** Reports this computer's threads to each workspace and reads everyone's work back. */
  const refreshWork = work.refresh().pipe(lock.withPermits(1));

  const branchOf = (cwd: string | undefined, nowMillis: number) =>
    Effect.gen(function* () {
      if (cwd === undefined) return undefined;
      const cached = branches.get(cwd);
      if (cached !== undefined && nowMillis - cached.at < 30_000) return cached.branch;
      const branch = yield* Effect.tryPromise(() =>
        run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 3000 }),
      ).pipe(
        Effect.map((name) => (name === "" || name === "HEAD" ? undefined : name)),
        Effect.orElseSucceed(() => undefined),
      );
      branches.set(cwd, { branch, at: nowMillis });
      return branch;
    });

  /** herdr's events say to read its agents again; a burst of them is one signal. */
  const herdrChanged = yield* Queue.dropping<void>(1);
  /** Lists herdr's agents with its events subscribed first, so no change goes unheard. */
  const herdrFollower = Herdr.followHerdrAgents({
    onChange: () => void Queue.offerUnsafe(herdrChanged, undefined),
    retryMs: HERDR_RESYNC_MS,
  });
  const herdrPlaces = new Map<string, { at: number; place: HerdrAgentState["place"] }>();
  const herdrCompletions = new Herdr.HerdrCompletionTracker();
  const herdrObservedPaths = new Map<string, { paths: ReadonlyArray<string>; truncated: number }>();
  /** What herdr runs on this computer, with each agent's git branch and worktree's repository. */
  const refreshHerdr = Effect.gen(function* () {
    const agents = yield* Effect.promise(() => herdrFollower.read());
    const nowMillis = DateTime.toEpochMillis(yield* DateTime.now);
    const withBranches =
      agents === null
        ? null
        : yield* Effect.forEach(agents, (agent) =>
            Effect.gen(function* () {
              const branch = yield* branchOf(agent.cwd, nowMillis);
              const observationKey = [
                agent.terminalId,
                agent.agent,
                agent.session?.id,
                agent.session?.path,
                agent.cwd,
              ].join("\0");
              if (herdrCompletions.completed(agent) && agent.cwd !== undefined) {
                const paths = yield* Effect.promise(() => Herdr.readHerdrChangedPaths(agent.cwd!));
                if (paths !== null)
                  herdrObservedPaths.set(observationKey, {
                    paths: paths.slice(0, 200),
                    truncated: Math.max(0, paths.length - 200),
                  });
                if (herdrObservedPaths.size > 500)
                  herdrObservedPaths.delete(herdrObservedPaths.keys().next().value!);
              }
              const observation = herdrObservedPaths.get(observationKey);
              let place = projectOfPath(yield* state.read, agent.cwd);
              if (place === undefined && agent.cwd !== undefined) {
                const cached = herdrPlaces.get(agent.cwd);
                if (cached !== undefined && nowMillis - cached.at < 30_000) place = cached.place;
                else {
                  const resolved = yield* coordination.placeOf(agent.cwd!);
                  place =
                    resolved?.repositoryId === undefined
                      ? undefined
                      : {
                          workspace: resolved.workspace,
                          projectId: resolved.project,
                          repositoryId: resolved.repositoryId,
                        };
                  herdrPlaces.set(agent.cwd, { at: nowMillis, place });
                  if (herdrPlaces.size > 500) herdrPlaces.delete(herdrPlaces.keys().next().value!);
                }
              }
              return {
                ...agent,
                branch,
                ...(observation === undefined
                  ? {}
                  : {
                      postHocPaths: observation.paths,
                      postHocPathsTruncated: observation.truncated,
                    }),
                ...(place === undefined ? {} : { place }),
              };
            }),
          );
    yield* updateRuntime((s) => ({ ...s, herdr: withBranches }));
  });

  /** An agent placed on a task under its terminal keeps the task once its session is known. */
  const keepAssignments = (agents: ReadonlyArray<HerdrAgentState>) =>
    Effect.gen(function* () {
      const assignments = (yield* state.read).persisted.assignments ?? {};
      const moves = agents.flatMap((agent) => {
        const legacy = `herdr:${agent.terminalId}`;
        const key = agentKey(agent);
        const assignment = assignments[legacy];
        return key !== legacy && assignment !== undefined && assignments[key] === undefined
          ? [{ legacy, key, assignment }]
          : [];
      });
      const shared = (yield* state.read).persisted.sharedThreads ?? [];
      const renamed = new Map(
        agents.flatMap((agent) => {
          const legacy = `herdr:${agent.terminalId}`;
          const key = agentKey(agent);
          return key !== legacy && shared.includes(legacy) ? [[legacy, key] as const] : [];
        }),
      );
      if (moves.length === 0 && renamed.size === 0) return;
      yield* updatePersisted((p) => {
        const next = { ...p.assignments };
        for (const move of moves) {
          delete next[move.legacy];
          next[move.key] = move.assignment;
        }
        return {
          ...p,
          assignments: next,
          sharedThreads: (p.sharedThreads ?? []).map((key) => renamed.get(key) ?? key),
        };
      });
    });

  /** Where Peer found agents' transcripts: session id → file, or null, rechecked after a while. */
  const transcripts = new Map<string, { readonly path: string | null; readonly at: number }>();

  /** A herdr agent as its view shows it: its transcript when Peer can read it, else its terminal. */
  const agentView = (agentId: string) =>
    Effect.gen(function* () {
      const agent = ((yield* state.read).herdr ?? []).find(
        (candidate) =>
          agentKey(candidate) === agentId || `herdr:${candidate.terminalId}` === agentId,
      );
      if (agent === undefined) {
        return { agentId, title: "", status: "unknown", gone: true } satisfies PeerAgentView;
      }
      const base = {
        agentId,
        title: agent.title,
        status: agent.status,
        paneId: agent.paneId,
        gone: false,
        ...(agent.agent === undefined ? {} : { agent: agent.agent }),
        ...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
        ...(agent.branch === undefined ? {} : { branch: agent.branch }),
      } satisfies PeerAgentView;
      const session = sessionOf(agent);
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      let path: string | null = null;
      if (session !== undefined && agent.agent === "claude") {
        const key = session.id ?? session.path ?? "";
        const known = transcripts.get(key);
        if (known !== undefined && (known.path !== null || now - known.at < 10_000)) {
          path = known.path;
        } else {
          path = yield* Effect.promise(() => AgentTranscript.findClaudeTranscript(session));
          transcripts.set(key, { path, at: now });
        }
      }
      if (path !== null) {
        const transcriptPath = path;
        const lines = yield* Effect.tryPromise(() =>
          AgentTranscript.readTranscriptTail(transcriptPath),
        ).pipe(Effect.orElseSucceed(() => [] as string[]));
        return {
          ...base,
          entries: AgentTranscript.transcriptEntries(
            lines,
            agent.cwd === undefined ? {} : { cwd: agent.cwd },
          ),
        } satisfies PeerAgentView;
      }
      // herdr will not read a working full-screen agent's history. Say so rather than show nothing;
      // the view is read again every second, so its output appears once herdr reports it idle or done.
      const terminal = yield* Effect.promise(() => Herdr.readHerdrAgent(agent.paneId));
      const hint = [
        terminal.kind === "notIdle" ? Herdr.herdrNotIdleHint(agent.status) : undefined,
        agent.agent === "claude"
          ? "To follow this conversation here instead of its terminal, install herdr's Claude Code integration once: herdr integration install claude"
          : undefined,
      ]
        .filter((line) => line !== undefined)
        .join(". ");
      return {
        ...base,
        ...(terminal.kind === "text" ? { terminal: terminal.text } : {}),
        ...(hint === "" ? {} : { hint }),
      } satisfies PeerAgentView;
    });

  /**
   * Keeps herdr's agents current. herdr's events say when an agent appears,
   * leaves or changes state; Peer then reads the list, shows it at once and
   * tells the hub within a couple of seconds. The events are subscribed before
   * each list, and again at once when herdr drops them for falling behind.
   * Without events (no herdr, or one from before them) Peer reads the list
   * every few seconds instead.
   */
  const followHerdr = Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => herdrFollower.close()));
    let shown = "";
    let reported = "";
    let reportedAt = 0;

    const step = Effect.gen(function* () {
      yield* refreshHerdr;
      const agents = (yield* state.read).herdr;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      yield* keepAssignments(agents ?? []);
      const seen = herdrSignature(agents, agentKey);
      if (seen !== shown) {
        shown = seen;
        yield* publish;
      }
      if (seen !== reported && now - reportedAt >= HERDR_REPORT_GAP_MS) {
        reported = seen;
        reportedAt = now;
        yield* background(refreshWork);
      }
      return seen !== reported
        ? Math.max(100, HERDR_REPORT_GAP_MS - (now - reportedAt))
        : herdrFollower.live()
          ? HERDR_RESYNC_MS
          : HERDR_POLL_MS;
    });

    while (true) {
      const wait = yield* step.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Peer could not read herdr's agents", cause).pipe(
            Effect.as(HERDR_POLL_MS),
          ),
        ),
      );
      const woken = yield* Queue.take(herdrChanged).pipe(Effect.timeoutOption(wait));
      if (Option.isSome(woken)) {
        // An agent starting or finishing sends a few events at once; read once they settle.
        yield* Effect.sleep(150);
        yield* Queue.clear(herdrChanged);
      }
    }
  });

  // ---- what features not moved into plugins yet contribute to core's capability slots ----

  /** herdr runs agents beside Peer's own threads: its titles, panes, states, wake and threads. */
  const herdrRuntime: PeerRuntimeProvider = {
    prefix: "herdr:",
    title: (pane) => currentState().herdr?.find((agent) => agent.paneId === pane)?.title,
    pane: (agent, cwd, named) => {
      const here = realDirectory(cwd);
      const panes = (currentState().herdr ?? []).filter((candidate) => {
        if (candidate.agent !== agent || candidate.cwd === undefined) return false;
        const there = realDirectory(candidate.cwd);
        return here === there || here.startsWith(`${there}/`) || there.startsWith(`${here}/`);
      });
      if (named !== undefined && panes.some((candidate) => candidate.paneId === named)) {
        return named;
      }
      return panes.length === 1 ? panes[0]?.paneId : undefined;
    },
    status: (sessionId, pane) =>
      currentState().herdr?.find(
        (candidate) =>
          agentKey(candidate) === `herdr:${sessionId}` &&
          (pane === undefined || candidate.paneId === pane),
      )?.status,
    wake: (sessionId, _pane, text) =>
      Effect.promise(() => {
        const agent = currentState().herdr?.find(
          (candidate) => agentKey(candidate) === `herdr:${sessionId}`,
        );
        if (agent === undefined) return Promise.resolve({ status: "unavailable" as const });
        return Herdr.wakeHerdrAgent({ ...agent, session: sessionOf(agent) }, text);
      }),
    view: (threadKey) => agentView(threadKey),
    notify: (title, body) => Effect.sync(() => void Herdr.notifyHerdr(title, body)),
    threads: (workspace) =>
      Effect.sync(() => {
        const s = currentState();
        return (s.herdr ?? []).flatMap((agent): HubApi.ReportedThread[] => {
          const place = agent.place ?? projectOfPath(s, agent.cwd);
          if (place === undefined || place.workspace !== workspace) return [];
          const id = agentKey(agent);
          const task =
            assignedTask(s.persisted, id, workspace, place.projectId) ??
            assignedTask(s.persisted, `herdr:${agent.terminalId}`, workspace, place.projectId);
          return [
            {
              id,
              project: place.projectId,
              repository: place.repositoryId,
              ...(task === undefined ? {} : { task }),
              title: agent.title.slice(0, 300),
              // Finished work is "done" like a Peer thread's, whether or not someone looked in
              // herdr. The local list keeps herdr's own state: Needs you clears once looked at.
              status: Herdr.herdrWorkStatus(agent),
              ...(agent.agent === undefined ? {} : { harness: agent.agent }),
              ...(agent.branch === undefined ? {} : { branch: agent.branch }),
              source: "herdr",
              ...(id === `herdr:${agent.terminalId}`
                ? {}
                : { previousId: `herdr:${agent.terminalId}` }),
            },
          ];
        });
      }),
  };

  /** Shared capacity's keys and provider instances follow the workspaces that grant them. */
  const capacityLifecycle = (event: PeerLifecycleEvent) =>
    Effect.gen(function* () {
      const keys = Object.keys((yield* state.read).persisted.sharedInstances);
      if (event.kind === "signing-out") {
        // Revoked while the Hub session still holds.
        for (const key of keys) {
          const [workspace = "", projectId = ""] = key.split("/");
          yield* turnOffShared(workspace, projectId);
        }
      } else if (event.kind === "left-workspace") {
        // The hub revoked this member's keys; the local instances go too.
        for (const key of keys) {
          if (key.startsWith(`${event.workspace}/`)) yield* removeSharedInstances(key);
        }
      } else if (event.kind === "synced") {
        // Shared capacity the workspaces no longer grant (or workspaces left) goes away too.
        const stillShared = new Set(
          event.workspaces.flatMap((w) =>
            (w.manifest?.projects ?? [])
              .filter((p) => p.capacity.shared !== undefined)
              .map((p) => projectKey(w.slug, p.id)),
          ),
        );
        for (const key of keys) {
          if (!stillShared.has(key)) yield* removeSharedInstances(key);
        }
      }
    }).pipe(Effect.ignoreCause({ log: true }));

  yield* plugins.setStandIns({
    runtime: herdrRuntime,
    lifecycle: capacityLifecycle,
    // A coordination report carries memory's app runtimes first, then herdr's agents that Peer's
    // hooks did not report, within herdr's bound.
    reportSessions: (workspace, reported) =>
      Effect.sync(() => {
        const primary = [
          ...new Map(
            [...appMemoryReport(workspace), ...reported].map((session) => [session.id, session]),
          ).values(),
        ];
        const report = Herdr.boundHerdrObservations(
          primary,
          herdrCoordinationReport(workspace, primary),
        );
        herdrReportsSkipped.set(workspace, report.skipped);
        return report.sessions;
      }),
  });

  // What the broker still asks the facade for: Peer Memory.
  yield* coordination.setFacadeParts(
    PEER_MEMORY_AVAILABLE
      ? {
          memory: {
            prepare: (session, source) => Effect.runPromise(memory.prepareSession(session, source)),
            notice: (session) => Effect.runPromise(memory.sessionNotice(session)),
            cli: (session, command, args) =>
              Effect.runPromise(memoryCli.run(session, command, args)),
            checkpoint: (session, reason) => Effect.runPromise(memory.checkpoint(session, reason)),
            end: (session) => Effect.runPromise(memory.endSession(session)),
            legacySnapshot: (session, text, source) =>
              Effect.runPromise(memory.legacySnapshot(session, text, source)),
          },
        }
      : {},
  );

  const findProject = state.project;

  /**
   * herdr's agents a coordination report carries besides the sessions Peer's hooks reported, with
   * the files they changed as seen after the fact.
   */
  const herdrCoordinationReport = (
    workspace: string,
    reported: ReadonlyArray<HubApi.ReportedSession>,
  ) => {
    const s = currentState();
    return (s.herdr ?? []).flatMap((agent): HubApi.ReportedSession[] => {
      if (agent.place?.workspace !== workspace) return [];
      const id = agentKey(agent).replace(/^herdr:/, "");
      if (reported.some((session) => session.id === id)) return [];
      return [
        {
          id,
          project: agent.place.projectId,
          label: agent.title,
          ...(agent.agent === undefined ? {} : { agent: agent.agent }),
          status: agent.status,
          ...(agent.branch === undefined ? {} : { branch: agent.branch }),
          files: agent.postHocPaths ?? [],
          claims: [],
          ...(assignedTask(s.persisted, agentKey(agent), workspace, agent.place.projectId) ===
          undefined
            ? {}
            : {
                task: assignedTask(s.persisted, agentKey(agent), workspace, agent.place.projectId)!,
              }),
        },
      ];
    });
  };

  const setPlugin: PeerHub["Service"]["setPlugin"] = (input) =>
    plugins.setPlugin(input).pipe(Effect.andThen(publish));

  const enableSharedCapacity = (workspace: PersistedWorkspace, project: PeerProject) =>
    Effect.gen(function* () {
      const { hubUrl, session } = yield* requireSession;
      if (project.capacity.shared === undefined) {
        return yield* hubError(`${project.name} has no shared capacity.`);
      }
      const credentials = yield* hubApi.issueCredentials(
        hubUrl,
        session,
        workspace.slug,
        project.id,
        environmentId,
      );
      const claudeModels = credentials.models
        .filter((m) => m.harness.includes("claude"))
        .map((m) => m.id);
      if (claudeModels.length === 0) {
        yield* hubApi
          .revokeCredentials(hubUrl, session, workspace.slug, project.id, environmentId)
          .pipe(Effect.ignoreCause({ log: true }));
        return yield* hubError(
          `${project.name}'s shared capacity has no Claude models for this app yet.`,
        );
      }
      const pick = (family: string) => claudeModels.find((id) => id.includes(family));
      const homePath = NodePath.join(hubHome, workspace.slug, "claude", project.id);
      yield* Effect.tryPromise(() =>
        NodeFSP.mkdir(homePath, { recursive: true, mode: 0o700 }),
      ).pipe(
        Effect.mapError(() => hubError("Could not create the shared capacity's config directory.")),
      );
      const instanceId = sharedInstanceId(workspace.slug, project.id);
      const aliases = [
        ["ANTHROPIC_DEFAULT_OPUS_MODEL", pick("opus")],
        ["ANTHROPIC_DEFAULT_SONNET_MODEL", pick("sonnet")],
        ["ANTHROPIC_DEFAULT_HAIKU_MODEL", pick("haiku")],
      ] as const;
      yield* settings
        .updateProviderInstance({
          operation: "upsert",
          instanceId,
          instance: {
            driver: ProviderDriverKind.make("claudeAgent"),
            displayName: `${project.name} · ${workspace.name} capacity`,
            enabled: true,
            environment: [
              { name: "ANTHROPIC_BASE_URL", value: credentials.baseUrl, sensitive: false },
              { name: "ANTHROPIC_AUTH_TOKEN", value: credentials.apiKey, sensitive: true },
              // An inherited API key must not win over the gateway key.
              { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
              ...aliases.flatMap(([name, value]) =>
                value === undefined ? [] : [{ name, value, sensitive: false }],
              ),
            ],
            // Its own config directory, so no cached subscription login sits next to the gateway key.
            config: { homePath },
          },
        })
        .pipe(Effect.mapError(() => hubError("Could not save the shared capacity provider.")));
      yield* updatePersisted((p) => ({
        ...p,
        sharedInstances: {
          ...p.sharedInstances,
          [projectKey(workspace.slug, project.id)]: [instanceId],
        },
      }));
    });

  const setSharedCapacity: PeerHub["Service"]["setSharedCapacity"] = Effect.fn(
    "PeerHub.setSharedCapacity",
  )(function* (input) {
    const { workspace, project } = yield* findProject(input.workspace, input.projectId);
    const key = projectKey(workspace.slug, project.id);
    const clearError = updateRuntime((s) => {
      const sharedErrors = new Map(s.sharedErrors);
      sharedErrors.delete(key);
      return { ...s, sharedErrors };
    });
    if (input.enabled) {
      const result = yield* enableSharedCapacity(workspace, project).pipe(Effect.result);
      if (result._tag === "Failure") {
        yield* updateRuntime((s) => ({
          ...s,
          sharedErrors: new Map(s.sharedErrors).set(key, result.failure.detail),
        }));
        yield* publish;
        return yield* result.failure;
      }
    } else {
      yield* turnOffShared(workspace.slug, project.id);
    }
    yield* clearError;
    return yield* publish;
  }, lock.withPermits(1));

  const projectUsage: PeerHub["Service"]["projectUsage"] = Effect.fn("PeerHub.projectUsage")(
    function* (input) {
      const { hubUrl, session } = yield* requireSession;
      return yield* hubApi.projectUsage(hubUrl, session, input.workspace, input.projectId);
    },
  );

  const focusAgent: PeerHub["Service"]["focusAgent"] = Effect.fn("PeerHub.focusAgent")(
    function* (input) {
      yield* Effect.tryPromise(() => Herdr.focusHerdrAgent(input.paneId)).pipe(
        Effect.mapError(() =>
          hubError("herdr could not bring that agent forward. Is herdr running?"),
        ),
      );
      return yield* publish;
    },
  );

  const knowledgeCandidates: PeerHub["Service"]["knowledgeCandidates"] = (input) =>
    requireSession.pipe(
      Effect.flatMap(({ hubUrl, session }) =>
        hubApi.candidates(hubUrl, session, input.workspace, input.project),
      ),
    );

  const decideCandidate: PeerHub["Service"]["decideCandidate"] = Effect.fn(
    "PeerHub.decideCandidate",
  )(function* (input) {
    const { hubUrl, session } = yield* requireSession;
    yield* hubApi.decideCandidate(
      hubUrl,
      session,
      input.workspace,
      input.project,
      input.id,
      input.status,
    );
    // The count waiting in Work follows from the next view.
    yield* coordination.hubChanged;
    return yield* publish;
  });

  // ---- the project's knowledge (kontext, `.ai/` in its repository) ----

  let kontextInstalled: boolean | undefined;
  const kontextAvailable = Effect.promise(async () => {
    kontextInstalled ??=
      (await Knowledge.runKontext(["--version"], NodeOS.homedir(), undefined, 15_000)).code === 0;
    return kontextInstalled;
  });
  /** Wording entries with kontext's llm adapter runs on this person's own account; off for tests. */
  const knowledgeLlm = process.env.PEER_KNOWLEDGE_LLM !== "off";
  const lastLine = (run: Knowledge.KontextRun) =>
    `${run.stderr}\n${run.stdout}`.trim().split("\n").at(-1) ?? `exit ${run.code}`;

  /** A workspace project's checkouts on this computer, the one that keeps kontext knowledge first. */
  const knowledgeCheckouts = (s: RuntimeState, workspace: string, projectId: string) => {
    const project = s.persisted.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.manifest?.projects.find((candidate) => candidate.id === projectId);
    return (project?.repositories ?? [])
      .filter((repo) => safeId(repo.id))
      .map((repo) => checkoutPath(s.persisted, workspace, projectId, repo.id))
      .filter((path) => hasGitCheckout(path))
      .toSorted((a, b) => Number(Knowledge.hasStore(b)) - Number(Knowledge.hasStore(a)));
  };

  /** A task as people name it on this computer, or the project's work outside tasks. */
  const workName = (s: RuntimeState, workspace: string, projectId: string, task?: string) =>
    task === undefined ? "work outside tasks" : taskName(s.work, workspace, projectId, task);

  const knowledgeStatusOf = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      const [checkout] = knowledgeCheckouts(yield* state.read, workspace, projectId);
      const kontext = yield* kontextAvailable;
      const store = checkout !== undefined && Knowledge.hasStore(checkout);
      const guidance =
        checkout !== undefined && store
          ? yield* Effect.promise(() => Knowledge.projectGuidance(checkout))
          : null;
      return {
        checkout: checkout ?? null,
        store,
        kontext,
        llm: kontext && knowledgeLlm,
        guidance: guidance?.text ?? null,
      } satisfies PeerKnowledgeStatus;
    });

  /** The checkout keeping the project's knowledge here, or why there is none. */
  const knowledgeStore = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      const status = yield* knowledgeStatusOf(workspace, projectId);
      if (status.checkout === null) {
        return yield* hubError("This project is not on this computer: clone it first.");
      }
      if (!status.kontext) {
        return yield* hubError("kontext is not installed here (semans.github.io/kontext).");
      }
      if (!status.store) {
        return yield* hubError(
          `This project keeps no knowledge yet: set it up (kontext init in ${status.checkout}).`,
        );
      }
      return { ...status, checkout: status.checkout };
    });

  const knowledgeStatus: PeerHub["Service"]["knowledgeStatus"] = (input) =>
    knowledgeStatusOf(input.workspace, input.project);

  const setupKnowledge: PeerHub["Service"]["setupKnowledge"] = Effect.fn("PeerHub.setupKnowledge")(
    function* (input) {
      const status = yield* knowledgeStatusOf(input.workspace, input.project);
      const checkout = status.checkout;
      if (checkout === null) {
        return yield* hubError("This project is not on this computer: clone it first.");
      }
      if (!status.kontext) {
        return yield* hubError("kontext is not installed here (semans.github.io/kontext).");
      }
      if (!status.store) {
        const run = yield* Effect.promise(() => Knowledge.runKontext(["init"], checkout));
        if (run.code !== 0) return yield* hubError(`kontext init failed: ${lastLine(run)}`);
      }
      return yield* knowledgeStatusOf(input.workspace, input.project);
    },
  );

  const keepCandidate: PeerHub["Service"]["keepCandidate"] = Effect.fn("PeerHub.keepCandidate")(
    function* (input) {
      const store = yield* knowledgeStore(input.workspace, input.project);
      const checkout = store.checkout;
      const { hubUrl, session } = yield* requireSession;
      const candidate = (yield* hubApi.candidates(
        hubUrl,
        session,
        input.workspace,
        input.project,
      )).find((one) => one.id === input.id);
      if (candidate === undefined) return yield* hubError("That candidate is no longer there.");
      const s = yield* state.read;
      const where = (task: string | undefined) => workName(s, input.workspace, input.project, task);
      const kontext = (args: ReadonlyArray<string>, stdin?: string) =>
        Effect.promise(() => Knowledge.runKontext(args, checkout, stdin));
      // An entry already in the knowledge may say the same: the person checks before committing.
      const related = Knowledge.relatedTitle(
        (yield* kontext(["search", "--json", "-n", "3", "-s", "local", candidate.text])).stdout,
      );
      const kind = candidate.kind ?? "learning";
      let id: string | null = null;
      // Why kontext's model did not word it, when it is kept as the agents wrote it.
      let asWritten: string | null = null;
      if (candidate.detail !== undefined) {
        // Already worded, e.g. read from a task's context: written as it is.
        const run = yield* kontext([
          "capture",
          "--kind",
          kind,
          "--title",
          candidate.text,
          "--body",
          candidate.detail,
        ]);
        id = Knowledge.capturedId(run.stdout);
      } else if (store.llm) {
        // kontext words it, with the shared context of the work it came from.
        const task = candidate.sources[0]?.task;
        const scope = task === undefined ? "project" : `task:${task}`;
        const context = yield* hubApi
          .readContext(hubUrl, session, input.workspace, input.project, scope)
          .pipe(Effect.orElseSucceed(() => null));
        const run = yield* kontext(
          ["distill", "--max", "1", "-"],
          Knowledge.keepThread({
            project: input.project,
            candidate,
            where,
            context: context === null ? undefined : { subject: where(task), text: context.text },
          }),
        );
        id = Knowledge.distilledIds(run.stdout)[0] ?? null;
        if (id === null) asWritten = Knowledge.distillMiss(run);
      }
      if (id === null) {
        const run = yield* kontext([
          "capture",
          "--kind",
          kind,
          "--title",
          Knowledge.titleOf(candidate.text),
          "--body",
          Knowledge.directBody(candidate, where),
        ]);
        id = Knowledge.capturedId(run.stdout);
        if (id === null) return yield* hubError(`kontext did not take it: ${lastLine(run)}`);
      }
      const promoted = yield* kontext(["promote", id]);
      const path = Knowledge.promotedPath(promoted.stdout);
      if (path === null)
        return yield* hubError(`kontext could not write it: ${lastLine(promoted)}`);
      const entry = Knowledge.entryParts(
        yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(checkout, path), "utf8").catch(() => ""),
        ),
      );
      const keptAs = {
        path,
        title: entry.fields.title ?? Knowledge.titleOf(candidate.text),
        kind: entry.fields.kind ?? kind,
      };
      yield* hubApi.decideCandidate(
        hubUrl,
        session,
        input.workspace,
        input.project,
        input.id,
        "promoted",
        keptAs,
      );
      yield* coordination.hubChanged;
      yield* publish;
      return { checkout, keptAs, related, asWritten };
    },
  );

  const harvestContext: PeerHub["Service"]["harvestContext"] = Effect.fn("PeerHub.harvestContext")(
    function* (input) {
      const store = yield* knowledgeStore(input.workspace, input.project);
      if (!store.llm) {
        return yield* hubError("Reading a context for what to keep needs kontext's llm adapter.");
      }
      const { hubUrl, session } = yield* requireSession;
      const context = yield* hubApi.readContext(
        hubUrl,
        session,
        input.workspace,
        input.project,
        input.scope,
      );
      if (context === null || context.text.trim() === "") {
        return yield* hubError("Nobody has written that context yet.");
      }
      const task = input.scope.startsWith("task:") ? input.scope.slice("task:".length) : undefined;
      const s = yield* state.read;
      const run = yield* Effect.promise(() =>
        Knowledge.runKontext(
          ["distill", "--dry-run", "--max", "3", "-"],
          store.checkout,
          Knowledge.harvestThread({
            project: input.project,
            subject: workName(s, input.workspace, input.project, task),
            text: context.text,
          }),
        ),
      );
      if (run.code !== 0) return yield* hubError(`kontext could not read it: ${lastLine(run)}`);
      const entries = Knowledge.dryRunEntries(run.stdout);
      for (const entry of entries) {
        yield* hubApi.proposeCandidate(hubUrl, session, input.workspace, input.project, {
          text: entry.title,
          kind: entry.kind,
          detail:
            entry.paths.length === 0
              ? entry.body
              : `${entry.body}\n\nFiles: ${entry.paths.join(", ")}`,
          ...(task === undefined ? {} : { task }),
          origin: `context:${input.scope}@v${context.version}`,
        });
      }
      yield* coordination.hubChanged;
      return { proposed: entries.length };
    },
  );

  const improveGuidance: PeerHub["Service"]["improveGuidance"] = Effect.fn(
    "PeerHub.improveGuidance",
  )(function* (input) {
    const store = yield* knowledgeStore(input.workspace, input.project);
    if (!store.llm) return yield* hubError("Proposing guidance needs kontext's llm adapter.");
    const { hubUrl, session } = yield* requireSession;
    const candidates = yield* hubApi.candidates(hubUrl, session, input.workspace, input.project);
    // The labels are people's decisions on what agents marked; a harvest is not an agent's mark.
    const marked = (candidate: (typeof candidates)[number]) =>
      candidate.sources.some((source) => source.tagged && source.origin === undefined);
    const decided = candidates.filter((candidate) => candidate.status !== "proposed");
    if (decided.length < 3) {
      return yield* hubError(
        `Keep or dismiss a few more candidates first: ${decided.length} decided, 3 needed.`,
      );
    }
    const current = yield* Effect.promise(() => Knowledge.projectGuidance(store.checkout));
    const run = yield* Effect.promise(() =>
      Knowledge.runKontext(
        ["distill", "--dry-run", "--max", "1", "-"],
        store.checkout,
        Knowledge.guidanceThread({
          project: input.project,
          current: current?.text ?? null,
          kept: decided.filter((c) => c.status === "promoted" && marked(c)).map((c) => c.text),
          dismissed: decided
            .filter((c) => c.status === "dismissed" && marked(c))
            .map((c) => c.text),
          missed: decided.filter((c) => c.status === "promoted" && !marked(c)).map((c) => c.text),
        }),
      ),
    );
    const [entry] = Knowledge.dryRunEntries(run.stdout);
    if (entry === undefined) return yield* hubError(`kontext proposed nothing: ${lastLine(run)}`);
    const capture = yield* Effect.promise(() =>
      Knowledge.runKontext(
        [
          "capture",
          "--kind",
          "convention",
          "--tags",
          "peer-skill",
          "--title",
          entry.title,
          "--body",
          entry.body,
          ...(current === null ? [] : ["--supersedes", current.id]),
        ],
        store.checkout,
      ),
    );
    const id = Knowledge.capturedId(capture.stdout);
    if (id === null) return yield* hubError(`kontext did not take it: ${lastLine(capture)}`);
    const promoted = yield* Effect.promise(() =>
      Knowledge.runKontext(["promote", id], store.checkout),
    );
    const path = Knowledge.promotedPath(promoted.stdout);
    if (path === null) return yield* hubError(`kontext could not write it: ${lastLine(promoted)}`);
    return { checkout: store.checkout, path, title: entry.title };
  });

  const watchAgent: PeerHub["Service"]["watchAgent"] = (input) =>
    Stream.tick("1 second").pipe(
      Stream.mapEffect(() => agentView(input.agentId)),
      Stream.changesWith(sameAgentView),
    );

  const promptAgent: PeerHub["Service"]["promptAgent"] = Effect.fn("PeerHub.promptAgent")(
    function* (input) {
      const agent = ((yield* state.read).herdr ?? []).find(
        (candidate) =>
          agentKey(candidate) === input.agentId ||
          `herdr:${candidate.terminalId}` === input.agentId,
      );
      if (agent === undefined) return yield* hubError("That agent no longer runs in herdr.");
      if (agent.status === "blocked") {
        return yield* hubError(
          "It is waiting for an answer in its terminal. Answer it in herdr first.",
        );
      }
      yield* Effect.tryPromise(() => Herdr.promptHerdrAgent(agent.paneId, input.text)).pipe(
        Effect.mapError((error) =>
          hubError(
            `herdr did not take the prompt${error.cause instanceof Error ? `: ${error.cause.message}` : "."}`,
          ),
        ),
      );
      yield* refreshHerdr;
      return yield* publish;
    },
  );

  const startAgent: PeerHub["Service"]["startAgent"] = Effect.fn("PeerHub.startAgent")(
    function* (input) {
      yield* requireSession;
      const { workspace, project } = yield* findProject(input.workspace, input.projectId);
      const task = (yield* state.read).work
        .get(projectKey(workspace.slug, project.id))
        ?.tasks.find((task) => task.id === input.taskId);
      if (task === undefined || task.status === "done")
        return yield* hubError("Select an open task in this project first.");
      const repository = project.repositories.find(
        (repository) => repository.id === input.repositoryId,
      );
      if (repository === undefined || !safeId(repository.id))
        return yield* hubError("That repository does not belong to this project.");
      if (project.capacity.personal !== "any")
        return yield* hubError(
          "This project needs an approved commercial or shared provider. Start a Peer thread with an allowed provider instead.",
        );
      // Starting from a team request needs team requests, which say whether it still waits.
      const acceptor =
        input.requestId === undefined ? undefined : yield* plugins.require("requestAcceptor");
      if ((yield* Effect.promise(() => Herdr.listHerdrAgents())) === null)
        return yield* hubError(
          "herdr is not running on this environment. Install it from https://herdr.dev/docs/install/, start herdr here, then try again.",
        );
      const checkout = checkoutPath(
        (yield* state.read).persisted,
        workspace.slug,
        project.id,
        repository.id,
      );
      const tree = yield* Effect.tryPromise(() =>
        Herdr.prepareHerdrTaskWorktree({
          checkout,
          baseBranch: repository.branch,
          worktrees: NodePath.join(
            workspaceRoot,
            ".worktrees",
            workspace.slug,
            project.id,
            repository.id,
          ),
          task: task.key ?? task.id,
        }),
      ).pipe(
        Effect.mapError((error) =>
          hubError(
            `Could not prepare the task checkout: ${error.cause instanceof Error ? error.cause.message : "check the local repository branch."}`,
          ),
        ),
      );
      let requestedPrompt: string | undefined;
      if (acceptor !== undefined && input.requestId !== undefined) {
        requestedPrompt = (yield* acceptor.accept({
          workspace: workspace.slug,
          project: project.id,
          task: task.id,
          requestId: input.requestId,
        })).prompt;
        // Publish the accepted ownership even if runtime startup later fails.
        yield* refreshWork;
        yield* publish;
      }
      const claudeMod = adapters.claudeMod();
      const started = yield* Effect.tryPromise(() =>
        Herdr.startHerdrAgent({
          cwd: tree.cwd,
          harness: input.harness,
          env: {
            PEER_TASK: task.key ?? task.id,
            ...(claudeMod !== undefined && input.harness === "claude"
              ? { PEER_CLAUDE_MOD_DIR: claudeMod }
              : {}),
          },
        }),
      ).pipe(
        Effect.mapError((error) =>
          hubError(
            `herdr did not start the agent${error.cause instanceof Error ? `: ${error.cause.message}` : "."} The task checkout remains at ${tree.cwd}.${input.requestId === undefined ? "" : " The request is accepted. Inspect herdr and the task before starting another agent."}`,
          ),
        ),
      );
      yield* updatePersisted((p) => ({
        ...p,
        assignments: {
          ...p.assignments,
          [`herdr:${started.terminalId}`]: {
            workspace: workspace.slug,
            project: project.id,
            task: task.id,
          },
        },
      }));
      // Show it at once; herdr's events would say within a moment.
      yield* refreshHerdr;
      const agent = ((yield* state.read).herdr ?? []).find(
        (agent) => agent.terminalId === started.terminalId,
      );
      let promptError = started.promptError;
      if (agent !== undefined) {
        yield* keepAssignments([agent]);
        if (agent.status === "blocked")
          promptError =
            "The agent is waiting for an answer in herdr. Answer it there, then send the task prompt.";
        else {
          const prompt =
            input.prompt?.trim() ||
            requestedPrompt ||
            `${task.key === undefined ? "" : `${task.key}: `}${task.title}. Work in your own checkout and coordinate shared changes through Peer.`;
          const sent = yield* Effect.tryPromise(() =>
            Herdr.promptHerdrAgent(agent.name ?? agent.paneId, prompt),
          ).pipe(Effect.result);
          if (sent._tag === "Failure")
            promptError = `The task prompt could not be confirmed. Read the agent before retrying: ${sent.failure.cause instanceof Error ? sent.failure.cause.message : "herdr did not answer"}.`;
        }
      } else
        promptError =
          "The agent started but is not visible yet. Check herdr before sending its task prompt.";
      yield* refreshWork;
      yield* publish;
      return { ...started, ...(promptError === undefined ? {} : { promptError }) };
    },
  );

  const importedKnowledge = new Set<string>();
  const refreshMemory = Effect.fn("PeerHub.refreshMemory")(function* (only?: string) {
    if (!PEER_MEMORY_AVAILABLE) return;
    if (Option.isNone(yield* requireSession.pipe(Effect.option))) return;
    for (const [id, runtime] of appMemorySessions) {
      const caller = yield* projections.getThreadShell(runtime.threadId).pipe(Effect.option);
      if (
        Option.isNone(caller) ||
        caller.value === null ||
        caller.value.deletedAt !== null ||
        caller.value.archivedAt !== null ||
        caller.value.activeRunId === null ||
        caller.value.providerInstanceId !== runtime.providerInstanceId
      ) {
        yield* memory.endSession(runtime.session).pipe(Effect.ignore);
        appMemorySessions.delete(id);
      }
    }
    const persisted = (yield* state.read).persisted;
    for (const workspace of persisted.workspaces) {
      if ((only !== undefined && workspace.slug !== only) || workspace.manifest === null) continue;
      const scopes = [
        ...workspace.manifest.projects.map((project) => ({
          workspace: workspace.slug,
          project: project.id,
          repositories: project.repositories.map((repo) => ({
            repositoryId: repo.id,
            root: checkoutPath(persisted, workspace.slug, project.id, repo.id),
            branch: repo.branch,
          })),
        })),
        {
          workspace: workspace.slug,
          project: "company",
          repositories:
            workspace.manifest.knowledge.company === undefined
              ? []
              : [
                  {
                    repositoryId: "company",
                    root: knowledgePath(workspace.slug),
                    branch: workspace.manifest.knowledge.company.branch,
                  },
                ],
        },
      ];
      for (const scope of scopes) {
        const synced = yield* memory.synchronize(scope).pipe(Effect.option);
        if (Option.isNone(synced) || !synced.value.available || synced.value.mode === "legacy")
          continue;
        for (const repo of scope.repositories) {
          const revision = yield* MemoryKnowledge.approvedRevision(repo.root, repo.branch).pipe(
            Effect.option,
          );
          if (Option.isNone(revision)) continue;
          const key = `${persisted.email}/${scope.workspace}/${scope.project}/${repo.repositoryId}/${revision.value}`;
          if (importedKnowledge.has(key)) continue;
          const result = yield* memory
            .importKnowledge({
              workspace: scope.workspace,
              project: scope.project,
              repositoryId: repo.repositoryId,
              commit: revision.value,
              reviewRef: repo.branch,
            })
            .pipe(Effect.provide(memoryAuthLayer), Effect.option);
          if (
            Option.isSome(result) &&
            result.value.operations.every((operation) => operation.status === "stored")
          )
            importedKnowledge.add(key);
        }
      }
    }
  });
  // Keep the manifests fresh and colleagues' presence current.
  yield* Effect.forever(
    Effect.sleep(MANIFEST_INTERVAL).pipe(
      Effect.andThen(requireSession.pipe(Effect.option)),
      Effect.flatMap((signedIn) =>
        Option.isSome(signedIn) ? workspaces.sync.pipe(Effect.ignore) : Effect.void,
      ),
    ),
  ).pipe(Effect.forkScoped);
  yield* Effect.forever(
    Effect.sleep(WORK_INTERVAL).pipe(
      Effect.andThen(refreshWork),
      Effect.andThen(publish),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);
  yield* followHerdr.pipe(Effect.forkScoped);
  yield* events
    .follow({
      readWork: work.readWork,
      coordinationChanged: coordination.hubChanged,
      projectsChanged: background(workspaces.sync),
      // Features not moved into plugins yet listen here, their pings dispatched as plugins' are.
      listeners: [
        {
          changes: ["memory.changed"],
          ownEcho: true,
          onPing: (ping) => refreshMemory(ping.workspace).pipe(Effect.ignoreCause({ log: true })),
        },
      ],
    })
    .pipe(Effect.forkScoped);
  yield* Effect.forever(
    Effect.sleep("15 seconds").pipe(
      Effect.andThen(refreshMemory()),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);
  yield* PeerPlugins.startPlugins;
  if ((yield* state.read).persisted.coordination?.enabled === true) {
    yield* background(coordination.start);
  }
  // Publish the persisted state right away so policy and tools apply before the first sync.
  yield* publish.pipe(
    Effect.andThen(requireSession.pipe(Effect.option)),
    Effect.flatMap((signedIn) =>
      Option.isSome(signedIn) ? workspaces.sync.pipe(Effect.ignore) : Effect.void,
    ),
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );

  return PeerHub.of({
    memoryQueue,
    memoryRetry,
    memoryDiscard,
    memoryState,
    memoryMode,
    memorySetMode,
    memorySearch,
    memoryRead,
    memoryProject,
    memoryExecute,
    memoryChanges,
    memoryReceipts,
    memoryKeep,
    memoryImportKnowledge,
    memoryAgent,
    memoryRuntime,
    memoryAgentContext,
    memoryAgentExecute,
    memoryAgentProject,
    memoryAgentReceipt,
    status: publish,
    streamStatus: peerStatus.changes,
    startSignIn: workspaces.startSignIn,
    finishSignIn: workspaces.finishSignIn,
    signOut: workspaces.signOut,
    sync: workspaces.sync,
    createWorkspace: workspaces.createWorkspace,
    joinWorkspace: workspaces.joinWorkspace,
    leaveWorkspace: workspaces.leaveWorkspace,
    invite: workspaces.invite,
    findWorkspace: workspaces.findWorkspace,
    openProject: workspaces.openProject,
    setCoordination: adapters.setCoordination,
    setPlugin,
    noteOverlap: coordination.noteOverlap,
    resolveOverlap: coordination.resolveOverlap,
    settleOverlap: coordination.settleOverlap,
    setSharedCapacity,
    projectUsage,
    createTask: work.createTask,
    updateTask: work.updateTask,
    deleteTask: work.deleteTask,
    assignThread: work.assignThread,
    focusAgent,
    watchAgent,
    promptAgent,
    startAgent,
    getCoordEvents: coordination.coordEvents,
    getStaleReads: coordination.staleReads,
    readContext: coordination.readContext,
    contextVersions: coordination.contextVersions,
    readContextVersion: coordination.readContextVersion,
    restoreContext: coordination.restoreContext,
    knowledgeCandidates,
    decideCandidate,
    knowledgeStatus,
    setupKnowledge,
    keepCandidate,
    harvestContext,
    improveGuidance,
    shareProject: workspaces.shareProject,
    unshareProject: workspaces.unshareProject,
  });
});

/** Peer's core services, as they are carved out of this facade. */
const coreLayer = PeerAdapters.layer.pipe(
  Layer.provideMerge(PeerCoordination.layer),
  Layer.provideMerge(PeerWorkspaces.layer),
  Layer.provideMerge(PeerHubEvents.layer),
  Layer.provideMerge(PeerWork.layer),
  Layer.provideMerge(PeerStatus.layer),
  Layer.provideMerge(PeerPlugins.layer),
  Layer.provideMerge(PeerHubClient.layer),
  Layer.provideMerge(PeerState.layer),
);

export const layer = Layer.effect(PeerHub, make).pipe(Layer.provideMerge(coreLayer));

const PEER_TRACE = { "rpc.aggregate": "peerHub" } as const;
const MEMORY_TRACE = { "rpc.aggregate": "peerHub.memory" } as const;

/** A plugin's methods refused while it is inactive, before anything runs. */
const guarded = (
  wrap: PeerRpcWrap,
  plugins: PeerPlugins.PeerPlugins["Service"],
  id: string,
): PeerRpcWrap => ({
  effect: (method, effect, traceAttributes) =>
    wrap.effect(method, plugins.requireActive(id).pipe(Effect.andThen(effect)), traceAttributes),
  stream: (method, stream, traceAttributes) =>
    wrap.stream(
      method,
      Stream.unwrap(plugins.requireActive(id).pipe(Effect.as(stream))),
      traceAttributes,
    ),
});

/**
 * A plugin's RPC group bound to its handlers. Their types live in the plugin's contract file; the
 * registry holds every plugin in one list, so they meet here erased.
 */
const pluginRpcLayer = (rpc: PeerRpcContribution, wrap: PeerRpcWrap): Layer.Layer<never> =>
  (rpc.group as RpcGroup.RpcGroup<Rpc.Any>).toLayer(
    rpc.handlers(wrap) as never,
  ) as Layer.Layer<never>;

/** Handlers for every method of the contracts' `PeerRpcGroup`. */
type PeerRpcHandlers = Rpc.ToHandler<RpcGroup.Rpcs<typeof PeerRpcGroup>>;

/**
 * Peer's WebSocket RPC handlers: core's, and each plugin's, refused while that plugin is inactive.
 * `ws.ts` merges them with T3's, handing over its per-connection authorization and tracing. It
 * serves every method of the contracts' `PeerRpcGroup`: a plugin's handlers come from its
 * contributions, whose group is listed there too.
 */
export const rpcLayer = (
  wrap: PeerRpcWrap,
): Layer.Layer<PeerRpcHandlers, never, PeerHub | PeerPlugins.PeerPlugins> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const peerHub = yield* PeerHub;
      const plugins = yield* PeerPlugins.PeerPlugins;
      const core = PeerCoreRpcGroup.toLayer(
        PeerCoreRpcGroup.of({
          [PEER_CORE_METHODS.peerHubSubscribe]: (_input) =>
            wrap.stream(PEER_CORE_METHODS.peerHubSubscribe, peerHub.streamStatus, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubStartSignIn]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubStartSignIn,
              peerHub.startSignIn(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubFinishSignIn]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubFinishSignIn,
              peerHub.finishSignIn(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSignOut]: (_input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSignOut, peerHub.signOut, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubSync]: (_input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSync, peerHub.sync, PEER_TRACE),
          [PEER_CORE_METHODS.peerHubCreateWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubCreateWorkspace,
              peerHub.createWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubJoinWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubJoinWorkspace,
              peerHub.joinWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubLeaveWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubLeaveWorkspace,
              peerHub.leaveWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubCreateTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubCreateTask, peerHub.createTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubUpdateTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubUpdateTask, peerHub.updateTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubDeleteTask]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubDeleteTask, peerHub.deleteTask(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubAssignThread]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubAssignThread,
              peerHub.assignThread(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubFocusAgent]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubFocusAgent, peerHub.focusAgent(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubWatchAgent]: (input) =>
            wrap.stream(PEER_CORE_METHODS.peerHubWatchAgent, peerHub.watchAgent(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubPromptAgent]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubPromptAgent,
              peerHub.promptAgent(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubStartAgent]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubStartAgent, peerHub.startAgent(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubCoordEvents]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubCoordEvents,
              peerHub.getCoordEvents(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubStaleReads]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubStaleReads,
              peerHub.getStaleReads(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubReadContext]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubReadContext,
              peerHub.readContext(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubContextVersions]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubContextVersions,
              peerHub.contextVersions(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubReadContextVersion]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubReadContextVersion,
              peerHub.readContextVersion(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubRestoreContext]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubRestoreContext,
              peerHub.restoreContext(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubKnowledgeCandidates]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubKnowledgeCandidates,
              peerHub.knowledgeCandidates(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubDecideCandidate]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubDecideCandidate,
              peerHub.decideCandidate(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubKnowledgeStatus]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubKnowledgeStatus,
              peerHub.knowledgeStatus(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetupKnowledge]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSetupKnowledge,
              peerHub.setupKnowledge(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubKeepCandidate]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubKeepCandidate,
              peerHub.keepCandidate(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubHarvestContext]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubHarvestContext,
              peerHub.harvestContext(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubImproveGuidance]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubImproveGuidance,
              peerHub.improveGuidance(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubShareProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubShareProject,
              peerHub.shareProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubUnshareProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubUnshareProject,
              peerHub.unshareProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubFindWorkspace]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubFindWorkspace,
              peerHub.findWorkspace(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubInvite]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubInvite, peerHub.invite(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubOpenProject]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubOpenProject,
              peerHub.openProject(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetCoordination]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSetCoordination,
              peerHub.setCoordination(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSetPlugin]: (input) =>
            wrap.effect(PEER_CORE_METHODS.peerHubSetPlugin, peerHub.setPlugin(input), PEER_TRACE),
          [PEER_CORE_METHODS.peerHubNoteOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubNoteOverlap,
              peerHub.noteOverlap(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubResolveOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubResolveOverlap,
              peerHub.resolveOverlap(input),
              PEER_TRACE,
            ),
          [PEER_CORE_METHODS.peerHubSettleOverlap]: (input) =>
            wrap.effect(
              PEER_CORE_METHODS.peerHubSettleOverlap,
              peerHub.settleOverlap(input),
              PEER_TRACE,
            ),
        }),
      );
      // Shared capacity's methods, served here until it becomes a plugin.
      const capacity = CapacityRpcGroup.toLayer(
        CapacityRpcGroup.of({
          [PEER_CAPACITY_METHODS.peerHubSetSharedCapacity]: (input) =>
            wrap.effect(
              PEER_CAPACITY_METHODS.peerHubSetSharedCapacity,
              peerHub.setSharedCapacity(input),
              PEER_TRACE,
            ),
          [PEER_CAPACITY_METHODS.peerHubProjectUsage]: (input) =>
            wrap.effect(
              PEER_CAPACITY_METHODS.peerHubProjectUsage,
              peerHub.projectUsage(input),
              PEER_TRACE,
            ),
        }),
      );
      const memory = WsPeerMemoryRpcGroup.toLayer(
        WsPeerMemoryRpcGroup.of({
          [PEER_MEMORY_METHODS.peerHubMemoryQueue]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryQueue,
              peerHub.memoryQueue(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryRetry]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryRetry,
              peerHub.memoryRetry(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryDiscard]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryDiscard,
              peerHub.memoryDiscard(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryState]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryState,
              peerHub.memoryState(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryMode]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryMode,
              peerHub.memoryMode(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemorySetMode]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemorySetMode,
              peerHub.memorySetMode(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryExecute]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryExecute,
              peerHub.memoryExecute(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemorySearch]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemorySearch,
              peerHub.memorySearch(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryRead]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryRead,
              peerHub.memoryRead(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryProject]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryProject,
              peerHub.memoryProject(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryChanges]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryChanges,
              peerHub.memoryChanges(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryReceipts]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryReceipts,
              peerHub.memoryReceipts(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryKeep]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryKeep,
              peerHub.memoryKeep(input),
              MEMORY_TRACE,
            ),
          [PEER_MEMORY_METHODS.peerHubMemoryImportKnowledge]: (input) =>
            wrap.effect(
              PEER_MEMORY_METHODS.peerHubMemoryImportKnowledge,
              peerHub.memoryImportKnowledge(input),
              MEMORY_TRACE,
            ),
        }),
      );
      const theirs = (yield* plugins.built).flatMap(({ state, contributions }) =>
        contributions.rpc === undefined
          ? []
          : [pluginRpcLayer(contributions.rpc, guarded(wrap, plugins, state.id))],
      );
      // The plugins' handlers come from their contributions while Peer starts, so the type system
      // cannot see that they cover the plugins' groups in `PeerRpcGroup`.
      return Layer.mergeAll(core, capacity, memory, ...theirs) as Layer.Layer<PeerRpcHandlers>;
    }),
  );

/**
 * Peer's MCP toolkits, registered when the server starts: Peer Memory's while the build includes
 * it, and each plugin's, whose tools refuse their calls while the plugin is inactive.
 */
export const mcpLayer = Layer.unwrap(
  Effect.gen(function* () {
    const toolkits = yield* (yield* PeerPlugins.PeerPlugins).toolkits;
    const memory = PEER_MEMORY_AVAILABLE ? yield* Effect.promise(memoryToolkit) : Layer.empty;
    return Layer.mergeAll(memory, ...toolkits);
  }),
);

/**
 * Peer Memory's toolkit. It is imported when the server starts rather than with this module: its
 * service imports this module, until memory moves into its plugin.
 */
const memoryToolkit = async () => {
  const [{ PeerMemoryToolkit }, { PeerMemoryHandlersLive }, PeerMemoryMcpService] =
    await Promise.all([
      import("../mcp/toolkits/peerMemory/tools.ts"),
      import("../mcp/toolkits/peerMemory/handlers.ts"),
      import("../mcp/PeerMemoryMcpService.ts"),
    ]);
  return McpServer.toolkit(PeerMemoryToolkit).pipe(
    Layer.provide(PeerMemoryHandlersLive),
    Layer.provide(PeerMemoryMcpService.layer),
  );
};
