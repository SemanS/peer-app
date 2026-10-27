/**
 * T3's thread projections without T3: Peer Core runs no app threads, so every list is empty, a
 * thread's shell is absent and a read of one thread answers that it does not exist.
 *
 * @module peerHub/headless/HeadlessProjections
 */
import type { OrchestrationV2ThreadShellSnapshot, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";

const missing = (threadId: ThreadId) =>
  Effect.fail(new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }));

const emptyShell = {
  schemaVersion: ProjectionStore.ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION,
  snapshotSequence: 0,
  threads: [],
  archivedThreads: [],
} as unknown as OrchestrationV2ThreadShellSnapshot;

/** `ProjectionStoreV2` with no threads in it. */
export const layer = Layer.succeed(
  ProjectionStore.ProjectionStoreV2,
  ProjectionStore.ProjectionStoreV2.of({
    searchThreadStream: (input) =>
      Stream.fail(
        new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId: input.threadId }),
      ),
    searchThread: (input) => missing(input.threadId),
    getThreadAttachmentIds: () => Effect.succeed([]),
    getThreadHistoryPage: (threadId) => missing(threadId),
    getTimelinePage: () => Effect.succeed({ items: [], totalItems: 0, hasMore: false }),
    getMessageCount: () => Effect.succeed(0),
    getNextTurnItemOrdinal: (threadId) => missing(threadId),
    getTurnItem: () => Effect.succeed(null),
    getThreadRecords: (threadId) => missing(threadId),
    apply: () => Effect.void,
    getShellSnapshot: () => Effect.succeed(emptyShell),
    readShellSnapshot: () => Effect.succeed(Effect.succeed(emptyShell)),
    getThreadShell: () => Effect.succeed(null),
    getThread: (threadId) => missing(threadId),
    getLimitRecoveryCandidates: () => Effect.succeed([]),
    getSettlementCandidates: () => Effect.succeed([]),
    getThreadsWithPullRequests: () => Effect.succeed([]),
    getThreadWorktreePaths: () => Effect.succeed([]),
    getTurnStartContext: (threadId) => missing(threadId),
    getTurnStartHistory: () => Effect.succeed([]),
    getThreadProjection: (threadId) => missing(threadId),
    getRuntimeRecoveryProjection: (threadId) => missing(threadId),
    getPendingNativeUserInputs: (threadId) => missing(threadId),
    getPlan: () => Effect.succeed(undefined),
    hasUnpairedRunInterruptRequest: () => Effect.succeed(false),
    isNodeStored: () => Effect.succeed(false),
    getRuntimeRequest: () => Effect.succeed(undefined),
    getProviderControlContext: (threadId) => missing(threadId),
    getRunningTurnContext: (threadId) => missing(threadId),
    getThreadProviderContext: (threadId) => missing(threadId),
    getRuntimeResponseContext: (threadId) => missing(threadId),
    getCheckpointContext: (threadId) => missing(threadId),
    getCheckpointCaptureContext: (threadId) => missing(threadId),
    getRunMessage: () => Effect.succeed(undefined),
    canStartQueuedRun: () => Effect.succeed(false),
    getRecoveryThreadIds: () => Effect.succeed([]),
    getUnreadableThreadIds: () => Effect.succeed([]),
    getThreadSnapshot: (threadId) => missing(threadId),
    getThreadSnapshotWindow: (threadId) => missing(threadId),
  }),
);
