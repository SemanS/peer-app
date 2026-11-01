import * as NodeOS from "node:os";

import { historyResponseItems } from "@t3tools/provider-core/server/handoffBudget";
import {
  makeProviderTextDeltaCoalescer,
  type ProviderTextDeltaUpdate,
} from "./ProviderTextDeltaCoalescer.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  CheckpointId,
  CodexSettings,
  EnvironmentId,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2TurnItem,
  ProjectId,
  type ProviderApprovalDecision,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexError from "effect-codex-app-server/errors";
import * as CodexReplay from "effect-codex-app-server/replay";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as FileSystem from "effect/FileSystem";
import { MCP_APP_OUTPUT_KEY, readMcpAppReference } from "@t3tools/shared/mcpApp";
import { resolveAttachmentPathById } from "../../attachmentStore.ts";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import packageJson from "../../../package.json" with { type: "json" };
import * as ServerConfig from "../../config.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as EffectWorker from "../EffectWorker.ts";
import * as Orchestrator from "../Orchestrator.ts";
import * as ProviderReplayHarness from "../testkit/ProviderReplayHarness.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as CodexAdapterV2 from "./CodexAdapterV2.ts";
import { makeReplayServerConfig, withCodexReplayChildMetadata } from "./CodexAdapterV2.testkit.ts";
import * as CodexAdapterV2Testkit from "./CodexAdapterV2.testkit.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const replayTranscriptJson = Schema.fromJsonString(CodexReplay.CodexAppServerReplayTranscript);
const encodeReplayTranscriptJson = Schema.encodeEffect(replayTranscriptJson);
const decodeReplayTranscriptJson = Schema.decodeUnknownEffect(replayTranscriptJson);
const encodeStringJson = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});
const CODEX_TEST_MODEL_SELECTION = { instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID, model: "gpt-5.4" } satisfies ModelSelection;
const CODEX_TEST_RUNTIME_POLICY = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({ runtimeMode: "full-access", interactionMode: "default", cwd: "/workspace" });

describe("Codex context usage compatibility", () => {
  const previous: ModelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-6-astra",
  };
  it("retains measured usage for reasoning-only changes in either direction", () => {
    const low: ModelSelection = { ...previous, options: [{ id: "reasoningEffort", value: "low" }] };
    assert.isTrue(CodexAdapterV2.canReuseCodexContextUsage(previous, low));
    assert.isTrue(CodexAdapterV2.canReuseCodexContextUsage(low, previous));
    assert.isTrue(
      CodexAdapterV2.canReuseCodexContextUsage(low, {
        ...low,
        options: [{ id: "reasoningEffort", value: "high" }],
      }),
    );
  });
  it("invalidates usage for model, instance, context-window and unknown option changes", () => {
    for (const next of [
      { ...previous, model: "other-model" },
      { ...previous, instanceId: ProviderInstanceId.make("other-codex") },
      { ...previous, options: [{ id: "contextWindow", value: "32k" }] },
      { ...previous, options: [{ id: "customOption", value: "value" }] },
    ])
      assert.isFalse(CodexAdapterV2.canReuseCodexContextUsage(previous, next));
  });
});


