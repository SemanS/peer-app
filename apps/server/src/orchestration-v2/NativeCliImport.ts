import {
  type CheckpointId,
  type CheckpointRef,
  type CheckpointScopeId,
  type CommandId,
  type MessageId,
  type NativeCliEntry,
  type NativeCliGap,
  type NativeCliToolStatus,
  type NativeCliTurn,
  type NodeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  RunId,
  type ThreadId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

const GAP_NOTES: Record<Exclude<NativeCliGap, "none">, string> = {
  compacted:
    "The session was compacted, so anything done in the CLI before the compaction is not shown here.",
  diverged:
    "The session no longer holds the message it left Peer at, so what happened in the CLI is not shown here.",
  unread: "Peer could not read the session, so what happened in the CLI is not shown here.",
  truncated:
    "The session in the CLI was too long to bring back whole, so some of it is not shown here.",
};

const itemStatus = (status: NativeCliToolStatus): OrchestrationV2TurnItem["status"] =>
  status === "incomplete" ? "interrupted" : status;

/** Replaying a finish derives the same id, so a turn is never imported twice. */
export const nativeCliRunId = (threadId: ThreadId, nativeMessageId: string): RunId =>
  RunId.make(`run:${encodeURIComponent(threadId)}:cli:${encodeURIComponent(nativeMessageId)}`);

export interface NativeCliImportPlan {
  readonly events: ReadonlyArray<OrchestrationV2DomainEvent>;
  /** The last imported run, left `waiting` for the capture that shows the terminal's changes. */
  readonly capture: {
    readonly runId: RunId;
    readonly scopeId: CheckpointScopeId;
    readonly baselineRef: CheckpointRef | undefined;
  } | null;
}

/**
 * Plans what one finished loan records: each prompt as a finished run, and the note for a gap.
 *
 * The turns ran one after another on one working tree, and Peer saw only its end state. The last
 * turn's capture therefore carries every change, and the turns before it point at the tree the loan
 * started from: they stay rollback and diff boundaries without pretending to know their own files.
 */
export const planNativeCliImport = Effect.fn("NativeCliImport.plan")(function* <E>(input: {
  readonly commandId: CommandId;
  readonly projection: Pick<OrchestrationV2ThreadProjection, "thread" | "runs" | "providerTurns">;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly turns: ReadonlyArray<NativeCliTurn>;
  readonly gap: NativeCliGap;
  readonly now: DateTime.Utc;
  readonly firstRunOrdinal: number;
  readonly baselineRef: CheckpointRef | undefined;
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  /** Null when the workspace cannot be resolved: the turns then import without a checkpoint. */
  readonly prepareScope: (run: {
    readonly runId: RunId;
    readonly rootNodeId: NodeId;
  }) => Effect.Effect<OrchestrationV2CheckpointScope | null, E>;
  readonly allocateCheckpointId: (
    scopeId: CheckpointScopeId,
    ordinal: number,
  ) => Effect.Effect<CheckpointId, E>;
}): Effect.fn.Return<NativeCliImportPlan, E | IdAllocator.IdAllocatorV2Error> {
  const { commandId, idAllocator, now, projection, providerThread, turns } = input;
  const thread = projection.thread;
  const { driver, providerInstanceId } = providerThread;
  const threadId = thread.id;
  const events: Array<OrchestrationV2DomainEvent> = [];
  const emitEvent = Effect.fn("NativeCliImport.emitEvent")(function* <
    Event extends OrchestrationV2DomainEvent,
  >(event: Omit<Event, "id">) {
    const id = yield* idAllocator.allocate.event({ threadId, commandId });
    events.push({ ...event, id } as Event);
  });

  const item = (run: { readonly runId: RunId | null; readonly nodeId: NodeId | null }) => ({
    threadId,
    runId: run.runId,
    nodeId: run.nodeId,
    providerThreadId: providerThread.id,
    nativeItemRef: null,
    parentItemId: null,
    // The event sink assigns the position; events keep their order inside a run.
    ordinal: 0,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  });

  const known = new Set(projection.runs.map((run) => run.id));
  const fresh = turns.filter((turn) => !known.has(nativeCliRunId(threadId, turn.nativeMessageId)));

  if (input.gap !== "none") {
    const firstTurn = fresh[0];
    const noteRunId =
      firstTurn !== undefined
        ? nativeCliRunId(threadId, firstTurn.nativeMessageId)
        : (projection.runs.findLast(
            (run) => run.status !== "queued" && run.status !== "rolled_back",
          )?.id ?? null);
    const noteNodeId =
      firstTurn !== undefined && noteRunId !== null
        ? idAllocator.derive.rootNode({ runId: noteRunId })
        : (projection.runs.find((run) => run.id === noteRunId)?.rootNodeId ?? null);
    yield* emitEvent({
      type: "turn-item.updated",
      threadId,
      ...(noteRunId === null ? {} : { runId: noteRunId }),
      ...(noteNodeId === null ? {} : { nodeId: noteNodeId }),
      providerInstanceId,
      occurredAt: now,
      payload: {
        ...item({ runId: noteRunId, nodeId: noteNodeId }),
        id: idAllocator.derive.turnItemFromProviderItem({
          driver,
          nativeItemId: `cli-gap:${commandId}`,
        }),
        providerTurnId: null,
        status: "completed",
        title: null,
        type: "system_notice",
        message: GAP_NOTES[input.gap],
      } satisfies OrchestrationV2TurnItem,
    });
  }

  let capture: NativeCliImportPlan["capture"] = null;
  let providerTurnOrdinal = Math.max(
    0,
    ...projection.providerTurns
      .filter((turn) => turn.providerThreadId === providerThread.id)
      .map((turn) => turn.ordinal),
  );
  for (const [index, turn] of fresh.entries()) {
    const ordinal = input.firstRunOrdinal + index;
    const isLast = index === fresh.length - 1;
    const runId = nativeCliRunId(threadId, turn.nativeMessageId);
    const rootNodeId = idAllocator.derive.rootNode({ runId });
    const attemptId = idAllocator.derive.runAttempt({ runId, attemptOrdinal: 1 });
    const nativeKey = `cli:${turn.nativeMessageId}`;
    const providerTurnId = idAllocator.derive.providerTurn({ driver, nativeTurnId: nativeKey });
    providerTurnOrdinal += 1;

    const needsScope = isLast || input.baselineRef !== undefined;
    const scope = needsScope ? yield* input.prepareScope({ runId, rootNodeId }) : null;
    const checkpoint: OrchestrationV2Checkpoint | null =
      !isLast && scope !== null && input.baselineRef !== undefined
        ? {
            id: yield* input.allocateCheckpointId(scope.id, ordinal),
            threadId,
            scopeId: scope.id,
            runId,
            nodeId: rootNodeId,
            parentCheckpointId: null,
            ordinalWithinScope: ordinal,
            appRunOrdinal: ordinal,
            ref: input.baselineRef,
            status: "ready",
            files: [],
            capturedAt: now,
          }
        : null;
    const waitsForCapture = isLast && scope !== null;
    if (waitsForCapture) {
      capture = { runId, scopeId: scope.id, baselineRef: input.baselineRef };
    }
    const terminal = waitsForCapture ? ("waiting" as const) : ("completed" as const);
    const completedAt = waitsForCapture ? null : now;

    const run: OrchestrationV2Run = {
      id: runId,
      threadId,
      ordinal,
      providerInstanceId,
      modelSelection: thread.modelSelection,
      providerThreadId: providerThread.id,
      userMessageId: idAllocator.derive.messageFromProviderItem({
        driver,
        nativeItemId: `${nativeKey}:user`,
      }),
      rootNodeId,
      activeAttemptId: attemptId,
      status: terminal,
      requestedAt: now,
      startedAt: now,
      completedAt,
      checkpointId: checkpoint?.id ?? null,
      contextHandoffId: null,
      origin: "native_cli",
    };
    const attempt: OrchestrationV2RunAttempt = {
      id: attemptId,
      ...(providerThread.nativeThreadRef?.nativeId == null
        ? {}
        : { nativeThreadId: providerThread.nativeThreadRef.nativeId }),
      runId,
      attemptOrdinal: 1,
      rootNodeId,
      providerInstanceId,
      providerThreadId: providerThread.id,
      providerTurnId,
      reason: "initial",
      status: "completed",
      startedAt: now,
      completedAt: now,
    };
    const rootNode: OrchestrationV2ExecutionNode = {
      id: rootNodeId,
      threadId,
      runId,
      parentNodeId: null,
      rootNodeId,
      kind: "root_turn",
      status: terminal,
      countsForRun: true,
      providerThreadId: providerThread.id,
      providerTurnId,
      nativeItemRef: null,
      runtimeRequestId: null,
      checkpointScopeId: scope?.id ?? null,
      startedAt: now,
      completedAt,
    };
    const providerTurn: OrchestrationV2ProviderTurn = {
      id: providerTurnId,
      providerThreadId: providerThread.id,
      nodeId: rootNodeId,
      runAttemptId: attemptId,
      // Non-null because Codex rollback counts turns that carry a ref, and a null id because the
      // replay gives no Claude chain UUID or Codex turn id: nothing may resume at this turn.
      nativeTurnRef: { driver, nativeId: null, strength: "none" },
      ordinal: providerTurnOrdinal,
      status: "completed",
      startedAt: now,
      completedAt: now,
    };
    const base = {
      threadId,
      runId,
      nodeId: rootNodeId,
      providerInstanceId,
      occurredAt: now,
    };
    const conversationMessage = (fields: {
      readonly id: MessageId;
      readonly role: "user" | "assistant";
      readonly createdBy: OrchestrationV2ConversationMessage["createdBy"];
      readonly text: string;
    }): OrchestrationV2ConversationMessage => ({
      ...fields,
      creationSource: "provider",
      threadId,
      runId,
      nodeId: rootNodeId,
      attachments: [],
      streaming: false,
      createdAt: now,
      updatedAt: now,
    });
    const turnItem = {
      ...item({ runId, nodeId: rootNodeId }),
      providerTurnId,
    };

    yield* emitEvent({ ...base, type: "run.created", payload: run });
    yield* emitEvent({ ...base, type: "run-attempt.created", payload: attempt });
    yield* emitEvent({ ...base, type: "node.updated", payload: rootNode });
    if (scope !== null) {
      yield* emitEvent({ ...base, type: "checkpoint-scope.created", payload: scope });
    }
    if (checkpoint !== null) {
      yield* emitEvent({ ...base, type: "checkpoint.captured", payload: checkpoint });
    }
    yield* emitEvent({ ...base, type: "provider-turn.updated", payload: providerTurn });
    yield* emitEvent({
      ...base,
      type: "message.updated",
      payload: conversationMessage({
        id: run.userMessageId,
        role: "user",
        createdBy: "user",
        text: turn.text,
      }),
    });
    yield* emitEvent({
      ...base,
      type: "turn-item.updated",
      payload: {
        ...turnItem,
        id: idAllocator.derive.userTurnItem({ messageId: run.userMessageId }),
        providerTurnId: null,
        createdBy: "user",
        creationSource: "provider",
        status: "completed",
        title: null,
        type: "user_message",
        messageId: run.userMessageId,
        inputIntent: "turn_start",
        text: turn.text,
        attachments: [],
      } satisfies OrchestrationV2TurnItem,
    });

    for (const [entryIndex, entry] of turn.entries.entries()) {
      const nativeItemId = `${nativeKey}:${entryIndex}`;
      const id = idAllocator.derive.turnItemFromProviderItem({ driver, nativeItemId });
      if (entry.type === "assistant_text") {
        if (entry.text.trim().length === 0) continue;
        const messageId = idAllocator.derive.messageFromProviderItem({ driver, nativeItemId });
        yield* emitEvent({
          ...base,
          type: "message.updated",
          payload: conversationMessage({
            id: messageId,
            role: "assistant",
            createdBy: "agent",
            text: entry.text,
          }),
        });
        yield* emitEvent({
          ...base,
          type: "turn-item.updated",
          payload: {
            ...turnItem,
            id,
            status: "completed",
            title: null,
            type: "assistant_message",
            messageId,
            text: entry.text,
            streaming: false,
          } satisfies OrchestrationV2TurnItem,
        });
        continue;
      }
      yield* emitEvent({
        ...base,
        type: "turn-item.updated",
        payload: toolTurnItem(entry, { ...turnItem, id }),
      });
    }
  }
  return { events, capture };
});

function toolTurnItem(
  entry: Exclude<NativeCliEntry, { readonly type: "assistant_text" }>,
  fields: Pick<
    Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }>,
    | "id"
    | "threadId"
    | "runId"
    | "nodeId"
    | "providerThreadId"
    | "providerTurnId"
    | "nativeItemRef"
    | "parentItemId"
    | "ordinal"
    | "startedAt"
    | "completedAt"
    | "updatedAt"
  >,
): OrchestrationV2TurnItem {
  switch (entry.type) {
    case "command":
      return {
        ...fields,
        status: itemStatus(entry.status),
        title: null,
        type: "command_execution",
        input: entry.command,
        ...(entry.output === undefined ? {} : { output: entry.output }),
        ...(entry.exitCode === undefined
          ? {}
          : { exitCode: entry.exitCode, outputIndicatesFailure: entry.exitCode !== 0 }),
      };
    case "file_change":
      return {
        ...fields,
        status: itemStatus(entry.status),
        title: null,
        type: "file_change",
        fileName: entry.path,
        ...(entry.oldText === undefined ? {} : { oldStr: entry.oldText }),
        ...(entry.newText === undefined ? {} : { newStr: entry.newText }),
      };
    case "tool":
      return {
        ...fields,
        status: itemStatus(entry.status),
        title: entry.title,
        type: "dynamic_tool",
        toolName: entry.name,
        input: entry.input,
        ...(entry.output === undefined ? {} : { output: entry.output }),
      };
  }
}
