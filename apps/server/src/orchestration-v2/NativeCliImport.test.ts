import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  CommandId,
  EventId,
  MessageId,
  type NativeCliGap,
  type NativeCliTurn,
  OrchestrationV2ProviderThreadJson,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  ThreadId,
} from "@t3tools/contracts";
import { createOrchestrationV2TurnItemVisibility } from "@t3tools/shared/orchestrationV2Timeline";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  resolveClaudeForkUpToMessageId,
  resolveClaudeRollbackResumeSessionAt,
} from "./Adapters/ClaudeAdapterV2.ts";
import {
  CodexProviderCapabilitiesV2,
  resolveCodexRollbackTurnCount,
} from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventStore from "./EventStore.ts";
import { nativeCliRunId } from "./NativeCliImport.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { userFacingDispatchErrorMessage } from "./UserFacingErrors.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Runs here never reach a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = ThreadManagementService.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
      EventStore.layer.pipe(Layer.provide(layerDatabase)),
      EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
      ProviderReplayHarness.layerWithRegistry(
        { name: "native-cli-import" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: layerDatabase, runEffectWorker: false },
      ),
    ),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
);

const decodeProviderThread = Schema.decodeUnknownSync(OrchestrationV2ProviderThreadJson);
const baselineRef = CheckpointRef.make("refs/peer/checkpoints/baseline");
const providerThreadId = (projection: OrchestrationV2ThreadProjection) =>
  projection.thread.activeProviderThreadId!;

const turn = (id: string, text = `run ${id}`): NativeCliTurn => ({
  nativeMessageId: id,
  text,
  entries: [
    { type: "assistant_text", nativeId: null, text: `answer to ${id}` },
    {
      type: "command",
      nativeId: "call-1",
      command: "ls",
      output: "a",
      exitCode: 0,
      status: "completed",
    },
    { type: "file_change", nativeId: "call-2", path: "src/a.ts", newText: "x", status: "failed" },
    {
      type: "tool",
      nativeId: "call-3",
      name: "Read",
      title: "Read a",
      input: { path: "a" },
      status: "incomplete",
    },
  ],
});

let nextId = 0;
/** A thread with one finished Peer run on a real native session, ready to be lent. */
const readyThread = (input?: { readonly checkpoint?: boolean }) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    nextId += 1;
    const threadId = ThreadId.make(`thread:cli:${nextId}`);
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId: ProjectId.make("project:native-cli"),
      title: "cli",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: "/tmp/native-cli-worktree",
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`send:${threadId}`),
      threadId,
      messageId: MessageId.make(`message:${threadId}:first`),
      text: "first",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    const projection = yield* orchestrator.getThreadProjection(threadId);
    const run = projection.runs[0]!;
    const providerThread = projection.providerThreads[0]!;
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make(`event:${threadId}:run`),
      type: "run.updated",
      threadId,
      runId: run.id,
      occurredAt: now,
      payload: { ...run, status: "completed", completedAt: now },
    });
    yield* projections.apply({
      id: EventId.make(`event:${threadId}:provider-thread`),
      type: "provider-thread.updated",
      threadId,
      occurredAt: now,
      providerInstanceId: instanceId,
      payload: {
        ...providerThread,
        nativeThreadRef: { driver, nativeId: "native-session", strength: "strong" },
      },
    });
    if (input?.checkpoint !== false) {
      yield* projections.apply({
        id: EventId.make(`event:${threadId}:checkpoint`),
        type: "checkpoint.captured",
        threadId,
        nodeId: run.rootNodeId!,
        occurredAt: now,
        payload: {
          id: CheckpointId.make(`checkpoint:${threadId}`),
          threadId,
          scopeId: CheckpointScopeId.make(`scope:${threadId}`),
          runId: run.id,
          nodeId: run.rootNodeId!,
          parentCheckpointId: null,
          ordinalWithinScope: 1,
          appRunOrdinal: 1,
          ref: baselineRef,
          status: "ready",
          files: [],
          capturedAt: now,
        },
      });
    }
    return threadId;
  });