describe("CodexAdapterV2 process spawning", () => {
  it("injects cwd, model, and MCP authorization into thread-scoped params", () => {
    const threadId = ThreadId.make("thread-codex-mcp");
    const mcpSession = {
      environmentId: EnvironmentId.make("environment-codex-mcp"),
      threadId,
      providerSessionId: "mcp-session-codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      endpoint: "http://127.0.0.1:43123/mcp",
      authorizationHeader: "Bearer secret-codex-token",
      browserToolsAvailable: true,
    };

    assert.deepEqual(
      CodexAdapterV2.codexThreadRuntimeParams({
        mcpSession,
        modelSelection: { model: "gpt-5.4" },
        runtimePolicy: {
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: "/workspace/thread-codex-mcp",
        },
      }),
      {
        cwd: "/workspace/thread-codex-mcp",
        model: "gpt-5.4",
        config: {
          "tools.update_plan.enabled": true,
          // Codex waits up to 10 s, not 1 s, for MCP servers before the first request (#13437).
          mcp_optional_startup_grace_ms: 10_000,
          "mcp_servers.t3-code": {
            url: "http://127.0.0.1:43123/mcp",
            tool_timeout_sec: 3_900,
            http_headers: {
              Authorization: "Bearer secret-codex-token",
            },
          },
        },
      },
    );
  });

  it.effect("resolves Windows command shims through the shared spawn policy", () =>
    Effect.gen(function* () {
      const command = yield* CodexAdapterV2.makeCodexAppServerSpawnCommand({
        command: "codex",
        args: ["app-server", "argument with spaces"],
        cwd: "C:\\workspace",
        env: { CUSTOM: "1" },
        extendEnv: true,
      });

      assert.isTrue(ChildProcess.isStandardCommand(command));
      if (!ChildProcess.isStandardCommand(command)) {
        return;
      }
      assert.equal(
        command.command,
        '^"C:\\npm\\codex.cmd^" ^"app-server^" ^"argument^ with^ spaces^"',
      );
      assert.deepEqual(command.args, []);
      assert.equal(command.options.shell, true);
      assert.equal(command.options.cwd, "C:\\workspace");
      assert.deepEqual(command.options.env, { CUSTOM: "1" });
      assert.equal(command.options.extendEnv, true);
    }).pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, {
        PATH: "C:\\Windows\\System32",
        HOST_ONLY: "1",
      }),
      Effect.provideService(SpawnExecutableResolution, (_command, _platform, environment) => {
        assert.equal(environment.HOST_ONLY, "1");
        assert.equal(environment.CUSTOM, "1");
        return "C:\\npm\\codex.cmd";
      }),
    ),
  );

  it.effect("uses direct execution for native executables", () =>
    Effect.gen(function* () {
      const command = yield* CodexAdapterV2.makeCodexAppServerSpawnCommand({
        command: "codex.exe",
        args: ["app-server"],
      });

      assert.isTrue(ChildProcess.isStandardCommand(command));
      if (!ChildProcess.isStandardCommand(command)) {
        return;
      }
      assert.equal(command.command, "C:\\bin\\codex.exe");
      assert.deepEqual(command.args, ["app-server"]);
      assert.equal(command.options.shell, false);
    }).pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(SpawnExecutableResolution, () => "C:\\bin\\codex.exe"),
    ),
  );

  it.effect("launches the app-server with the configured launch arguments", () =>
    Effect.gen(function* () {
      const spawnedArgs: Array<ReadonlyArray<string>> = [];
      const spawner = ChildProcessSpawner.make((command) => {
        if (ChildProcess.isStandardCommand(command)) spawnedArgs.push(command.args);
        return Effect.fail(
          PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
        );
      });
      const factory = yield* CodexAdapterV2.CodexAppServerClientFactory.pipe(
        Effect.provide(CodexAdapterV2.layerAppServerClientFactory),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      );
      const open = (environment: NodeJS.ProcessEnv) =>
        factory
          .open({
            instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
            threadId: ThreadId.make("thread-launch-args"),
            providerSessionId: ProviderSessionId.make("provider-session-launch-args"),
            runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
              runtimeMode: "full-access",
              interactionMode: "default",
              cwd: "/workspace",
            }),
            settings: {
              ...DEFAULT_CODEX_SETTINGS,
              launchArgs: " --strict-config -c model_reasoning_summary=detailed ",
            },
            environment,
          })
          .pipe(Effect.scoped, Effect.exit);

      yield* open({});
      yield* open({ T3CODE_CODEX_LAUNCH_ARGS: " --enable env-feature " });

      assert.deepEqual(spawnedArgs, [
        ["app-server", "--strict-config", "-c", "model_reasoning_summary=detailed"],
        ["app-server", "--enable", "env-feature"],
      ]);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("expands ~ in the configured binary path before spawning", () =>
    Effect.gen(function* () {
      const spawnedCommands: Array<string> = [];
      const spawner = ChildProcessSpawner.make((command) => {
        if (ChildProcess.isStandardCommand(command)) spawnedCommands.push(command.command);
        return Effect.fail(
          PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
        );
      });
      const path = yield* Path.Path;
      const adapter = yield* CodexAdapterV2.createCodexAdapterV2({
        instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
        displayName: undefined,
        environment: [],
        enabled: true,
        config: { ...DEFAULT_CODEX_SETTINGS, binaryPath: "~/bin/codex" },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            CodexAdapterV2.layerAppServerClientFactory,
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-codex-binary-home-" }),
          ),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      );

      yield* adapter
        .openSession({
          threadId: ThreadId.make("thread-binary-home"),
          providerSessionId: ProviderSessionId.make("provider-session-binary-home"),
          modelSelection: CODEX_TEST_MODEL_SELECTION,
          runtimePolicy: CODEX_TEST_RUNTIME_POLICY,
        })
        .pipe(Effect.scoped, Effect.exit);

      assert.deepEqual(spawnedCommands, [path.join(NodeOS.homedir(), "bin", "codex")]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
      ),
      Effect.provideService(HostProcess.Platform, "linux"),
    ),
  );
});


