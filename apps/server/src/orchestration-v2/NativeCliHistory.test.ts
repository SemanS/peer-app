import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as AcpRegistrySupport from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as FileSystem from "effect/FileSystem";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerSettings from "../serverSettings.ts";
import { resolveProviderInstanceTerminalEnvironment } from "../terminal/Manager.ts";
import * as NativeCliHistory from "./NativeCliHistory.ts";

const claudeAgent = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");

/** Replays the environment it was given as the text of one prompt. */
const FAKE_AGENT = `
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
  rl.on("line", (line) => {
    const { id, method, params } = JSON.parse(line);
    if (method === "initialize") {
      send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
    } else if (method === "session/load") {
      const held = params.sessionId.match(/^held-(\\d+)-(.+)$/);
      if (held !== null) {
        const fs = require("node:fs");
        const attempts = Number(fs.existsSync(held[2]) ? fs.readFileSync(held[2], "utf8") : 0) + 1;
        fs.writeFileSync(held[2], String(attempts));
        if (attempts <= Number(held[1])) {
          send({
            id,
            error: {
              code: -32600,
              message: "This Codex session is in use by another Codex client.",
              data: { reason: "thread_active_writer" },
            },
          });
          return;
        }
      }
      if (params.sessionId === "missing") {
        send({ id, error: { code: -32002, message: "not found" } });
        return;
      }
      const seen = {
        meta: params._meta ?? null,
        cwd: params.cwd,
        executable: process.env.CLAUDE_CODE_EXECUTABLE ?? process.env.CODEX_PATH ?? null,
        home: process.env.CLAUDE_CONFIG_DIR ?? process.env.CODEX_HOME ?? null,
        entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
      };
      send({
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            messageId: "u1",
            content: { type: "text", text: JSON.stringify(seen) },
          },
        },
      });
      send({ id, result: {} });
    } else if (method === "session/close") {
      send({ id, result: {} });
    }
  });
`;

const resolvedAgents: Array<string> = [];

const layerCatalog = Layer.succeed(
  AcpRegistrySupport.AcpRegistryCatalog,
  AcpRegistrySupport.AcpRegistryCatalog.of({
    search: () => Effect.die("not used"),
    prepare: () => Effect.die("not used"),
    inspect: () => Effect.die("not used"),
    uninstallManagedBinary: () => Effect.die("not used"),
    resolve: (settings, cwd, environment) => {
      resolvedAgents.push(settings.agentId);
      return Effect.succeed({
        distribution: "npx" as const,
        spawn: {
          command: process.execPath,
          args: ["-e", FAKE_AGENT],
          cwd,
          ...(environment === undefined ? {} : { env: environment }),
        },
      });
    },
  }),
);

const layerTest = NativeCliHistory.layer.pipe(
  Layer.provideMerge(
    ServerSettings.layerTest({
      providerInstances: {
        [ProviderInstanceId.make("claude_work")]: {
          driver: claudeAgent,
          config: { binaryPath: process.execPath, homePath: "/tmp/claude's home" },
        },
        [ProviderInstanceId.make("claude_tilde")]: {
          driver: claudeAgent,
          config: { binaryPath: "~/my tools/claude" },
        },
        [ProviderInstanceId.make("codex_shadow")]: {
          driver: codex,
          config: {
            binaryPath: process.execPath,
            homePath: "/tmp/codex-shared",
            shadowHomePath: "/tmp/codex-shadow",
          },
        },
        [ProviderInstanceId.make("codex_managed")]: {
          driver: codex,
          config: { setupMode: "managed" },
        },
      },
    }),
  ),
  Layer.provideMerge(layerCatalog),
  Layer.provideMerge(NodeServices.layer),
);

const ref = (driver: ProviderDriverKind, instance: string, nativeId = "b937'217f") => ({
  driver,
  providerInstanceId: ProviderInstanceId.make(instance),
  nativeId,
});