const startLoan = (threadId: ThreadId, commandId = `loan-start:${threadId}`) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    yield* orchestrator.dispatch({
      type: "thread.cli-loan.start",
      commandId: CommandId.make(commandId),
      threadId,
      providerThreadId: providerThreadId(projection),
      loan: {
        terminalId: "terminal-1",
        afterNativeMessageId: "anchor",
        startedAt: yield* DateTime.now,
      },
    });
  });

const finishLoan = (
  threadId: ThreadId,
  turns: ReadonlyArray<NativeCliTurn>,
  gap: NativeCliGap,
  commandId = `loan-finish:${threadId}`,
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    yield* orchestrator.dispatch({
      type: "thread.cli-loan.finish",
      commandId: CommandId.make(commandId),
      threadId,
      providerThreadId: providerThreadId(projection),
      turns,
      gap,
      finishedAt: yield* DateTime.now,
    });
  });

const refusalTag = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.exit,
    Effect.map((exit) =>
      Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
        ? exit.cause.reasons[0].error._tag
        : "accepted",
    ),
  );

const loanTest = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Layer.Success<typeof layerTest>>,
) => it.effect(name, () => body().pipe(Effect.provide(layerTest)));

loanTest("a loan records the session and survives in the projection", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    const projection = yield* orchestrator.getThreadProjection(threadId);
    assert.strictEqual(projection.providerThreads[0]?.cliLoan?.terminalId, "terminal-1");
  }),
);

it("old projections decode with no loan", () => {
  const decoded = decodeProviderThread({
    id: "provider-thread:old",
    driver: "codex",
    providerInstanceId: "codex",
    providerSessionId: null,
    appThreadId: null,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  });
  assert.strictEqual(decoded.cliLoan, null);
});

loanTest("finish records each prompt as a finished run and clears the loan", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    yield* finishLoan(threadId, [turn("m1"), turn("m2")], "none");

    const projection = yield* orchestrator.getThreadProjection(threadId);
    assert.deepEqual(
      projection.runs.map((run) => [run.ordinal, run.status, run.origin]),
      [
        [1, "completed", undefined],
        [2, "completed", "native_cli"],
        [3, "waiting", "native_cli"],
      ],
    );
    const providerThread = projection.providerThreads[0]!;
    assert.strictEqual(providerThread.cliLoan, null);
    assert.strictEqual(providerThread.lastRunOrdinal, 3);
    assert.deepEqual(
      projection.providerTurns.map((providerTurn) => providerTurn.nativeTurnRef?.nativeId),
      [null, null],
    );

    const lastRun = projection.runs[2]!;
    assert.deepEqual(
      projection.turnItems
        .filter((item) => item.runId === lastRun.id)
        .map((item) => [item.type, item.status]),
      [
        ["user_message", "completed"],
        ["assistant_message", "completed"],
        ["command_execution", "completed"],
        ["file_change", "failed"],
        ["dynamic_tool", "interrupted"],
      ],
    );
    assert.deepEqual(
      projection.messages.filter((message) => message.runId === lastRun.id).map((m) => m.role),
      ["user", "assistant"],
    );

    // The turn before the last points at where the loan started; the capture measures from it.
    const firstCheckpoint = projection.checkpoints.find(
      (checkpoint) => checkpoint.runId === projection.runs[1]!.id,
    );
    assert.strictEqual(firstCheckpoint?.ref, baselineRef);
    const captures = yield* outbox.listByCommandId(
      CommandId.make(`command:effect:checkpoint.capture:${lastRun.id}`),
    );
    assert.strictEqual(captures[0]?.request.type, "checkpoint.capture");
    assert.deepEqual(captures[0]?.request, {
      type: "checkpoint.capture",
      runId: lastRun.id,
      scopeId: projection.nodes.find((node) => node.id === lastRun.rootNodeId)!.checkpointScopeId!,
      baselineRef,
    });
  }),
);

