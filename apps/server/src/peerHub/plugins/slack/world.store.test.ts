import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import { makeWorld, type SlackThreads } from "./world.ts";

/**
 * The world reads T3's projection through ThreadManagementService; here it reads the real
 * projection store, in SQL and in memory, so that the filters it asks for are the store's own.
 */
const threadId = ThreadId.make("thread:slack-world");
const providerThreadId = ProviderThreadId.make("provider-thread:slack-world");
const providerSessionId = ProviderSessionId.make("session:slack-world");
const runId = RunId.make("run:slack-world");
const userMessageId = MessageId.make("message:slack-world:user");
const requestId = RuntimeRequestId.make("request:slack-world");
const nodeId = NodeId.make("node:slack-world");
const providerInstanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-6" };

const thread = (now: DateTime.Utc, over: Record<string, unknown> = {}) =>
  [
    {
      id: EventId.make("slack-world:thread"),
      type: "thread.created",
      threadId,
      occurredAt: now,
      payload: {
        id: threadId,
        projectId: ProjectId.make("project:slack-world"),
        title: "Split payments",
        providerInstanceId,
        modelSelection,
        createdBy: "user",
        creationSource: "web",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: "/workspace",
        activeProviderThreadId: providerThreadId,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
        ...over,
      },
    },
    {
      id: EventId.make("slack-world:provider-thread"),
      type: "provider-thread.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: providerThreadId,
        driver,
        providerInstanceId,
        providerSessionId,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
        nativeConversationHeadRef: null,
        status: "active",
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  ] as ReadonlyArray<OrchestrationV2DomainEvent>;

/** A run that began at `began`, and the person's message that began it. */
const run = (began: DateTime.Utc, status: "waiting" | "completed", ended: DateTime.Utc | null) =>
  [
    {
      id: EventId.make("slack-world:run"),
      type: "run.created",
      threadId,
      occurredAt: began,
      payload: {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection,
        providerThreadId,
        userMessageId,
        rootNodeId: nodeId,
        activeAttemptId: null,
        status,
        requestedAt: began,
        startedAt: began,
        completedAt: ended,
        checkpointId: null,
        contextHandoffId: null,
      },
    },
    {
      id: EventId.make("slack-world:user"),
      type: "message.updated",
      threadId,
      occurredAt: began,
      payload: {
        id: userMessageId,
        threadId,
        runId,
        nodeId,
        role: "user",
        text: "Split the payments module.",
        attachments: [],
        streaming: false,
        createdBy: "user",
        creationSource: "web",
        createdAt: began,
        updatedAt: began,
      },
    },
  ] as ReadonlyArray<OrchestrationV2DomainEvent>;

/** The run waits on an approval of `command`, which `capability` says whether Peer may answer. */
const asking = (now: DateTime.Utc, capability: Record<string, unknown>) =>
  [
    {
      id: EventId.make("slack-world:node"),
      type: "node.updated",
      threadId,
      runId,
      nodeId,
      occurredAt: now,
      payload: {
        id: nodeId,
        threadId,
        runId,
        parentNodeId: null,
        rootNodeId: nodeId,
        kind: "approval_request",
        status: "waiting",
        countsForRun: false,
        providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: requestId,
        checkpointScopeId: null,
        startedAt: now,
        completedAt: null,
      },
    },
    {
      id: EventId.make("slack-world:request"),
      type: "runtime-request.updated",
      threadId,
      runId,
      nodeId,
      occurredAt: now,
      payload: {
        id: requestId,
        nodeId,
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "command",
        status: "pending",
        responseCapability: capability,
        createdAt: now,
        resolvedAt: null,
      },
    },
    {
      id: EventId.make("slack-world:item"),
      type: "turn-item.updated",
      threadId,
      runId,
      nodeId,
      occurredAt: now,
      payload: {
        id: TurnItemId.make("item:slack-world"),
        threadId,
        runId,
        nodeId,
        providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "waiting",
        title: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
        type: "approval_request",
        requestId,
        requestKind: "command",
        prompt: "Run the migration?",
      },
    },
  ] as ReadonlyArray<OrchestrationV2DomainEvent>;

/** The agent said `text` as the run ended. */
const said = (now: DateTime.Utc, text: string) =>
  ({
    id: EventId.make("slack-world:assistant"),
    type: "message.updated",
    threadId,
    runId,
    nodeId,
    occurredAt: now,
    payload: {
      id: MessageId.make("message:slack-world:assistant"),
      threadId,
      runId,
      nodeId,
      role: "assistant",
      text,
      attachments: [],
      streaming: false,
      createdBy: "system",
      creationSource: "server",
      createdAt: now,
      updatedAt: now,
    },
  }) as OrchestrationV2DomainEvent;

const stores = [
  {
    name: "sqlite",
    layer: ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  },
  { name: "memory", layer: ProjectionStore.layerMemory },
] as const;

/** The waits of Ana's acme/pay thread, read from the store. */
const waitsFrom = (store: ProjectionStore.ProjectionStoreV2["Service"], tracked: string[] = []) =>
  makeWorld({
    work: {
      localThreads: Effect.succeed(
        new Map([
          [
            "acme",
            [
              {
                id: `peer:${threadId}`,
                project: "pay",
                title: "x",
                status: "working",
                source: "peer",
              },
            ],
          ],
        ]),
      ),
      tasks: () => Effect.succeed([]),
    } as never,
    agents: { runtimeAgents: Effect.succeed([]), lastMessage: () => Effect.void } as never,
    threads: () => store as unknown as SlackThreads,
    computer: "Ana's Mac",
  })(new Set(["acme"]), new Set(tracked)).pipe(Effect.map((world) => world?.waits ?? []));

it.effect.each(stores)(
  "$name: a thread waiting on an approval Peer can answer is a wait with its prompt",
  ({ layer }) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const began = DateTime.subtract(now, { minutes: 10 });
      const events = [
        ...thread(began),
        ...run(began, "waiting", null),
        ...asking(now, { type: "live", providerSessionId }),
      ];
      yield* Effect.forEach(events, (event) => store.apply(event), { discard: true });
      const waits = yield* waitsFrom(store);
      assert.deepStrictEqual(
        waits.map((wait) => [wait.waitKey, wait.kind, wait.text, wait.decisions]),
        [
          [
            `peer:${threadId}:req:${requestId}`,
            "approval",
            "Run the migration?",
            ["accept", "decline"],
          ],
        ],
      );
    }).pipe(Effect.provide(layer)),
);