describe("CodexAdapterV2 native protocol logging", () => {
  it.effect("never logs workspace MCP configuration with nonstandard secret names", () =>
    Effect.gen(function* () {
      const writes: Array<unknown> = [];
      const logger = CodexAdapterV2.makeCodexAppServerProtocolLogger({
        nativeEventLogger: {
          filePath: "/tmp/events.log",
          write: (event) =>
            Effect.sync(() => {
              writes.push(event);
            }),
          close: () => Effect.void,
        },
        threadId: ThreadId.make("tool-trust"),
        providerSessionId: ProviderSessionId.make("session-trust"),
      });
      assert.exists(logger);
      if (logger === undefined) return;
      yield* logger({
        direction: "outgoing",
        stage: "decoded",
        payload: {
          method: "thread/start",
          params: {
            config: {
              mcp_servers: {
                tracker: {
                  url: "https://tracker.test",
                  http_headers: { "X-Custom": "private-header" },
                  env: { DATA: "private-env" },
                },
              },
            },
          },
        },
      });
      const serialized = encodeUnknownJson(writes);
      assert.notInclude(serialized, "private-header");
      assert.notInclude(serialized, "private-env");
      assert.include(serialized, "[REDACTED]");
    }),
  );

  it.effect("logs decoded app-server frames once with credentials redacted", () =>
    Effect.gen(function* () {
      const writes: Array<{
        readonly event: unknown;
        readonly threadId: ThreadId | null;
      }> = [];
      const logger: ProviderEventLoggers.EventNdjsonLogger = {
        filePath: "/tmp/events.log",
        write: (event, threadId) =>
          Effect.sync(() => {
            writes.push({ event, threadId });
          }),
        close: () => Effect.void,
      };
      const threadId = ThreadId.make("thread-1");
      const providerSessionId = ProviderSessionId.make("provider-session-1");
      const protocolLogger = CodexAdapterV2.makeCodexAppServerProtocolLogger({
        nativeEventLogger: logger,
        threadId,
        providerSessionId,
      });

      assert.notEqual(protocolLogger, undefined);
      if (protocolLogger === undefined) {
        return;
      }

      yield* protocolLogger({
        direction: "incoming",
        stage: "decoded",
        payload: {
          method: "thread/event",
          params: {
            id: "evt-1",
            http_headers: { Authorization: "Bearer secret-codex-token" },
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          },
        },
      });
      yield* protocolLogger({
        direction: "incoming",
        stage: "raw",
        payload:
          '{"method":"thread/event","params":{"http_headers":{"Authorization":"Bearer secret-codex-token"}}}\n',
      });

      assert.equal(writes.length, 1);
      assert.equal(writes[0]?.threadId, threadId);
      assert.deepEqual(writes[0]?.event, {
        provider: "codex",
        protocol: "codex.app-server",
        kind: "protocol",
        providerSessionId,
        event: {
          direction: "incoming",
          stage: "decoded",
          payload: {
            method: "thread/event",
            params: {
              id: "evt-1",
              http_headers: { Authorization: "[REDACTED]" },
              usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
            },
          },
        },
      });
    }),
  );

  it.effect("filters streaming frames before redaction without losing decode failures", () =>
    Effect.gen(function* () {
      const writes: Array<unknown> = [];
      const protocolLogger = CodexAdapterV2.makeCodexAppServerProtocolLogger({
        nativeEventLogger: {
          filePath: "/tmp/events.log",
          write: (event) =>
            Effect.sync(() => {
              writes.push(event);
            }),
          close: () => Effect.void,
        },
        threadId: ThreadId.make("thread-1"),
        providerSessionId: ProviderSessionId.make("provider-session-1"),
      });
      assert.exists(protocolLogger);
      if (protocolLogger === undefined) return;

      yield* protocolLogger({
        direction: "incoming",
        stage: "decoded",
        payload: {
          method: "item/agentMessage/delta",
          get params() {
            throw new Error("delta must not be copied");
          },
        },
      });
      yield* protocolLogger({
        direction: "incoming",
        stage: "raw",
        get payload() {
          throw new Error("raw frame must not be parsed");
        },
      });
      yield* protocolLogger({
        direction: "incoming",
        stage: "decode_failed",
        payload: { operation: "decode", method: "turn/completed", issueCount: 1 },
      });

      assert.equal(writes.length, 1);
      assert.nestedPropertyVal(writes[0], "event.stage", "decode_failed");
      assert.nestedPropertyVal(writes[0], "event.payload.method", "turn/completed");
    }),
  );

  it.effect("retains redacted failures when large payloads are summarized", () =>
    Effect.gen(function* () {
      const writes: Array<unknown> = [];
      const protocolLogger = CodexAdapterV2.makeCodexAppServerProtocolLogger({
        nativeEventLogger: {
          filePath: "/tmp/events.log",
          write: (event) =>
            Effect.sync(() => {
              writes.push(event);
            }),
          close: () => Effect.void,
        },
        threadId: ThreadId.make("thread-1"),
        providerSessionId: ProviderSessionId.make("provider-session-1"),
      });
      assert.exists(protocolLogger);
      if (protocolLogger === undefined) return;

      yield* protocolLogger({
        direction: "incoming",
        stage: "decoded",
        payload: {
          method: "error",
          params: {
            threadId: "native-thread",
            turnId: "native-turn",
            error: {
              code: "unauthorized",
              message: '{"message":"Unauthorized","Authorization":"Bearer secret-token"}',
            },
            history: "x".repeat(128 * 1_024),
          },
        },
      });

      const serialized = encodeUnknownJson(writes);
      assert.equal(writes.length, 1);
      assert.isBelow(serialized.length, 2_048);
      assert.notInclude(serialized, "secret-token");
      assert.include(serialized, "[REDACTED]");
      assert.nestedPropertyVal(writes[0], "event.payload.params.error.code", "unauthorized");
      assert.nestedPropertyVal(writes[0], "event.payload.params.turnId", "native-turn");
    }),
  );
});