loanTest("replaying a finish imports nothing twice", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    yield* finishLoan(threadId, [turn("m1")], "none");
    yield* finishLoan(threadId, [turn("m1")], "none");
    yield* finishLoan(threadId, [turn("m1")], "none", `loan-finish-again:${threadId}`);
    const projection = yield* orchestrator.getThreadProjection(threadId);
    assert.strictEqual(projection.runs.length, 2);
    assert.strictEqual(projection.runs[1]?.id, nativeCliRunId(threadId, "m1"));
  }),
);

loanTest("every command that would touch the session is refused while out", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    const projection = yield* orchestrator.getThreadProjection(threadId);
    const run = projection.runs[0]!;
    const outInCli = "OrchestratorThreadOutInCliError";
    const id = (name: string) => CommandId.make(`${name}:${threadId}`);
    const refusals = [
      orchestrator.dispatch({
        type: "message.dispatch",
        commandId: id("message"),
        threadId,
        messageId: MessageId.make(`refused:${threadId}`),
        text: "while out",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      }),
      orchestrator.dispatch({ type: "queue.resume", commandId: id("resume"), threadId }),
      orchestrator.dispatch({
        type: "queued-message.promote-to-steer",
        commandId: id("promote"),
        threadId,
        queuedRunId: run.id,
        targetRunId: run.id,
      }),
      orchestrator.dispatch({
        type: "checkpoint.rollback",
        commandId: id("rollback"),
        threadId,
        scopeId: CheckpointScopeId.make(`scope:${threadId}`),
        checkpointId: CheckpointId.make(`checkpoint:${threadId}`),
      }),
      orchestrator.dispatch({
        type: "provider.switch",
        commandId: id("switch"),
        threadId,
        modelSelection,
      }),
      orchestrator.dispatch({
        type: "thread.fork",
        commandId: id("fork"),
        sourceThreadId: threadId,
        targetThreadId: ThreadId.make(`fork:${threadId}`),
        sourcePoint: { type: "run", runId: run.id },
        createdBy: "user",
        creationSource: "web",
      }),
      startLoan(threadId, `loan-start-again:${threadId}`),
    ];
    for (const refusal of refusals) {
      assert.strictEqual(yield* refusalTag(refusal), outInCli);
    }
  }),
);

loanTest("a loan cannot start while a run is live or before a native session exists", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    const projection = yield* orchestrator.getThreadProjection(threadId);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`live:${threadId}`),
      threadId,
      messageId: MessageId.make(`live:${threadId}`),
      text: "second",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    assert.strictEqual(yield* refusalTag(startLoan(threadId)), "OrchestratorDispatchError");
    assert.strictEqual(projection.providerThreads[0]?.cliLoan, null);
  }),
);

loanTest("a wake sent during a loan waits and starts when the thread returns", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`wake:${threadId}`),
      threadId,
      messageId: MessageId.make(`wake:${threadId}`),
      text: "a delegated result arrived",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "agent",
      creationSource: "server",
    });
    const queued = (yield* orchestrator.getThreadProjection(threadId)).runs.at(-1)!;
    assert.strictEqual(queued.status, "queued");

    yield* finishLoan(threadId, [], "none");
    const after = yield* orchestrator.getThreadProjection(threadId);
    assert.strictEqual(after.providerThreads[0]?.cliLoan, null);
    assert.notStrictEqual(after.runs.find((run) => run.id === queued.id)?.status, "queued");
  }),
);

loanTest("what a server feature sends for a person waits, and a typed message can retry", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    const send = (commandId: string, creationSource: "web" | "server") =>
      orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(commandId),
        threadId,
        messageId: MessageId.make(`message:${commandId}`),
        text: "hello",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource,
      });

    yield* send(`slack:${threadId}`, "server");
    assert.deepEqual(
      (yield* orchestrator.getThreadProjection(threadId)).runs.map((run) => run.status),
      ["completed", "queued"],
    );

    const typed = `typed:${threadId}`;
    assert.strictEqual(yield* refusalTag(send(typed, "web")), "OrchestratorThreadOutInCliError");
    assert.strictEqual(yield* refusalTag(send(typed, "web")), "OrchestratorThreadOutInCliError");
    yield* finishLoan(threadId, [], "none");
    assert.strictEqual(yield* refusalTag(send(typed, "web")), "accepted");
  }),
);

