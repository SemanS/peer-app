/**
 * Peer Memory's WebSocket RPCs. They keep the names they had before plugins.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerHubMemoryChangesInput,
  PeerHubMemoryDiscardInput,
  PeerHubMemoryExecuteInput,
  PeerHubMemoryImportKnowledgeInput,
  PeerHubMemoryKeepInput,
  PeerHubMemoryModeInput,
  PeerHubMemoryProjectInput,
  PeerHubMemoryQueueInput,
  PeerHubMemoryReadInput,
  PeerHubMemoryReceiptsInput,
  PeerHubMemoryRetryInput,
  PeerHubMemorySearchInput,
  PeerHubMemorySetModeInput,
  PeerHubMemoryStateInput,
  PeerMemoryChanges,
  PeerMemoryDiscarded,
  PeerMemoryKept,
  PeerMemoryMode,
  PeerMemoryProjection,
  PeerMemoryQueue,
  PeerMemoryReceipt,
  PeerMemoryRecordView,
  PeerMemorySearchResult,
  PeerMemoryState,
  PeerMemoryWriteResult,
} from "./memory.ts";

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

export const MemoryRpcGroup = RpcGroup.make(
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

/** Reading memory only reads; writing, deciding and importing it is operating on shared work. */
export const MemoryRpcScopes = {
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
} as const satisfies Record<RpcGroup.Rpcs<typeof MemoryRpcGroup>["_tag"], AuthEnvironmentScope>;
