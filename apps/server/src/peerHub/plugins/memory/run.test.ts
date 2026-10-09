// @effect-diagnostics nodeBuiltinImport:off - memory's local state in a temporary directory.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerMemoryCommand, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../../config.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import { makeMemoryPlugin } from "./index.ts";
import * as MemoryCli from "./MemoryCli.ts";
import * as MemoryRuntime from "./MemoryRuntime.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryTransport from "./MemoryTransport.ts";
import { makeBackground } from "./run.ts";

const decodeCommand = Schema.decodeUnknownEffect(PeerMemoryCommand);
const decodeState = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      sessions: Schema.Array(Schema.Struct({ sessionId: Schema.String, ended: Schema.Boolean })),
    }),
  ),
);
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

/**
 * Ana's Peer in acme's Payments project with the memory plugin in the build, over `transport`. The
 * plugin builds its services where core starts it and the test keeps them, so what core does to the
 * plugin (`plugins`) shows in them. `background` is a second one over the same services, so the
 * test runs a refresh now rather than waiting for the plugin's 15 seconds.
 */
const anaInPayments = (transport: MemoryTransport.MemoryTransport["Service"]) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: () => [404, {}] });
    const auth = MemoryTransport.MemoryAuth.of({
      identity: Effect.succeed(identity),
      repository: () =>
        Effect.fail(new MemoryTransport.MemoryError({ code: "not_found", detail: "none" })),
    });
    const built: {
      current?: Context.Context<MemoryService.MemoryService | MemoryRuntime.MemoryRuntime>;
    } = {};
    const services = MemoryRuntime.layer.pipe(
      Layer.provideMerge(MemoryCli.layer),
      Layer.provideMerge(MemoryService.layer),
      Layer.provideMerge(Layer.succeed(MemoryTransport.MemoryTransport, transport)),
      Layer.provideMerge(Layer.succeed(MemoryTransport.MemoryAuth, auth)),
      Layer.tap(
        (context: Context.Context<MemoryService.MemoryService | MemoryRuntime.MemoryRuntime>) =>
          Effect.sync(() => void (built.current = context)),
      ),
    );
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        t3: paymentsThread,
        plugins: [makeMemoryPlugin({ available: true }, services)],
      }),
    );
    return yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      const state = yield* PeerState.PeerState;
      threadOne.checkout = state.checkoutPath(state.current().persisted, "acme", "pay", "api");
      const memory = Context.get(built.current!, MemoryService.MemoryService);
      const runtime = Context.get(built.current!, MemoryRuntime.MemoryRuntime);
      return {
        plugins: yield* PeerPlugins.PeerPlugins,
        background: yield* makeBackground.pipe(
          Effect.provideService(MemoryService.MemoryService, memory),
          Effect.provideService(MemoryRuntime.MemoryRuntime, runtime),
          Effect.provideService(MemoryTransport.MemoryAuth, auth),
        ),
        memory,
        runtime,
        stateDir: (yield* ServerConfig.ServerConfig).stateDir,
      };
    }).pipe(Effect.provide(core));
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

/** The sessions memory's local state holds, with whether each has ended. */
const sessionsEnded = (dir: string) =>
  filesUnder(dir).pipe(
    Effect.map((files) =>
      Object.entries(files)
        .filter(([path]) => path.endsWith("state.json"))
        .flatMap(([, text]) => decodeState(text).sessions)
        .map(({ sessionId, ended }) => [sessionId, ended]),
    ),
  );

describe("memory's background work", () => {
  it.effect("leaves the local data alone when turned off, and sends what waited in order", () =>
    Effect.gen(function* () {
      const { hub, transport } = memoryHub();
      threadOne.running = true;
      const ana = yield* anaInPayments(transport);
      yield* ana.plugins.setPlugin({ id: "memory", enabled: true });
      // The Hub cannot be reached: both writes stay on this computer.
      for (const [operation, claim] of [
        ["op-1", "Prices are kept in cents"],
        ["op-2", "Refunds are a separate ledger"],
      ] as const) {
        const written = yield* ana.memory.execute(remember(operation, claim));
        assert.strictEqual(written.status, "pending_local");
      }
      // The app runs a runtime for Ana's thread, which the next report would carry to the Hub.
      yield* ana.runtime.runtime(
        ThreadId.make("thread-1"),
        "provider-session-1",
        ProviderInstanceId.make("claude-1"),
      );
      assert.deepStrictEqual(
        ana.runtime.reported("acme").map((reported) => reported.id),
        ["peer:thread-1"],
      );
      const memoryDir = NodePath.join(ana.stateDir, "memory");
      const before = yield* filesUnder(memoryDir);
      assert.isAbove(Object.keys(before).length, 0);

      yield* ana.plugins.setPlugin({ id: "memory", enabled: false });
      // It forgets the runtime without ending it, and writes and sends nothing.
      assert.deepStrictEqual(ana.runtime.reported("acme"), []);
      assert.deepStrictEqual(yield* filesUnder(memoryDir), before);
      assert.deepStrictEqual(hub.sent, []);

      // On again, the next synchronization sends both, unchanged and in order.
      yield* ana.plugins.setPlugin({ id: "memory", enabled: true });
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
      const memoryDir = NodePath.join(ana.stateDir, "memory");
      assert.deepStrictEqual(yield* sessionsEnded(memoryDir), [["peer:thread-1", false]]);

      // Still running: the refresh keeps it.
      yield* ana.background.refresh();
      assert.strictEqual(ana.runtime.reported("acme").length, 1);
      assert.deepStrictEqual(yield* sessionsEnded(memoryDir), [["peer:thread-1", false]]);

      threadOne.running = false;
      yield* ana.background.refresh();
      assert.deepStrictEqual(ana.runtime.reported("acme"), []);
      // Memory's local state records that it ended.
      assert.deepStrictEqual(yield* sessionsEnded(memoryDir), [["peer:thread-1", true]]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