loanTest("a prepared run neither retries nor releases while out", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    const runId = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!.id;
    for (const type of ["prepared-run.retry", "prepared-run.release"] as const) {
      assert.strictEqual(
        yield* refusalTag(
          orchestrator.dispatch({
            type,
            commandId: CommandId.make(`${type}:${threadId}`),
            threadId,
            runId,
          }),
        ),
        "OrchestratorThreadOutInCliError",
      );
    }
  }),
);

loanTest("a loan does not start beside a provider process that opened after the detach", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* readyThread();
    const providerThread = (yield* orchestrator.getThreadProjection(threadId)).providerThreads[0]!;
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make(`event:${threadId}:session`),
      type: "provider-session.attached",
      threadId,
      occurredAt: now,
      providerInstanceId: instanceId,
      driver,
      payload: {
        id: providerThread.providerSessionId!,
        driver,
        providerInstanceId: instanceId,
        status: "ready",
        cwd: "/tmp/native-cli-worktree",
        model: null,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      },
    } as never);
    const detail = yield* startLoan(threadId).pipe(
      Effect.flip,
      Effect.map((error) => String((error as { readonly cause?: unknown }).cause)),
    );
    assert.include(detail, "provider process");
    assert.isNotOk((yield* orchestrator.getThreadProjection(threadId)).providerThreads[0]?.cliLoan);
  }),
);

loanTest("the detach for a loan refuses inside the lock while a run is live", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* readyThread();
    const projection = yield* orchestrator.getThreadProjection(threadId);
    const run = projection.runs[0]!;
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make(`event:${threadId}:running`),
      type: "run.updated",
      threadId,
      runId: run.id,
      occurredAt: now,
      payload: { ...run, status: "running", completedAt: null },
    });
    assert.strictEqual(
      yield* refusalTag(
        orchestrator.dispatch({
          type: "provider-session.detach",
          commandId: CommandId.make(`detach:${threadId}`),
          threadId,
          providerSessionId: projection.providerThreads[0]!.providerSessionId!,
          onlyWhenIdle: true,
        }),
      ),
      "OrchestratorThreadHasLiveRunError",
    );
  }),
);

loanTest("imported turns keep their place ahead of a message that waited for them", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`wake:${threadId}`),
      threadId,
      messageId: MessageId.make(`wake:${threadId}`),
      text: "a delegated result arrived",
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "agent",
      creationSource: "server",
    });
    const queued = (yield* orchestrator.getThreadProjection(threadId)).runs.at(-1)!;
    yield* finishLoan(threadId, [turn("m1")], "none");
    const after = yield* orchestrator.getThreadProjection(threadId);
    assert.strictEqual(
      after.runs.find((run) => run.origin === "native_cli")?.ordinal,
      queued.ordinal,
    );
    assert.strictEqual(after.runs.find((run) => run.id === queued.id)?.ordinal, queued.ordinal + 1);
    assert.strictEqual(after.runs.find((run) => run.id === queued.id)?.status, "queued");
  }),
);

