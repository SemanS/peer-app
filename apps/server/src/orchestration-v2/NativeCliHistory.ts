import {
  CodexSettings,
  ClaudeSettings,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as AcpRegistrySupport from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import { AcpRegistrySettings } from "@t3tools/provider-acp-registry/settings";
import * as AcpSessionHistory from "@t3tools/provider-acp/server/AcpSessionHistory";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { compileClaudeModelSelection } from "../claudeModelOptions.ts";
import { deriveProviderInstanceConfigMap } from "../provider/ProviderInstanceRegistryHydration.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveProviderInstanceTerminalEnvironment } from "../terminal/Manager.ts";
import { isCodexSessionHeld, waitOutCodexSessionHold } from "./CodexSessionHold.ts";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const CODEX_DRIVER = ProviderDriverKind.make("codex");

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const decodeRegistrySettings = Schema.decodeSync(AcpRegistrySettings);

/**
 * Without this a mere read runs the person's hooks and MCP servers, Peer's own SessionStart hook
 * among them, and takes more than twice as long.
 */
const CLAUDE_LOAD_META = { claudeCode: { options: { settingSources: [] } } };

/** They name a session of the parent process and feed a billing header; a read inherits neither. */
const CLAUDE_INHERITED_SESSION_VARIABLES = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

/** What `claude --effort` takes. A thread's other efforts have no CLI flag. */
const CLAUDE_CLI_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const CODEX_CLI_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export const NativeCliUnavailableReason = Schema.Literals([
  "unsupported_driver",
  "managed_instance",
  "pending_session",
  "instance_not_found",
  "invalid_instance_settings",
  "binary_not_found",
  "unsupported_platform",
]);
export type NativeCliUnavailableReason = typeof NativeCliUnavailableReason.Type;

export class NativeCliUnavailableError extends Schema.TaggedError<NativeCliUnavailableError>()(
  "NativeCliUnavailableError",
  { reason: NativeCliUnavailableReason, providerInstanceId: Schema.String },
) {
  override get message(): string {
    switch (this.reason) {
      case "unsupported_driver":
        return "This agent has no CLI that Peer can continue a thread in.";
      case "managed_instance":
        return "Managed Codex signs in through Peer, so it cannot run in a terminal.";
      case "pending_session":
        return "This thread has no agent session yet.";
      case "instance_not_found":
        return "This thread's provider instance no longer exists.";
      case "invalid_instance_settings":
        return "This thread's provider instance has invalid settings.";
      case "binary_not_found":
        return "The agent's CLI is not available on this environment's PATH.";
      case "unsupported_platform":
        return "Continuing in the agent's own CLI is not available on Windows yet. Fork into it instead.";
    }
  }
}

export class NativeCliAdapterError extends Schema.TaggedError<NativeCliAdapterError>()(
  "NativeCliAdapterError",
  { agentId: Schema.String, cause: AcpRegistrySupport.AcpRegistryError },
) {
  override get message(): string {
    return `Could not prepare the ACP adapter ${this.agentId}.`;
  }
}

export class NativeCliReadError extends Schema.TaggedError<NativeCliReadError>()(
  "NativeCliReadError",
  { agentId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the agent's session.";
  }
}

export class NativeCliSessionInUseError extends Schema.TaggedError<NativeCliSessionInUseError>()(
  "NativeCliSessionInUseError",
  { agentId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "This Codex session is in use by another Codex client (the Codex app, the CLI or an IDE extension). Close it there, then try again.";
  }
}

export class NativeCliSettingsError extends Schema.TaggedError<NativeCliSettingsError>()(
  "NativeCliSettingsError",
  { providerInstanceId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read this thread's provider settings.";
  }
}

export type NativeCliHistoryError =
  | NativeCliUnavailableError
  | NativeCliAdapterError
  | NativeCliReadError
  | NativeCliSessionInUseError
  | NativeCliSettingsError;

export interface NativeCliSessionRef {
  readonly driver: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly nativeId: string;
}

export interface NativeCliCommands {
  /**
   * Takes the session over; two writers on one session branch it. `exec` makes the terminal's
   * process the CLI itself, so the terminal ending is the one fact that says the CLI ended.
   */
  readonly continueCommand: string;
  readonly forkCommand: string;
}

export class NativeCliHistory extends Context.Service<
  NativeCliHistory,
  {
    /**
     * Refuses what cannot continue here and installs a missing adapter, which can take minutes. A
     * loan does this while the thread still has its process, so nothing sits between the two.
     */
    readonly prepareContinue: (
      input: NativeCliSessionRef & { readonly cwd: string },
    ) => Effect.Effect<void, NativeCliHistoryError>;
    /** Spawns the adapter and the CLI for a moment. Waits out a session Codex still holds. */
    readonly read: (
      input: NativeCliSessionRef & { readonly cwd: string },
    ) => Effect.Effect<AcpSessionHistory.AcpSessionHistory, NativeCliHistoryError>;
    readonly commands: (
      input: NativeCliSessionRef & { readonly modelSelection?: ModelSelection },
    ) => Effect.Effect<NativeCliCommands, NativeCliHistoryError>;
  }
>()("t3/orchestration-v2/NativeCliHistory") {}

const SHELL_SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;

const quoteForShell = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/** Keeps a leading `~/` outside the quotes so the terminal's shell still expands it. */
function quoteBinaryForShell(path: string): string {
  if (SHELL_SAFE_WORD.test(path)) return path;
  return path.startsWith("~/") ? `~/${quoteForShell(path.slice(2))}` : quoteForShell(path);
}

/** The thread's model, so the CLI does not fall back to the account's default. */
function modelFlags(driver: "claude" | "codex", selection: ModelSelection | undefined) {
  if (selection === undefined) return [];
  if (driver === "claude") {
    const compiled = compileClaudeModelSelection(selection);
    const effort = getModelSelectionStringOptionValue(selection, "effort");
    return [
      `--model ${quoteForShell(compiled.apiModelId)}`,
      // The catalog resolves an effort a model lacks to its default, which nobody chose.
      ...(effort !== undefined && effort === compiled.effort && CLAUDE_CLI_EFFORTS.has(effort)
        ? [`--effort ${quoteForShell(effort)}`]
        : []),
    ];
  }
  const effort = getModelSelectionStringOptionValue(selection, "reasoningEffort");
  return [
    `-m ${quoteForShell(selection.model)}`,
    ...(effort !== undefined && CODEX_CLI_EFFORTS.has(effort)
      ? [`-c ${quoteForShell(`model_reasoning_effort="${effort}"`)}`]
      : []),
  ];
}

function commandLines(
  driver: "claude" | "codex",
  binary: string,
  nativeId: string,
  selection: ModelSelection | undefined,
) {
  const executable = quoteBinaryForShell(binary);
  const id = quoteForShell(nativeId);
  const flags = modelFlags(driver, selection)
    .map((flag) => ` ${flag}`)
    .join("");
  return driver === "claude"
    ? {
        continueCommand: `exec ${executable} --resume ${id}${flags}`,
        forkCommand: `${executable} --resume ${id} --fork-session${flags}`,
      }
    : {
        continueCommand: `exec ${executable} resume${flags} ${id}`,
        forkCommand: `${executable} fork${flags} ${id}`,
      };
}

const isHeldByCodex = (error: AcpSessionHistory.AcpSessionHistoryError): boolean =>
  error._tag === "AcpSessionReadError" &&
  error.agentRefusal !== undefined &&
  isCodexSessionHeld(error.agentRefusal);

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;

  const resolveInstance = Effect.fn("NativeCliHistory.resolveInstance")(function* (
    input: NativeCliSessionRef,
  ) {
    const providerInstanceId = input.providerInstanceId;
    const unavailable = (reason: NativeCliUnavailableReason) =>
      new NativeCliUnavailableError({ reason, providerInstanceId });
    if (input.driver !== CLAUDE_DRIVER && input.driver !== CODEX_DRIVER) {
      return yield* unavailable("unsupported_driver");
    }
    if (input.nativeId.startsWith("pending:")) return yield* unavailable("pending_session");

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError((cause) => new NativeCliSettingsError({ providerInstanceId, cause })),
    );
    const instance = deriveProviderInstanceConfigMap(settings)[providerInstanceId];
    if (instance === undefined) return yield* unavailable("instance_not_found");

    const env = yield* resolveProviderInstanceTerminalEnvironment({
      serverSettings,
      path,
      rawProviderInstanceId: providerInstanceId,
      env: {},
    }).pipe(
      Effect.catchTags({
        TerminalProviderInstanceNotFoundError: () => unavailable("instance_not_found"),
        TerminalProviderEnvironmentError: (cause) =>
          new NativeCliSettingsError({ providerInstanceId, cause }),
      }),
    );

    if (input.driver === CLAUDE_DRIVER) {
      const config = decodeClaudeSettings(instance.config ?? {});
      if (Option.isNone(config)) return yield* unavailable("invalid_instance_settings");
      return {
        cli: "claude" as const,
        agentId: "claude-acp",
        binaryVariable: "CLAUDE_CODE_EXECUTABLE",
        binaryPath: config.value.binaryPath,
        env,
      };
    }
    const config = decodeCodexSettings(instance.config ?? {});
    if (Option.isNone(config)) return yield* unavailable("invalid_instance_settings");
    // A managed instance reaches its model through a token gateway that only lives in a Peer
    // session, and its CODEX_HOME holds no credentials a terminal could use.
    if (config.value.setupMode === "managed") return yield* unavailable("managed_instance");
    return {
      cli: "codex" as const,
      agentId: "codex-acp",
      binaryVariable: "CODEX_PATH",
      binaryPath: config.value.binaryPath,
      env,
    };
  });

  const resolveAdapter = Effect.fn("NativeCliHistory.resolveAdapter")(function* (
    instance: Effect.Success<ReturnType<typeof resolveInstance>>,
    input: NativeCliSessionRef & { readonly cwd: string },
  ) {
    const home = yield* HostProcess.HomeDirectory;
    const platform = yield* HostProcess.Platform;
    const resolveExecutable = yield* SpawnExecutableResolution;

    const environment: NodeJS.ProcessEnv = { ...process.env, ...instance.env };
    // The adapters hand this to their own spawn, which knows neither `~` nor this PATH.
    const binary = resolveExecutable(
      expandHomePath(instance.binaryPath, home),
      platform,
      environment,
    );
    if (binary === undefined) {
      return yield* new NativeCliUnavailableError({
        reason: "binary_not_found",
        providerInstanceId: input.providerInstanceId,
      });
    }
    environment[instance.binaryVariable] = binary;
    for (const name of CLAUDE_INHERITED_SESSION_VARIABLES) delete environment[name];

    // `resolve` installs a missing adapter, and unlike `prepare` it does not have to reach the
    // registry first, so a loan can still finish offline once the adapter is there.
    const resolved = yield* catalog
      .resolve(
        decodeRegistrySettings({ source: "registry", agentId: instance.agentId }),
        input.cwd,
        environment,
      )
      .pipe(
        Effect.mapError((cause) => new NativeCliAdapterError({ agentId: instance.agentId, cause })),
      );
    return { resolved, platform };
  });

  const prepareContinue: NativeCliHistory["Service"]["prepareContinue"] = Effect.fn(
    "NativeCliHistory.prepareContinue",
  )(function* (input) {
    const instance = yield* resolveInstance(input);
    // `exec` and the quoting of the continue command are POSIX, and a person there has no way to
    // tell Peer that the CLI ended.
    if ((yield* HostProcess.Platform) === "win32") {
      return yield* new NativeCliUnavailableError({
        reason: "unsupported_platform",
        providerInstanceId: input.providerInstanceId,
      });
    }
    yield* resolveAdapter(instance, input);
  });

  const read: NativeCliHistory["Service"]["read"] = Effect.fn("NativeCliHistory.read")(
    function* (input) {
      const instance = yield* resolveInstance(input);
      const { resolved, platform } = yield* resolveAdapter(instance, input);

      const readOnce = AcpSessionHistory.readAcpSessionHistory({
        // Inheriting on top would bring back the variables removed above.
        spawn: { ...resolved.spawn, extendEnv: false },
        cwd: input.cwd,
        sessionId: input.nativeId,
        platform,
        ...(instance.cli === "claude" ? { loadMeta: CLAUDE_LOAD_META } : {}),
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Crypto.Crypto, crypto),
      );
      const toReadError = (cause: AcpSessionHistory.AcpSessionHistoryError) =>
        new NativeCliReadError({ agentId: instance.agentId, cause });
      if (instance.cli === "claude") return yield* readOnce.pipe(Effect.mapError(toReadError));
      return yield* waitOutCodexSessionHold(readOnce, isHeldByCodex).pipe(
        Effect.mapError((cause) =>
          isHeldByCodex(cause)
            ? new NativeCliSessionInUseError({ agentId: instance.agentId, cause })
            : toReadError(cause),
        ),
      );
    },
  );

  const commands: NativeCliHistory["Service"]["commands"] = Effect.fn("NativeCliHistory.commands")(
    function* (input) {
      const instance = yield* resolveInstance(input);
      const selection =
        input.modelSelection?.instanceId === input.providerInstanceId
          ? input.modelSelection
          : undefined;
      return commandLines(instance.cli, instance.binaryPath, input.nativeId, selection);
    },
  );

  return NativeCliHistory.of({ prepareContinue, read, commands });
});

export const layer = Layer.effect(NativeCliHistory, make);
