/**
 * Peer's WebSocket RPCs. Core's group and each plugin's group merge into `PeerRpcGroup`, which
 * `rpc.ts` merges into `WsRpcGroup`; their scopes merge into `PEER_RPC_SCOPES`, which the server's
 * authorization table spreads. A plugin whose contracts move to `peer/<id>.rpc.ts` adds its
 * methods, group and scopes here, one line each.
 *
 * Method names never change, so clients of every age keep working: moved methods keep
 * `peerHub.<name>`, new plugins use `peer.<id>.<name>`.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import {
  PeerHubCreateWorkspaceInput,
  PeerHubError,
  PeerFoundWorkspace,
  PeerHubAssignThreadInput,
  PeerHubCreateTaskInput,
  PeerHubFindWorkspaceInput,
  PeerHubOverlapNoteInput,
  PeerHubResolveOverlapInput,
  PeerHubSettleOverlapInput,
  PeerHubSetCoordinationInput,
  PeerHubShareProjectInput,
  PeerHubTaskInput,
  PeerHubUpdateTaskInput,
  PeerHubFinishSignInInput,
  PeerHubInviteInput,
  PeerHubProjectInput,
  PeerHubStartSignInInput,
  PeerHubStatus,
  PeerHubWorkspaceInput,
  PeerHubContextInput,
  PeerHubContextVersionInput,
  PeerContextVersion,
  PeerContextVersionText,
  PeerWorkContextText,
  PeerHubStartAgentInput,
  PeerHubStartAgentResult,
  PeerHubCoordEventsInput,
  PeerHubStaleReadsInput,
  PeerCoordEvent,
  PeerStaleReads,
} from "../peerHub.ts";
import {
  PeerHubMemoryStateInput,
  PeerMemoryState,
  PeerHubMemoryModeInput,
  PeerHubMemorySetModeInput,
  PeerHubMemoryExecuteInput,
  PeerMemoryWriteResult,
  PeerHubMemorySearchInput,
  PeerMemorySearchResult,
  PeerHubMemoryReadInput,
  PeerMemoryRecordView,
  PeerHubMemoryProjectInput,
  PeerMemoryProjection,
  PeerHubMemoryChangesInput,
  PeerMemoryChanges,
  PeerHubMemoryReceiptsInput,
  PeerHubMemoryKeepInput,
  PeerMemoryKept,
  PeerHubMemoryImportKnowledgeInput,
  PeerMemoryMode,
  PeerMemoryReceipt,
  PeerHubMemoryQueueInput,
  PeerMemoryQueue,
  PeerHubMemoryRetryInput,
  PeerHubMemoryDiscardInput,
  PeerMemoryDiscarded,
} from "../peerMemory.ts";
import { CapacityRpcGroup, CapacityRpcScopes, PEER_CAPACITY_METHODS } from "./capacity.rpc.ts";
import { GitHubRpcGroup, GitHubRpcScopes, PEER_GITHUB_METHODS } from "./github.rpc.ts";
import { HerdrRpcGroup, HerdrRpcScopes, PEER_HERDR_METHODS } from "./herdr.rpc.ts";
import { KnowledgeRpcGroup, KnowledgeRpcScopes, PEER_KNOWLEDGE_METHODS } from "./knowledge.rpc.ts";
import { ObserveRpcGroup, ObserveRpcScopes, PEER_OBSERVE_METHODS } from "./observe.rpc.ts";
import { PeerHubSetPluginInput } from "./plugin.ts";
import { PEER_REQUESTS_METHODS, RequestsRpcGroup, RequestsRpcScopes } from "./requests.rpc.ts";

/** Core's methods. */
export const PEER_CORE_METHODS = {
  peerHubSubscribe: "peerHub.subscribe",
  peerHubStartSignIn: "peerHub.startSignIn",
  peerHubFinishSignIn: "peerHub.finishSignIn",
  peerHubSignOut: "peerHub.signOut",
  peerHubSync: "peerHub.sync",
  peerHubCreateWorkspace: "peerHub.createWorkspace",
  peerHubJoinWorkspace: "peerHub.joinWorkspace",
  peerHubLeaveWorkspace: "peerHub.leaveWorkspace",
  peerHubFindWorkspace: "peerHub.findWorkspace",
  peerHubCreateTask: "peerHub.createTask",
  peerHubUpdateTask: "peerHub.updateTask",
  peerHubDeleteTask: "peerHub.deleteTask",
  peerHubAssignThread: "peerHub.assignThread",
  peerHubStartAgent: "peerHub.startAgent",
  peerHubCoordEvents: "peerHub.coordEvents",
  peerHubStaleReads: "peerHub.staleReads",
  peerHubReadContext: "peerHub.readContext",
  peerHubContextVersions: "peerHub.contextVersions",
  peerHubReadContextVersion: "peerHub.readContextVersion",
  peerHubRestoreContext: "peerHub.restoreContext",
  peerHubShareProject: "peerHub.shareProject",
  peerHubUnshareProject: "peerHub.unshareProject",
  peerHubInvite: "peerHub.invite",
  peerHubOpenProject: "peerHub.openProject",
  peerHubSetCoordination: "peerHub.setCoordination",
  peerHubSetPlugin: "peerHub.setPlugin",
  peerHubNoteOverlap: "peerHub.noteOverlap",
  peerHubResolveOverlap: "peerHub.resolveOverlap",
  peerHubSettleOverlap: "peerHub.settleOverlap",
} as const;