loanTest("a queue reorder cannot make an import collide on a run ordinal", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    const queue = (name: string) =>
      orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`${name}:${threadId}`),
        threadId,
        messageId: MessageId.make(`${name}:${threadId}`),
        text: name,
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
      });
    yield* queue("first");
    yield* queue("second");
    const queued = (yield* orchestrator.getThreadProjection(threadId)).runs.filter(
      (run) => run.status === "queued",
    );
    const [first, second] = queued;
    yield* orchestrator.dispatch({
      type: "queued-run.reorder",
      commandId: CommandId.make(`reorder:${threadId}`),
      threadId,
      runId: second!.id,
      beforeRunId: first!.id,
    });
    const reordered = (yield* orchestrator.getThreadProjection(threadId)).runs
      .filter((run) => run.status === "queued")
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .map((run) => run.id);

    yield* finishLoan(threadId, [turn("m1"), turn("m2"), turn("m3")], "none");

    const after = yield* orchestrator.getThreadProjection(threadId);
    assert.isNull(after.providerThreads[0]?.cliLoan ?? null);
    const byOrdinal = after.runs.toSorted((left, right) => left.ordinal - right.ordinal);
    assert.strictEqual(new Set(byOrdinal.map((run) => run.ordinal)).size, byOrdinal.length);
    assert.deepEqual(
      byOrdinal.filter((run) => run.origin === "native_cli").map((run) => run.id),
      ["m1", "m2", "m3"].map((id) => nativeCliRunId(threadId, id)),
    );
    assert.deepEqual(
      byOrdinal.filter((run) => run.status === "queued").map((run) => run.id),
      reordered,
    );
    const imported = byOrdinal.filter((run) => run.origin === "native_cli");
    assert.isBelow(
      imported.at(-1)!.ordinal,
      after.runs.find((r) => r.id === reordered[0])!.ordinal,
    );
  }),
);

loanTest("archiving and finishing wait for the CLI, and deleting does not", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    const refusalMessage = (command: Parameters<typeof orchestrator.dispatch>[0]) =>
      orchestrator.dispatch(command).pipe(
        Effect.flip,
        Effect.map((error) => [error._tag, userFacingDispatchErrorMessage(error)]),
      );

    assert.deepEqual(
      yield* refusalMessage({
        type: "thread.archive",
        commandId: CommandId.make(`archive:${threadId}`),
        threadId,
      }),
      [
        "OrchestratorThreadOutInCliError",
        "This thread is out in the CLI. Quit the CLI to bring it back to Peer, then archive it.",
      ],
    );
    assert.deepEqual(
      yield* refusalMessage({
        type: "thread.settle",
        commandId: CommandId.make(`settle:${threadId}`),
        threadId,
      }),
      [
        "OrchestratorThreadOutInCliError",
        "This thread is out in the CLI. Quit the CLI to bring it back to Peer, then finish it.",
      ],
    );
    const snapshotAt = (yield* orchestrator.getThreadProjection(threadId)).thread.updatedAt;
    assert.strictEqual(
      yield* refusalTag(
        orchestrator.dispatch({
          type: "thread.auto-settle",
          commandId: CommandId.make(`auto-settle:${threadId}`),
          threadId,
          snapshotAt,
        }),
      ),
      "OrchestratorThreadOutInCliError",
    );

    yield* orchestrator.dispatch({
      type: "thread.delete",
      commandId: CommandId.make(`delete:${threadId}`),
      threadId,
    });
    const projection = yield* orchestrator.getThreadProjection(threadId);
    assert.isNotNull(projection.thread.deletedAt);
  }),
);

loanTest("a loan waits for a rollback, atomically, and goes once it settled", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const threadId = yield* readyThread();
    const projection = yield* orchestrator.getThreadProjection(threadId);
    yield* outbox.enqueue([
      {
        id: `effect:rollback:${threadId}`,
        commandId: CommandId.make(`rollback:${threadId}`),
        threadId,
        request: {
          type: "provider-thread.rollback",
          providerThreadId: providerThreadId(projection),
          checkpointId: CheckpointId.make(`checkpoint:${threadId}`),
          scopeId: CheckpointScopeId.make(`scope:${threadId}`),
        },
      },
    ]);
    assert.isTrue(yield* outbox.hasUnsettled({ threadId, effectType: "provider-thread.rollback" }));
    assert.isFalse(yield* outbox.hasUnsettled({ threadId, effectType: "checkpoint.capture" }));

    assert.strictEqual(
      yield* refusalTag(startLoan(threadId)),
      "OrchestratorThreadNotReadyForCliError",
    );

    yield* outbox.cancelUnsettled({
      threadId,
      effectTypes: ["provider-thread.rollback"],
      reason: "settled",
    });
    yield* startLoan(threadId);
    const after = yield* orchestrator.getThreadProjection(threadId);
    assert.isNotNull(after.providerThreads[0]?.cliLoan ?? null);
  }),
);