it.effect.each(stores)("$name: a request that cannot be resumed is no wait", ({ layer }) =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const now = yield* DateTime.now;
    const began = DateTime.subtract(now, { minutes: 10 });
    const events = [
      ...thread(began),
      ...run(began, "waiting", null),
      ...asking(now, { type: "not_resumable", reason: "the provider session ended" }),
    ];
    yield* Effect.forEach(events, (event) => store.apply(event), { discard: true });
    assert.deepStrictEqual(yield* waitsFrom(store), []);
  }).pipe(Effect.provide(layer)),
);

it.effect.each(stores)(
  "$name: a thread whose run ended and said something is a finished wait with its words",
  ({ layer }) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const began = DateTime.subtract(now, { minutes: 10 });
      const events = [
        ...thread(began),
        ...run(began, "completed", now),
        said(now, "Split it. Which module next?"),
      ];
      yield* Effect.forEach(events, (event) => store.apply(event), { discard: true });
      const waits = yield* waitsFrom(store);
      assert.deepStrictEqual(
        waits.map((wait) => [wait.waitKey, wait.kind, wait.text]),
        [[`peer:${threadId}:run:${runId}`, "finished", "Split it. Which module next?"]],
      );
    }).pipe(Effect.provide(layer)),
);

it.effect.each(stores)(
  "$name: a turn that ended long ago is history unless the ledger tracks it",
  ({ layer }) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const began = DateTime.subtract(now, { hours: 3 });
      const ended = DateTime.subtract(now, { hours: 2 });
      const events = [...thread(began), ...run(began, "completed", ended), said(ended, "Done.")];
      yield* Effect.forEach(events, (event) => store.apply(event), { discard: true });
      assert.deepStrictEqual(yield* waitsFrom(store), []);
      const tracked = yield* waitsFrom(store, [`peer:${threadId}:run:${runId}`]);
      assert.deepStrictEqual(
        tracked.map((wait) => wait.text),
        ["Done."],
      );
    }).pipe(Effect.provide(layer)),
);
