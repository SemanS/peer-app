// @effect-diagnostics nodeBuiltinImport:off - memory's local state in a temporary directory.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerMemoryCommand, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../../config.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import * as MemoryRuntime from "./MemoryRuntime.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryTransport from "./MemoryTransport.ts";
import { makeBackground } from "./run.ts";

const decodeCommand = Schema.decodeUnknownEffect(PeerMemoryCommand);
const identity = {
  hubUrl: "https://hub.test",
  email: "ana@acme.test",
  token: "phs_test",
  environmentId: "ana-laptop",
};

/** A memory Hub that answers while `online`, keeping the operations sent to it in order. */
const memoryHub = () => {
  const hub = { online: false, sent: [] as Array<string> };
  const offline = new MemoryTransport.MemoryError({ code: "unavailable", detail: "offline" });
  const transport = MemoryTransport.MemoryTransport.of({
    identity: Effect.succeed(identity),
    authorize: () => (hub.online ? Effect.void : Effect.fail(offline)),
    request: (_identity, _scope, method, path, schema, body) =>
      Effect.gen(function* () {
        if (!hub.online) return yield* offline;
        let output: unknown;
        if (path === "/mode") output = { mode: "shadow" };
        else if (path.endsWith("/coord")) output = {};
        else if (path === "/commands") {
          const command = yield* decodeCommand(body).pipe(Effect.orDie);
          hub.sent.push(command.operationId);
          output = {
            operationId: command.operationId,
            replayed: false,
            records: [],
            cursor: hub.sent.length,
            topologyRevision: 0,
          };
        } else if (path.startsWith("/changes"))
          output = { changes: [], cursor: 0, hasMore: false, resyncRequired: false };
        else throw new Error(`Unexpected request ${method} ${path}`);
        return yield* Schema.decodeUnknownEffect(schema)(output).pipe(Effect.orDie);
      }),
  });
  return { hub, transport };
};

/** Ana's Peer thread-1, running Claude Code in her Payments checkout until `running` says not. */
const threadOne = { running: true, checkout: "" };
const paymentsThread: Layer.Layer<
  ProjectService.ProjectService | ProjectionStore.ProjectionStoreV2 | Settings.ServerSettingsService
> = Layer.mergeAll(
  Layer.mock(ProjectService.ProjectService)({
    getById: () => Effect.succeed(Option.some({ workspaceRoot: threadOne.checkout } as never)),
    getByWorkspaceRoot: () => Effect.succeed(Option.none()),
  }),
  Layer.mock(ProjectionStore.ProjectionStoreV2)({
    getThreadShell: () =>
      Effect.sync(
        () =>
          ({
            id: ThreadId.make("thread-1"),
            projectId: ProjectId.make("t3-pay"),
            title: "Split payments",
            providerInstanceId: ProviderInstanceId.make("claude-1"),
            activeProviderThreadId: "provider-1",
            activeRunId: threadOne.running ? "run-1" : null,
            deletedAt: null,
            archivedAt: null,
          }) as never,
      ),
    getThreadRecords: () =>
      Effect.succeed({
        providerThreads: [
          { id: "provider-1", driver: "claudeAgent", nativeThreadRef: { nativeId: "native-1" } },
        ],
      } as never),
  }),
  Layer.mock(Settings.ServerSettingsService)({
    getSettings: Effect.succeed({ providerInstances: {} } as never),
  }),
);

/** Memory's background work for Ana, signed in to acme's Payments project, on `transport`. */
const anaInPayments = (transport: MemoryTransport.MemoryTransport["Service"]) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: () => [404, {}] });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        t3: paymentsThread,
      }),
    );
    const memory = MemoryRuntime.layer.pipe(
      Layer.provideMerge(MemoryService.layer),
      Layer.provideMerge(Layer.succeed(MemoryTransport.MemoryTransport, transport)),
      Layer.provideMerge(
        Layer.succeed(
          MemoryTransport.MemoryAuth,
          MemoryTransport.MemoryAuth.of({
            identity: Effect.succeed(identity),
            repository: () =>
              Effect.fail(new MemoryTransport.MemoryError({ code: "not_found", detail: "none" })),
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(core)),
    );
    return yield* Effect.gen(function* () {
      const state = yield* PeerState.PeerState;
      threadOne.checkout = state.checkoutPath(state.current().persisted, "acme", "pay", "api");
      return {
        background: yield* makeBackground,
        memory: yield* MemoryService.MemoryService,
        runtime: yield* MemoryRuntime.MemoryRuntime,
        stateDir: (yield* ServerConfig.ServerConfig).stateDir,
      };
    }).pipe(Effect.provide(memory));
  });

/** Every file under `dir` with its content, by path. */
const filesUnder = (dir: string) =>
  Effect.promise(async () => {
    const entries = await NodeFSP.readdir(dir, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile());
    return Object.fromEntries(
      await Promise.all(
        files.map(async (entry) => {
          const path = NodePath.join(entry.parentPath, entry.name);
          return [path, await NodeFSP.readFile(path, "utf8")] as const;
        }),
      ),
    );
  });

const remember = (operationId: string, claim: string) => ({
  workspace: "acme",
  project: "pay",
  command: {
    schemaVersion: 1 as const,
    operationId,
    type: "assertion.record" as const,
    claim,
    contextIds: [],
    evidence: [],
  },
});

describe("memory's background work", () => {
  it.effect("leaves the local data alone when turned off, and sends what waited in order", () =>
    Effect.gen(function* () {
      const { hub, transport } = memoryHub();
      const ana = yield* anaInPayments(transport);
      // The Hub cannot be reached: both writes stay on this computer.
      for (const [operation, claim] of [
        ["op-1", "Prices are kept in cents"],
        ["op-2", "Refunds are a separate ledger"],
      ] as const) {
        const written = yield* ana.memory.execute(remember(operation, claim));
        assert.strictEqual(written.status, "pending_local");
      }
      const memoryDir = NodePath.join(ana.stateDir, "memory");
      const before = yield* filesUnder(memoryDir);
      assert.isAbove(Object.keys(before).length, 0);

      yield* ana.background.turnOff;
      assert.deepStrictEqual(yield* filesUnder(memoryDir), before);

      // On again, the next synchronization sends both, unchanged and in order.
      hub.online = true;
      yield* ana.background.refresh();
      assert.deepStrictEqual(hub.sent, ["op-1", "op-2"]);
      const queue = yield* ana.memory.queue({ workspace: "acme", project: "pay" });
      assert.deepStrictEqual(queue.operations, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("ends the runtime the app ran for a thread once the thread stops", () =>
    Effect.gen(function* () {
      const { hub, transport } = memoryHub();
      hub.online = true;
      threadOne.running = true;
      const ana = yield* anaInPayments(transport);
      const session = yield* ana.runtime.runtime(
        ThreadId.make("thread-1"),
        "provider-session-1",
        ProviderInstanceId.make("claude-1"),
      );
      assert.strictEqual(session.sessionId, "peer:thread-1");
      assert.deepStrictEqual(
        ana.runtime.reported("acme").map((reported) => reported.id),
        ["peer:thread-1"],
      );

      // Still running: the refresh keeps it.
      yield* ana.background.refresh();
      assert.strictEqual(ana.runtime.reported("acme").length, 1);

      threadOne.running = false;
      yield* ana.background.refresh();
      assert.deepStrictEqual(ana.runtime.reported("acme"), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