loanTest("the detach for a loan keeps a process that background work still needs", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* readyThread();
    const before = yield* orchestrator.getThreadProjection(threadId);
    const providerThread = before.providerThreads[0]!;
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make(`event:${threadId}:background`),
      type: "provider-thread.updated",
      threadId,
      driver: providerThread.driver,
      providerInstanceId: providerThread.providerInstanceId,
      occurredAt: now,
      payload: {
        ...providerThread,
        pendingBackgroundTasks: [{ taskId: "task-1", kind: "subagent" }],
      },
    });
    assert.strictEqual(
      yield* refusalTag(
        orchestrator.dispatch({
          type: "provider-session.detach",
          commandId: CommandId.make(`detach:${threadId}`),
          threadId,
          providerSessionId: providerThread.providerSessionId!,
          onlyWhenIdle: true,
        }),
      ),
      "OrchestratorThreadNotReadyForCliError",
    );
  }),
);

loanTest("startup finds the threads out in the CLI, but not a deleted one", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const out = yield* readyThread();
    const back = yield* readyThread();
    yield* startLoan(out);
    assert.include(yield* projections.getThreadIdsWithOpenCliLoan(), out);
    assert.notInclude(yield* projections.getThreadIdsWithOpenCliLoan(), back);

    yield* orchestrator.dispatch({
      type: "thread.delete",
      commandId: CommandId.make(`delete:${out}`),
      threadId: out,
    });
    assert.notInclude(yield* projections.getThreadIdsWithOpenCliLoan(), out);
  }),
);

loanTest("rolling back past an imported run hides it", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    yield* finishLoan(threadId, [turn("m1")], "none");
    const imported = (yield* orchestrator.getThreadProjection(threadId)).runs[1]!;
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make(`event:${threadId}:rolled-back`),
      type: "run.updated",
      threadId,
      runId: imported.id,
      occurredAt: now,
      payload: { ...imported, status: "rolled_back", completedAt: now },
    });
    const after = yield* orchestrator.getThreadProjection(threadId);
    const visible = createOrchestrationV2TurnItemVisibility({
      runs: after.runs,
      attempts: after.attempts,
      items: after.turnItems,
    });
    const importedItems = after.turnItems.filter((item) => item.runId === imported.id);
    assert.isAbove(importedItems.length, 0);
    assert.isFalse(importedItems.some(visible));
  }),
);

loanTest("a rollback into the middle of a loan is refused", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    yield* finishLoan(threadId, [turn("m1"), turn("m2")], "none");
    const projection = yield* orchestrator.getThreadProjection(threadId);
    const middle = projection.checkpoints.find(
      (checkpoint) => checkpoint.runId === projection.runs[1]!.id,
    )!;
    assert.strictEqual(
      yield* refusalTag(
        orchestrator.dispatch({
          type: "checkpoint.rollback",
          commandId: CommandId.make(`rollback-middle:${threadId}`),
          threadId,
          scopeId: middle.scopeId,
          checkpointId: middle.id,
        }),
      ),
      "OrchestratorDispatchError",
    );
  }),
);

for (const [gap, turns, fragment] of [
  ["compacted", [turn("after-compact")], "compacted"],
  ["diverged", [], "no longer holds"],
  ["unread", [], "could not read"],
  ["truncated", [turn("kept")], "too long"],
] as const) {
  loanTest(`a ${gap} gap leaves one plain note and clears the loan`, () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = yield* readyThread();
      yield* startLoan(threadId);
      yield* finishLoan(threadId, turns, gap);
      const projection = yield* orchestrator.getThreadProjection(threadId);
      const notes = projection.turnItems.flatMap((item) =>
        item.type === "system_notice" ? [item] : [],
      );
      assert.strictEqual(notes.length, 1);
      assert.include(notes[0]!.message, fragment);
      assert.isNotNull(notes[0]!.runId);
      assert.strictEqual(projection.providerThreads[0]?.cliLoan, null);
      assert.strictEqual(projection.runs.length, 1 + turns.length);
    }),
  );
}