/** Peer Memory's methods. */
export const PEER_MEMORY_METHODS = {
  peerHubMemoryState: "peerHub.memoryState",
  peerHubMemoryMode: "peerHub.memoryMode",
  peerHubMemorySetMode: "peerHub.memorySetMode",
  peerHubMemoryExecute: "peerHub.memoryExecute",
  peerHubMemorySearch: "peerHub.memorySearch",
  peerHubMemoryRead: "peerHub.memoryRead",
  peerHubMemoryProject: "peerHub.memoryProject",
  peerHubMemoryChanges: "peerHub.memoryChanges",
  peerHubMemoryReceipts: "peerHub.memoryReceipts",
  peerHubMemoryKeep: "peerHub.memoryKeep",
  peerHubMemoryImportKnowledge: "peerHub.memoryImportKnowledge",
  peerHubMemoryQueue: "peerHub.memoryQueue",
  peerHubMemoryRetry: "peerHub.memoryRetry",
  peerHubMemoryDiscard: "peerHub.memoryDiscard",
} as const;

const WsPeerHubMemoryQueueRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryQueue, {
  payload: PeerHubMemoryQueueInput,
  success: PeerMemoryQueue,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryRetryRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryRetry, {
  payload: PeerHubMemoryRetryInput,
  success: PeerMemoryWriteResult,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryDiscardRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryDiscard, {
  payload: PeerHubMemoryDiscardInput,
  success: PeerMemoryDiscarded,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryStateRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryState, {
  payload: PeerHubMemoryStateInput,
  success: PeerMemoryState,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryModeRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryMode, {
  payload: PeerHubMemoryModeInput,
  success: Schema.Struct({ mode: PeerMemoryMode }),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemorySetModeRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemorySetMode, {
  payload: PeerHubMemorySetModeInput,
  success: Schema.Struct({ mode: PeerMemoryMode }),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryExecuteRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryExecute, {
  payload: PeerHubMemoryExecuteInput,
  success: PeerMemoryWriteResult,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemorySearchRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemorySearch, {
  payload: PeerHubMemorySearchInput,
  success: PeerMemorySearchResult,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryReadRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryRead, {
  payload: PeerHubMemoryReadInput,
  success: PeerMemoryRecordView,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryProjectRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryProject, {
  payload: PeerHubMemoryProjectInput,
  success: PeerMemoryProjection,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryChangesRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryChanges, {
  payload: PeerHubMemoryChangesInput,
  success: PeerMemoryChanges,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryReceiptsRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryReceipts, {
  payload: PeerHubMemoryReceiptsInput,
  success: Schema.Struct({ receipts: Schema.Array(PeerMemoryReceipt) }),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryKeepRpc = Rpc.make(PEER_MEMORY_METHODS.peerHubMemoryKeep, {
  payload: PeerHubMemoryKeepInput,
  success: PeerMemoryKept,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubMemoryImportKnowledgeRpc = Rpc.make(
  PEER_MEMORY_METHODS.peerHubMemoryImportKnowledge,
  {
    payload: PeerHubMemoryImportKnowledgeInput,
    success: Schema.Struct({ operations: Schema.Array(PeerMemoryWriteResult) }),
    error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  },
);

const WsPeerHubSubscribeRpc = Rpc.make(PEER_CORE_METHODS.peerHubSubscribe, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsPeerHubStartSignInRpc = Rpc.make(PEER_CORE_METHODS.peerHubStartSignIn, {
  payload: PeerHubStartSignInInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubFinishSignInRpc = Rpc.make(PEER_CORE_METHODS.peerHubFinishSignIn, {
  payload: PeerHubFinishSignInInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSignOutRpc = Rpc.make(PEER_CORE_METHODS.peerHubSignOut, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSyncRpc = Rpc.make(PEER_CORE_METHODS.peerHubSync, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubCreateWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubCreateWorkspace, {
  payload: PeerHubCreateWorkspaceInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubJoinWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubJoinWorkspace, {
  payload: PeerHubWorkspaceInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubLeaveWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubLeaveWorkspace, {
  payload: PeerHubWorkspaceInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubInviteRpc = Rpc.make(PEER_CORE_METHODS.peerHubInvite, {
  payload: PeerHubInviteInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubOpenProjectRpc = Rpc.make(PEER_CORE_METHODS.peerHubOpenProject, {
  payload: PeerHubProjectInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSetCoordinationRpc = Rpc.make(PEER_CORE_METHODS.peerHubSetCoordination, {
  payload: PeerHubSetCoordinationInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** An owner turns one of Peer's plugins on or off on this environment. */
const WsPeerHubSetPluginRpc = Rpc.make(PEER_CORE_METHODS.peerHubSetPlugin, {
  payload: PeerHubSetPluginInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubNoteOverlapRpc = Rpc.make(PEER_CORE_METHODS.peerHubNoteOverlap, {
  payload: PeerHubOverlapNoteInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubResolveOverlapRpc = Rpc.make(PEER_CORE_METHODS.peerHubResolveOverlap, {
  payload: PeerHubResolveOverlapInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSettleOverlapRpc = Rpc.make(PEER_CORE_METHODS.peerHubSettleOverlap, {
  payload: PeerHubSettleOverlapInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubCreateTaskRpc = Rpc.make(PEER_CORE_METHODS.peerHubCreateTask, {
  payload: PeerHubCreateTaskInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubUpdateTaskRpc = Rpc.make(PEER_CORE_METHODS.peerHubUpdateTask, {
  payload: PeerHubUpdateTaskInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubDeleteTaskRpc = Rpc.make(PEER_CORE_METHODS.peerHubDeleteTask, {
  payload: PeerHubTaskInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubAssignThreadRpc = Rpc.make(PEER_CORE_METHODS.peerHubAssignThread, {
  payload: PeerHubAssignThreadInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubStartAgentRpc = Rpc.make(PEER_CORE_METHODS.peerHubStartAgent, {
  payload: PeerHubStartAgentInput,
  success: PeerHubStartAgentResult,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubCoordEventsRpc = Rpc.make(PEER_CORE_METHODS.peerHubCoordEvents, {
  payload: PeerHubCoordEventsInput,
  success: Schema.Array(PeerCoordEvent),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubStaleReadsRpc = Rpc.make(PEER_CORE_METHODS.peerHubStaleReads, {
  payload: PeerHubStaleReadsInput,
  success: PeerStaleReads,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A task's shared context with its text; null when it has none yet. */
const WsPeerHubReadContextRpc = Rpc.make(PEER_CORE_METHODS.peerHubReadContext, {
  payload: PeerHubContextInput,
  success: Schema.NullOr(PeerWorkContextText),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** The versions of a shared context the hub keeps, newest first. */
const WsPeerHubContextVersionsRpc = Rpc.make(PEER_CORE_METHODS.peerHubContextVersions, {
  payload: PeerHubContextInput,
  success: Schema.Array(PeerContextVersion),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubReadContextVersionRpc = Rpc.make(PEER_CORE_METHODS.peerHubReadContextVersion, {
  payload: PeerHubContextVersionInput,
  success: Schema.NullOr(PeerContextVersionText),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A person brings an older version of a shared context back, as a new version. */
const WsPeerHubRestoreContextRpc = Rpc.make(PEER_CORE_METHODS.peerHubRestoreContext, {
  payload: PeerHubContextVersionInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubShareProjectRpc = Rpc.make(PEER_CORE_METHODS.peerHubShareProject, {
  payload: PeerHubShareProjectInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubUnshareProjectRpc = Rpc.make(PEER_CORE_METHODS.peerHubUnshareProject, {
  payload: PeerHubProjectInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubFindWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubFindWorkspace, {
  payload: PeerHubFindWorkspaceInput,
  success: Schema.NullOr(PeerFoundWorkspace),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const WsPeerMemoryRpcGroup = RpcGroup.make(
  WsPeerHubMemoryQueueRpc,
  WsPeerHubMemoryRetryRpc,
  WsPeerHubMemoryDiscardRpc,
  WsPeerHubMemoryStateRpc,
  WsPeerHubMemoryModeRpc,
  WsPeerHubMemorySetModeRpc,
  WsPeerHubMemoryExecuteRpc,
  WsPeerHubMemorySearchRpc,
  WsPeerHubMemoryReadRpc,
  WsPeerHubMemoryProjectRpc,
  WsPeerHubMemoryChangesRpc,
  WsPeerHubMemoryReceiptsRpc,
  WsPeerHubMemoryKeepRpc,
  WsPeerHubMemoryImportKnowledgeRpc,
);

export const PeerCoreRpcGroup = RpcGroup.make(
  WsPeerHubSubscribeRpc,
  WsPeerHubStartSignInRpc,
  WsPeerHubFinishSignInRpc,
  WsPeerHubSignOutRpc,
  WsPeerHubSyncRpc,
  WsPeerHubCreateWorkspaceRpc,
  WsPeerHubJoinWorkspaceRpc,
  WsPeerHubLeaveWorkspaceRpc,
  WsPeerHubFindWorkspaceRpc,
  WsPeerHubCreateTaskRpc,
  WsPeerHubUpdateTaskRpc,
  WsPeerHubDeleteTaskRpc,
  WsPeerHubAssignThreadRpc,
  WsPeerHubStartAgentRpc,
  WsPeerHubCoordEventsRpc,
  WsPeerHubStaleReadsRpc,
  WsPeerHubReadContextRpc,
  WsPeerHubContextVersionsRpc,
  WsPeerHubReadContextVersionRpc,
  WsPeerHubRestoreContextRpc,
  WsPeerHubShareProjectRpc,
  WsPeerHubUnshareProjectRpc,
  WsPeerHubInviteRpc,
  WsPeerHubOpenProjectRpc,
  WsPeerHubSetCoordinationRpc,
  WsPeerHubSetPluginRpc,
  WsPeerHubNoteOverlapRpc,
  WsPeerHubResolveOverlapRpc,
  WsPeerHubSettleOverlapRpc,
);

const PeerCoreRpcScopes = {
  // Signing in binds this environment to a person's workspaces, so it belongs to its owner.
  [PEER_CORE_METHODS.peerHubSubscribe]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubReadContext]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubContextVersions]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubReadContextVersion]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubRestoreContext]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubFindWorkspace]: AuthOrchestrationReadScope,
  // Tasks and threads are shared work, so changing them is operating, like starting a thread;
  // sharing a project hands the workspace a repository, so it belongs to the owner.
  [PEER_CORE_METHODS.peerHubCreateTask]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubUpdateTask]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubDeleteTask]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubAssignThread]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubStartAgent]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubCoordEvents]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubStaleReads]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubShareProject]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubUnshareProject]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubSync]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubOpenProject]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubSetCoordination]: AuthAccessWriteScope,
  // Which plugins run here is the environment owner's choice, like coordination itself.
  [PEER_CORE_METHODS.peerHubSetPlugin]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubNoteOverlap]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubResolveOverlap]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubSettleOverlap]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubStartSignIn]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubFinishSignIn]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubSignOut]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubCreateWorkspace]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubJoinWorkspace]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubLeaveWorkspace]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubInvite]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof PeerCoreRpcGroup>["_tag"], AuthEnvironmentScope>;

const PeerMemoryRpcScopes = {
  [PEER_MEMORY_METHODS.peerHubMemoryQueue]: AuthOrchestrationReadScope,
  [PEER_MEMORY_METHODS.peerHubMemoryRetry]: AuthOrchestrationOperateScope,
  [PEER_MEMORY_METHODS.peerHubMemoryDiscard]: AuthOrchestrationOperateScope,
  [PEER_MEMORY_METHODS.peerHubMemoryState]: AuthOrchestrationReadScope,
  [PEER_MEMORY_METHODS.peerHubMemoryMode]: AuthOrchestrationReadScope,
  [PEER_MEMORY_METHODS.peerHubMemorySetMode]: AuthOrchestrationOperateScope,
  [PEER_MEMORY_METHODS.peerHubMemoryExecute]: AuthOrchestrationOperateScope,
  [PEER_MEMORY_METHODS.peerHubMemorySearch]: AuthOrchestrationReadScope,
  [PEER_MEMORY_METHODS.peerHubMemoryRead]: AuthOrchestrationReadScope,
  [PEER_MEMORY_METHODS.peerHubMemoryProject]: AuthOrchestrationOperateScope,
  [PEER_MEMORY_METHODS.peerHubMemoryChanges]: AuthOrchestrationReadScope,
  [PEER_MEMORY_METHODS.peerHubMemoryReceipts]: AuthOrchestrationReadScope,
  [PEER_MEMORY_METHODS.peerHubMemoryKeep]: AuthOrchestrationOperateScope,
  [PEER_MEMORY_METHODS.peerHubMemoryImportKnowledge]: AuthOrchestrationOperateScope,
} as const satisfies Record<
  RpcGroup.Rpcs<typeof WsPeerMemoryRpcGroup>["_tag"],
  AuthEnvironmentScope
>;

/** Every Peer method, as `WS_METHODS` spreads them. */
export const PEER_WS_METHODS = {
  ...PEER_CORE_METHODS,
  ...PEER_HERDR_METHODS,
  ...PEER_GITHUB_METHODS,
  ...PEER_CAPACITY_METHODS,
  ...PEER_REQUESTS_METHODS,
  ...PEER_OBSERVE_METHODS,
  ...PEER_KNOWLEDGE_METHODS,
  ...PEER_MEMORY_METHODS,
} as const;

export const PeerRpcGroup = PeerCoreRpcGroup.merge(
  HerdrRpcGroup,
  GitHubRpcGroup,
  CapacityRpcGroup,
  RequestsRpcGroup,
  ObserveRpcGroup,
  KnowledgeRpcGroup,
  WsPeerMemoryRpcGroup,
);

/** The scope each Peer method needs, as the server's authorization table spreads them. */
export const PEER_RPC_SCOPES = {
  ...PeerCoreRpcScopes,
  ...HerdrRpcScopes,
  ...GitHubRpcScopes,
  ...CapacityRpcScopes,
  ...RequestsRpcScopes,
  ...ObserveRpcScopes,
  ...KnowledgeRpcScopes,
  ...PeerMemoryRpcScopes,
} as const;

/** Peer's streaming methods: clients subscribe to them rather than call them. */
export const PEER_STREAM_METHODS = [
  PEER_CORE_METHODS.peerHubSubscribe,
  PEER_HERDR_METHODS.peerHubWatchAgent,
  PEER_OBSERVE_METHODS.peerHubObserveThread,
] as const;