it.layer(layerTest)("NativeCliHistory", (it) => {
  describe("commands", () => {
    it.effect("quotes the id and uses the instance's home for Claude", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;

        const commands = yield* history.commands(ref(claudeAgent, "claude_tilde", "abc"));

        expect(commands.continueCommand).toBe("exec ~/'my tools/claude' --resume 'abc'");
        expect(commands.forkCommand).toBe("~/'my tools/claude' --resume 'abc' --fork-session");
      }),
    );

    it.effect("escapes a quote in a session id", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;

        const commands = yield* history.commands(ref(claudeAgent, "claude_work"));

        expect(commands.continueCommand).toContain(`--resume 'b937'\\''217f'`);
      }),
    );

    it.effect("gives Codex its resume and fork, with the effective home", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;

        const commands = yield* history.commands(ref(codex, "codex_shadow", "t1"));

        expect(commands.continueCommand.startsWith("exec ")).toBe(true);
        expect(commands.continueCommand.endsWith(" resume 't1'")).toBe(true);
        expect(commands.forkCommand.startsWith("exec ")).toBe(false);
        expect(commands.forkCommand.endsWith(" fork 't1'")).toBe(true);
      }),
    );

    it.effect("leaves the env to the terminal, which resolves the instance's own homes", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        const terminalEnv = (rawProviderInstanceId: string) =>
          Effect.gen(function* () {
            return yield* resolveProviderInstanceTerminalEnvironment({
              serverSettings: yield* ServerSettings.ServerSettingsService,
              path: yield* Path.Path,
              rawProviderInstanceId,
              env: undefined,
            });
          });

        expect(yield* history.commands(ref(codex, "codex_shadow", "t1"))).not.toHaveProperty("env");
        expect((yield* terminalEnv("codex_shadow")).CODEX_HOME).toBe("/tmp/codex-shadow");
        expect((yield* terminalEnv("claude_work")).CLAUDE_CONFIG_DIR).toBe("/tmp/claude's home");
      }),
    );

    it.effect("runs Claude on the thread's model and effort", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        const selection = (effort: string | undefined) => ({
          instanceId: ProviderInstanceId.make("claude_tilde"),
          model: "claude-haiku-5-5",
          ...(effort === undefined ? {} : { options: [{ id: "effort", value: effort }] }),
        });
        const command = (effort: string | undefined) =>
          history.commands({
            ...ref(claudeAgent, "claude_tilde", "abc"),
            modelSelection: selection(effort),
          });

        const chosen = yield* command("low");
        expect(chosen.continueCommand).toBe(
          "exec ~/'my tools/claude' --resume 'abc' --model 'claude-haiku-5-5' --effort 'low'",
        );
        expect(chosen.forkCommand).toBe(
          "~/'my tools/claude' --resume 'abc' --fork-session --model 'claude-haiku-5-5' --effort 'low'",
        );
        expect((yield* command(undefined)).continueCommand).not.toContain("--effort");
        expect((yield* command("ultrathink")).continueCommand).not.toContain("--effort");
      }),
    );

    it.effect("runs Codex on the thread's model and effort, as one shell word", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        const selection = (effort: string | undefined) => ({
          instanceId: ProviderInstanceId.make("codex_shadow"),
          model: "gpt-terra",
          ...(effort === undefined ? {} : { options: [{ id: "reasoningEffort", value: effort }] }),
        });
        const command = (effort: string | undefined) =>
          history.commands({
            ...ref(codex, "codex_shadow", "t1"),
            modelSelection: selection(effort),
          });

        const chosen = yield* command("low");
        expect(chosen.continueCommand).toContain(
          ` resume -m 'gpt-terra' -c 'model_reasoning_effort="low"' 't1'`,
        );
        expect(chosen.forkCommand).toContain(
          ` fork -m 'gpt-terra' -c 'model_reasoning_effort="low"' 't1'`,
        );
        expect((yield* command(undefined)).continueCommand).not.toContain("-c ");
        expect((yield* command("extreme")).continueCommand).not.toContain("-c ");
      }),
    );

    it.effect("leaves the model out when the thread already chose another instance", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        const commands = yield* history.commands({
          ...ref(codex, "codex_shadow", "t1"),
          modelSelection: { instanceId: ProviderInstanceId.make("other"), model: "elsewhere" },
        });
        expect(commands.continueCommand).not.toContain("-m ");
      }),
    );
  });

  describe("refusals", () => {
    const reasonOf = (input: NativeCliHistory.NativeCliSessionRef) =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        const result = yield* history.commands(input).pipe(Effect.result);
        return Result.isFailure(result) && result.failure._tag === "NativeCliUnavailableError"
          ? result.failure.reason
          : undefined;
      });

    it.effect("refuses what has no CLI to continue in", () =>
      Effect.gen(function* () {
        expect(yield* reasonOf(ref(ProviderDriverKind.make("cursor"), "cursor"))).toBe(
          "unsupported_driver",
        );
        expect(yield* reasonOf(ref(claudeAgent, "claude_work", "pending:1"))).toBe(
          "pending_session",
        );
        expect(yield* reasonOf(ref(claudeAgent, "gone"))).toBe("instance_not_found");
        expect(yield* reasonOf(ref(codex, "codex_managed"))).toBe("managed_instance");
      }),
    );
  });

  describe("prepareContinue", () => {
    const prepare = (platform: NodeJS.Platform, agent: string) =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        return yield* history
          .prepareContinue({
            ...ref(codex, "codex_shadow"),
            cwd: process.cwd(),
            nativeId: agent,
          })
          .pipe(Effect.provideService(HostProcess.Platform, platform), Effect.result);
      });

    it.effect("installs the adapter on a POSIX host", () =>
      Effect.gen(function* () {
        const before = resolvedAgents.length;
        const result = yield* prepare("darwin", "t1");
        expect(Result.isSuccess(result)).toBe(true);
        expect(resolvedAgents.slice(before)).toEqual(["codex-acp"]);
      }),
    );

    it.effect("refuses on Windows before it installs anything, and the fork stays", () =>
      Effect.gen(function* () {
        const before = resolvedAgents.length;
        const result = yield* prepare("win32", "t1");
        expect(Result.isFailure(result) && result.failure._tag).toBe("NativeCliUnavailableError");
        expect(Result.isFailure(result) && result.failure.message).toContain("Windows");
        expect(resolvedAgents.length).toBe(before);
      }),
    );
  });

  describe("read", () => {
    it.effect("loads Claude through its adapter, without the person's hooks", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        const previous = process.env.CLAUDE_CODE_ENTRYPOINT;
        process.env.CLAUDE_CODE_ENTRYPOINT = "cli";

        const { turns } = yield* history
          .read({ ...ref(claudeAgent, "claude_work"), cwd: process.cwd() })
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (previous === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
                else process.env.CLAUDE_CODE_ENTRYPOINT = previous;
              }),
            ),
          );

        expect(resolvedAgents.at(-1)).toBe("claude-acp");
        expect(JSON.parse(turns[0]?.text ?? "")).toEqual({
          meta: { claudeCode: { options: { settingSources: [] } } },
          cwd: process.cwd(),
          executable: process.execPath,
          home: "/tmp/claude's home",
          entrypoint: null,
        });
      }),
    );

    it.effect("loads Codex with no Claude metadata, from its effective home", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;

        const { turns } = yield* history.read({
          ...ref(codex, "codex_shadow"),
          cwd: process.cwd(),
        });

        expect(resolvedAgents.at(-1)).toBe("codex-acp");
        expect(JSON.parse(turns[0]?.text ?? "")).toMatchObject({
          meta: null,
          executable: process.execPath,
          home: "/tmp/codex-shadow",
        });
      }),
    );

    // The hold's own sleeps pass at once. The child process and its read timeout run on real time,
    // which the test clock would never advance.
    const skippingHoldSleeps = Effect.gen(function* () {
      const clock = yield* Effect.clockWith(Effect.succeed);
      let elapsed = 0;
      return Clock.Clock.of({
        ...clock,
        currentTimeMillisUnsafe: () => elapsed,
        currentTimeMillis: Effect.sync(() => elapsed),
        sleep: (duration) =>
          Duration.equals(duration, Duration.seconds(5))
            ? Effect.sync(() => {
                elapsed += 5_000;
              })
            : Effect.callback<void>((resume) => {
                // @effect-diagnostics-next-line globalTimersInEffect:off - The stub replaces the test clock's sleep.
                const timer = setTimeout(() => resume(Effect.void), Duration.toMillis(duration));
                return Effect.sync(() => clearTimeout(timer));
              }),
      });
    });
    const readHeld = (nativeId: string) =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        return yield* history
          .read({ ...ref(codex, "codex_shadow", nativeId), cwd: process.cwd() })
          .pipe(Effect.provideService(Clock.Clock, yield* skippingHoldSleeps), Effect.result);
      });
    const attemptsFile = Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      return yield* fileSystem.makeTempFileScoped();
    });

    it.effect("waits while Codex refuses, then reads", () =>
      Effect.gen(function* () {
        const file = yield* attemptsFile;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.remove(file);

        const result = yield* readHeld(`held-2-${file}`);

        expect(Result.isSuccess(result)).toBe(true);
        expect(yield* fileSystem.readFileString(file)).toBe("3");
      }).pipe(Effect.scoped),
    );

    it.effect("names the other client when Codex still refuses at the bound", () =>
      Effect.gen(function* () {
        const file = yield* attemptsFile;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.remove(file);

        const result = yield* readHeld(`held-99-${file}`);

        expect(Result.isFailure(result) && result.failure._tag).toBe("NativeCliSessionInUseError");
        expect(Result.isFailure(result) && result.failure.message).toContain(
          "in use by another Codex client",
        );
        expect(yield* fileSystem.readFileString(file)).toBe("16");
      }).pipe(Effect.scoped),
    );

    it.effect("fails any other read at once", () =>
      Effect.gen(function* () {
        const result = yield* readHeld("missing");
        expect(Result.isFailure(result) && result.failure._tag).toBe("NativeCliReadError");
      }),
    );

    it.effect("leaves Claude out of the wait", () =>
      Effect.gen(function* () {
        const history = yield* NativeCliHistory.NativeCliHistory;
        const result = yield* history
          .read({ ...ref(claudeAgent, "claude_work", "missing"), cwd: process.cwd() })
          .pipe(Effect.provideService(Clock.Clock, yield* skippingHoldSleeps), Effect.result);
        expect(Result.isFailure(result) && result.failure._tag).toBe("NativeCliReadError");
      }),
    );
  });
});