loanTest("no baseline still imports the turns, with the capture measuring nothing", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread({ checkpoint: false });
    yield* startLoan(threadId);
    yield* finishLoan(threadId, [turn("m1"), turn("m2")], "none");
    const projection = yield* orchestrator.getThreadProjection(threadId);
    assert.deepEqual(
      projection.runs.map((run) => run.status),
      ["completed", "completed", "waiting"],
    );
    assert.strictEqual(projection.checkpoints.length, 0);
  }),
);

loanTest("a gap records the last turn before it, and a clean loan keeps an older one", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* readyThread();
    const before = yield* orchestrator.getThreadProjection(threadId);
    const run = before.runs[0]!;
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make(`event:${threadId}:provider-turn`),
      type: "provider-turn.updated",
      threadId,
      runId: run.id,
      nodeId: run.rootNodeId!,
      occurredAt: now,
      providerInstanceId: instanceId,
      payload: {
        id: ProviderTurnId.make(`provider-turn:${threadId}`),
        providerThreadId: before.providerThreads[0]!.id,
        nodeId: run.rootNodeId!,
        runAttemptId: run.activeAttemptId!,
        nativeTurnRef: { driver, nativeId: "native-turn", strength: "strong" },
        ordinal: 3,
        status: "completed",
        startedAt: now,
        completedAt: now,
      },
    });
    const gapOrdinal = Effect.map(
      orchestrator.getThreadProjection(threadId),
      (projection) => projection.providerThreads[0]?.cliGapAfterTurnOrdinal ?? null,
    );

    yield* startLoan(threadId);
    yield* finishLoan(threadId, [], "none");
    assert.strictEqual(yield* gapOrdinal, null);

    yield* startLoan(threadId, `loan-start-2:${threadId}`);
    yield* finishLoan(threadId, [], "unread", `loan-finish-2:${threadId}`);
    assert.strictEqual(yield* gapOrdinal, 3);

    yield* startLoan(threadId, `loan-start-3:${threadId}`);
    yield* finishLoan(threadId, [], "none", `loan-finish-3:${threadId}`);
    assert.strictEqual(yield* gapOrdinal, 3);

    yield* startLoan(threadId, `loan-start-4:${threadId}`);
    yield* finishLoan(threadId, [turn("m1")], "compacted", `loan-finish-4:${threadId}`);
    assert.strictEqual(yield* gapOrdinal, 3);
  }),
);

loanTest("a cut import puts the gap after its last turn, which is where the loss is", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* readyThread();
    yield* startLoan(threadId);
    yield* finishLoan(threadId, [turn("m1"), turn("m2")], "truncated");
    const after = yield* orchestrator.getThreadProjection(threadId);
    const ordinals = after.providerTurns.map((providerTurn) => providerTurn.ordinal);
    assert.strictEqual(ordinals.length, 2);
    assert.strictEqual(after.providerThreads[0]?.cliGapAfterTurnOrdinal, Math.max(...ordinals));
  }),
);

const claudeDriver = ProviderDriverKind.make("claudeAgent");
const rollbackFixture = (rollbackDriver: ProviderDriverKind) => {
  const providerThreadIdValue = ProviderThreadId.make("provider-thread:rollback");
  const providerTurn = (
    ordinal: number,
    nativeId: string | null,
  ): ProviderAdapter.ProviderAdapterV2RollbackThreadInput["providerThreadTurns"][number] => ({
    id: ProviderTurnId.make(`provider-turn:${ordinal}`),
    providerThreadId: providerThreadIdValue,
    nodeId: `node:${ordinal}` as never,
    runAttemptId: RunAttemptId.make(`attempt:${ordinal}`),
    nativeTurnRef: {
      driver: rollbackDriver,
      nativeId,
      strength: nativeId === null ? "none" : "weak",
    },
    ordinal,
    status: "completed",
    startedAt: null,
    completedAt: null,
  });
  const turns = [providerTurn(1, "peer-1"), providerTurn(2, null), providerTurn(3, "peer-3")];
  const input = (target: number, gapOrdinal: number | null = null) =>
    ({
      providerThread: { id: providerThreadIdValue, cliGapAfterTurnOrdinal: gapOrdinal },
      providerThreadTurns: turns,
      target: {
        type: "provider_turn",
        checkpointId: CheckpointId.make("checkpoint:rollback"),
        appRunOrdinal: target,
        providerTurn: turns[target - 1]!,
      },
    }) as unknown as ProviderAdapter.ProviderAdapterV2RollbackThreadInput;
  return input;
};

it.effect("Codex counts imported turns when rolling back past them", () =>
  Effect.gen(function* () {
    const input = rollbackFixture(driver);
    assert.strictEqual(yield* resolveCodexRollbackTurnCount(input(1)), 2);
  }),
);

it.effect("Codex refuses to roll back past a gap, and rolls back after one", () =>
  Effect.gen(function* () {
    const input = rollbackFixture(driver);
    for (const target of [input(1, 2), input(2, 2)]) {
      const refused = yield* Effect.flip(resolveCodexRollbackTurnCount(target));
      assert.include(String(refused.cause), "could not read in full");
    }
    const toStart = {
      ...input(1, 0),
      target: { type: "thread_start" },
    } as unknown as ProviderAdapter.ProviderAdapterV2RollbackThreadInput;
    assert.include(
      String((yield* Effect.flip(resolveCodexRollbackTurnCount(toStart))).cause),
      "could not read in full",
    );
    assert.strictEqual(yield* resolveCodexRollbackTurnCount(input(3, 2)), 0);
  }),
);

it.effect(
  "Claude refuses a rollback at or before a gap, whose id a compaction may have removed",
  () =>
    Effect.gen(function* () {
      const input = rollbackFixture(claudeDriver);
      const refused = yield* Effect.flip(resolveClaudeRollbackResumeSessionAt(input(1, 2)));
      assert.strictEqual(
        refused.refusal,
        "Claude cannot go back past a CLI session Peer could not read in full. Roll back to a turn after that session instead.",
      );
      assert.strictEqual(yield* resolveClaudeRollbackResumeSessionAt(input(3, 2)), "peer-3");
      const toStart = { ...input(1, 2), target: { type: "thread_start" } } as never;
      assert.strictEqual(yield* resolveClaudeRollbackResumeSessionAt(toStart), null);
    }),
);

it.effect("Claude forks pass a gap, and say what is true about imported turns", () =>
  Effect.gen(function* () {
    const input = rollbackFixture(claudeDriver);
    const fork = (target: number, gapOrdinal: number | null = null) => {
      const rollback = input(target, gapOrdinal);
      return resolveClaudeForkUpToMessageId({
        sourceProviderThread: rollback.providerThread,
        sourceProviderTurns: rollback.providerThreadTurns,
        providerTurnId:
          rollback.target.type === "provider_turn" ? rollback.target.providerTurn.id : undefined,
      } as never);
    };
    const cause = (target: number, gapOrdinal?: number) =>
      fork(target, gapOrdinal).pipe(
        Effect.flip,
        Effect.map((error) => String(error.cause)),
      );

    assert.strictEqual(yield* fork(1, 2), "peer-1");
    assert.strictEqual(yield* fork(3, 2), "peer-3");
    assert.strictEqual(
      yield* cause(2),
      "Claude cannot fork from a turn that ran in the CLI once other turns follow it. Fork from a turn before the CLI turns instead.",
    );
    assert.strictEqual(yield* fork(1), "peer-1");
  }),
);

it.effect("Claude rewinds past an imported turn but not to one that others follow", () =>
  Effect.gen(function* () {
    const input = rollbackFixture(claudeDriver);
    assert.strictEqual(yield* resolveClaudeRollbackResumeSessionAt(input(1)), "peer-1");
    const refused = yield* Effect.flip(resolveClaudeRollbackResumeSessionAt(input(2)));
    assert.include(String(refused.cause), "ran in the CLI");
  }),
);
