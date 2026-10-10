// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - Claude Code's and Codex's settings in their homes on this computer, as JSON files.
/**
 * PeerAdapters: Peer's hooks in the agents' harnesses, which coordination runs through.
 *
 * Claude Code runs Peer's settings hooks, or Peer Mod, a plugin directory it loads; Codex runs
 * Peer's hooks from each configured home once its person trusts them. Turning coordination or one
 * of them on or off installs or removes them, and when Peer starts it updates the hooks an older
 * Peer installed. Peer Mod is active only where Peer installed it: Claude Code may still load its
 * directory through a CLAUDE_CODE_PLUGIN_DIRS set outside its settings, so Peer keeps that copy
 * current and idle, and Peer's settings hooks alone coordinate those sessions.
 *
 * @module peerHub/core/coordination/PeerAdapters
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  PeerHubError,
  type PeerHubSetCoordinationInput,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../../config.ts";
import { expandHomePath } from "../../../pathExpansion.ts";
import * as Settings from "../../../serverSettings.ts";
import * as ClaudeMod from "../../claudeMod/install.ts";
import * as ClaudeModRuntime from "../../claudeMod/runtime.ts";
import { readClaudeModVersion } from "../../claudeMod/probe.ts";
import { prepareCodexPeerHookHomes, resolveCodexPeerHookHomes } from "../../codexHookHomes.ts";
import {
  installCodexPeerHooks,
  readCodexPeerHookReview,
  trustConfiguredCodexPeerHooks,
} from "../../codexHooks.ts";
import {
  claudeHookGroups,
  hasPeerHooks,
  settingsDiffer,
  withContextAccess,
  withPeerHooks,
} from "../adapters/scripts.ts";
import { commandPath } from "../local.ts";
import * as PeerState from "../state/PeerState.ts";
import type { RuntimeState } from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerCoordination from "./PeerCoordination.ts";

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

/** A JSON settings file: {} when it does not exist, null when it is not a JSON object. */
async function readJsonSettings(path: string): Promise<Record<string, unknown> | null> {
  const text = await NodeFSP.readFile(path, "utf8").catch(() => null);
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Writes a JSON settings file in one step, keeping the original once as `<file>.peer-backup`. */
async function writeJsonSettings(path: string, settings: Record<string, unknown>): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  const backup = `${path}.peer-backup`;
  const existing = await NodeFSP.stat(path).then(
    () => true,
    () => false,
  );
  const backedUp = await NodeFSP.stat(backup).then(
    () => true,
    () => false,
  );
  if (existing && !backedUp) await NodeFSP.copyFile(path, backup);
  const temporary = `${path}.peer-${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  await NodeFSP.rename(temporary, path);
}

export class PeerAdapters extends Context.Service<
  PeerAdapters,
  {
    /** Agent coordination on or off, its policy, and Peer's hooks in Claude Code and Codex. */
    readonly setCoordination: (
      input: PeerHubSetCoordinationInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Peer Mod's directory while Claude Code loads it, for the agents Peer starts itself. */
    readonly claudeMod: () => string | undefined;
  }
>()("t3/peerHub/core/coordination/PeerAdapters") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const hostPath = yield* Path.Path;
  const hostFileSystem = yield* FileSystem.FileSystem;
  const settings = yield* Settings.ServerSettingsService;
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const coordination = yield* PeerCoordination.PeerCoordination;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const { dir, socket, log, contexts, peer, scripts } = coordination.paths;

  const claudeSettingsPath = NodePath.join(
    process.env.CLAUDE_CONFIG_DIR?.trim() || NodePath.join(NodeOS.homedir(), ".claude"),
    "settings.json",
  );
  /** Native CLI home; configured profiles may use separate direct or shadow homes. */
  const codexHome = NodePath.resolve(
    expandHomePath(process.env.CODEX_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".codex")),
  );
  const configuredCodexHomes = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(Effect.orDie);
    return yield* resolveCodexPeerHookHomes(
      config.stateDir,
      current.providerInstances,
      codexHome,
    ).pipe(Effect.provideService(Path.Path, hostPath));
  });
  const prepareConfiguredCodexHomes = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(Effect.orDie);
    return yield* prepareCodexPeerHookHomes(
      config.stateDir,
      current.providerInstances,
      codexHome,
    ).pipe(
      Effect.provideService(Path.Path, hostPath),
      Effect.provideService(FileSystem.FileSystem, hostFileSystem),
      Effect.mapError((failure) => hubError(failure.message)),
    );
  });

  const claudeSettings = yield* Effect.promise(() => readJsonSettings(claudeSettingsPath));
  let claudeHooksInstalled = hasPeerHooks(claudeSettings ?? {}, dir);
  const claudeModDir = ClaudeMod.peerClaudeModPath(dir);
  const claudeEnv = claudeSettings?.env;
  let claudeModInstalled = ClaudeMod.namesClaudeMod(
    typeof claudeEnv === "object" && claudeEnv !== null
      ? (claudeEnv as Record<string, unknown>).CLAUDE_CODE_PLUGIN_DIRS
      : undefined,
    claudeModDir,
  );
  // Installed or not, a Mod directory that is there is kept current, idle unless installed:
  // Claude Code may load it through an environment outside its settings.
  yield* Effect.tryPromise(() =>
    ClaudeMod.refreshClaudeMod({
      directory: claudeModDir,
      socketPath: socket,
      peerScript: peer,
      install: claudeModInstalled,
    }),
  ).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`Peer Mod could not be updated: ${messageOf(failure.cause)}`).pipe(
        Effect.andThen(
          Effect.sync(() => {
            claudeModInstalled = false;
          }),
        ),
      ),
    ),
  );
  ClaudeModRuntime.setClaudeModDirectory(claudeModInstalled ? claudeModDir : undefined);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => ClaudeModRuntime.setClaudeModDirectory(undefined)),
  );
  // Hooks an older Peer installed get this Peer's: new events, and agents let into their contexts.
  const currentHooks =
    claudeSettings === null || (!claudeHooksInstalled && !claudeModInstalled)
      ? null
      : withContextAccess(
          withPeerHooks(claudeSettings, claudeHookGroups(scripts), dir, !claudeModInstalled),
          contexts,
          true,
        );
  if (
    currentHooks !== null &&
    claudeSettings !== null &&
    settingsDiffer(currentHooks, claudeSettings)
  ) {
    yield* Effect.promise(() =>
      writeJsonSettings(claudeSettingsPath, currentHooks).catch(() => undefined),
    );
  }
  if (claudeModInstalled) claudeHooksInstalled = false;

  const codexHookReviews = Effect.gen(function* () {
    const homes = yield* configuredCodexHomes;
    return yield* Effect.promise(() =>
      Promise.all(
        homes.map(async (home) => {
          try {
            return await readCodexPeerHookReview(home, scripts);
          } catch (failure) {
            return {
              home,
              hooksPath: NodePath.join(home, "hooks.json"),
              present: false,
              installed: false,
              trusted: false,
              reviewId: "",
              hooks: [],
              error: messageOf(failure),
            };
          }
        }),
      ),
    );
  });

  yield* plugins
    .configureAdapterFiles(
      codexHookReviews.pipe(
        Effect.map((homes) => ({
          codexHomes: homes.filter((home) => home.installed).map((home) => home.home),
          peerScript: peer,
          install: true,
        })),
      ),
    )
    .pipe(Effect.catch((failure) => Effect.logWarning(failure.detail)));

  /** Coordination as people see it: its settings, the hooks here and what the broker heard. */
  const coordinationStatus = (s: RuntimeState): Effect.Effect<PeerHubStatus["coordination"]> =>
    Effect.gen(function* () {
      const codexHookHomes = yield* codexHookReviews;
      const snapshot = coordination.broker()?.snapshot() ?? {
        sessions: [],
        overlaps: [],
        findings: [],
        contexts: [],
        advice: [],
      };
      return {
        enabled: s.persisted.coordination?.enabled ?? false,
        policy: s.persisted.coordination?.policy ?? "coordinate",
        claudeHooks: claudeHooksInstalled,
        claudeMod: claudeModInstalled,
        codexHooks: codexHookHomes.every((home) => home.installed),
        codexHooksTrusted: codexHookHomes.every((home) => home.trusted),
        codexHookHomes,
        logPath: log,
        sessions: snapshot.sessions.map((session) => ({
          id: session.id,
          ...(session.runtimeGeneration === undefined
            ? {}
            : { runtimeGeneration: session.runtimeGeneration }),
          workspace: session.workspace,
          project: session.project,
          email: session.email,
          environment: session.environment,
          label: session.label,
          ...(session.agent === undefined ? {} : { agent: session.agent }),
          ...(session.task === undefined ? {} : { task: session.task }),
          ...(session.branch === undefined ? {} : { branch: session.branch }),
          status: session.status,
          files: session.files,
          claims: session.claims,
          local: session.local,
          ...(session.activeAt === undefined ? {} : { activeAt: session.activeAt }),
        })),
        findings: snapshot.findings.map((finding) => ({
          id: finding.id,
          workspace: finding.workspace,
          project: finding.project,
          ...(finding.task === undefined ? {} : { task: finding.task }),
          text: finding.text,
          email: finding.email,
          at: finding.at,
          ...(finding.scope === undefined ? {} : { scope: finding.scope }),
        })),
        contexts: snapshot.contexts.map((context) => ({
          workspace: context.workspace,
          project: context.project,
          scope: context.scope,
          version: context.version,
          ...(context.keeper === undefined ? {} : { keeper: context.keeper }),
          updatedAt: context.updatedAt,
          ...(context.updatedBy === undefined ? {} : { updatedBy: context.updatedBy }),
          ...(context.updatedSession === undefined
            ? {}
            : { updatedSession: context.updatedSession }),
          ...(context.restoredFrom === undefined ? {} : { restoredFrom: context.restoredFrom }),
          ...(context.gist === undefined ? {} : { gist: context.gist }),
          bytes: context.bytes ?? 0,
        })),
        advice: snapshot.advice.map((told) => ({
          workspace: told.workspace,
          project: told.project,
          session: told.session,
          about: told.about,
          scope: told.scope,
          name: told.name,
          how: told.how,
          why: told.why,
          ...(told.entryKind === undefined ? {} : { entryKind: told.entryKind }),
          ...(told.path === undefined ? {} : { path: told.path }),
          at: told.at,
        })),
        // The knowledge plugin's slice, which core places here while it is active.
        candidates: [],
        overlaps: snapshot.overlaps.map((overlap) => ({
          id: overlap.id,
          policy: overlap.policy,
          workspace: overlap.workspace,
          project: overlap.project,
          sessions: overlap.sessions,
          files: overlap.files,
          state: overlap.state,
          ...(overlap.resolution === undefined ? {} : { resolution: overlap.resolution }),
          notes: overlap.notes.map((note) => ({
            id: note.id,
            ...(note.session === undefined ? {} : { session: note.session }),
            email: note.email,
            text: note.text,
            at: note.at,
          })),
          updatedAt: overlap.updatedAt,
          ...(overlap.closer === undefined ? {} : { closer: overlap.closer }),
          ...(overlap.askedAt === undefined ? {} : { askedAt: overlap.askedAt }),
        })),
      } satisfies PeerHubStatus["coordination"];
    });

  const setCoordination: PeerAdapters["Service"]["setCoordination"] = Effect.fn(
    "PeerAdapters.setCoordination",
  )(function* (input) {
    if (input.claudeMod === true) {
      const cli = commandPath("claude");
      if (cli === null)
        return yield* hubError(
          "Install Claude Code 2.1.291 or newer on this environment before enabling the Peer Mod.",
        );
      const version = yield* Effect.tryPromise(() => readClaudeModVersion(cli)).pipe(
        Effect.mapError((failure) => hubError(messageOf(failure.cause))),
      );
      if (!ClaudeMod.supportsClaudeMod(version))
        return yield* hubError(
          "Update Claude Code to 2.1.291 or newer before enabling the Peer Mod.",
        );
    }
    const current = (yield* state.read).persisted.coordination ?? {
      enabled: false,
      policy: "coordinate" as const,
    };
    // Hooks run Peer's scripts, which coordination writes: installing them turns it on.
    const next = {
      enabled:
        input.claudeHooks === true || input.codexHooks === true || input.claudeMod === true
          ? true
          : (input.enabled ?? current.enabled),
      policy: input.policy ?? current.policy,
    };
    yield* state.updatePersisted((p) => ({ ...p, coordination: next }));
    if (next.enabled) yield* coordination.start;
    else yield* coordination.stop;
    if (input.claudeHooks !== undefined) {
      const install = input.claudeHooks;
      yield* Effect.tryPromise({
        try: async () => {
          const claude = await readJsonSettings(claudeSettingsPath);
          if (claude === null) {
            throw new Error(`${claudeSettingsPath} is not valid JSON; fix it first`);
          }
          await writeJsonSettings(
            claudeSettingsPath,
            withContextAccess(
              withPeerHooks(
                install ? ClaudeMod.withClaudeMod(claude, claudeModDir, false) : claude,
                claudeHookGroups(scripts),
                dir,
                install,
              ),
              contexts,
              install,
            ),
          );
          claudeHooksInstalled = install;
          if (install) {
            claudeModInstalled = false;
            ClaudeModRuntime.setClaudeModDirectory(undefined);
            // A session that still loads the Mod (from an environment outside the settings) reloads
            // it idle and leaves coordination to the hooks.
            await ClaudeMod.refreshClaudeMod({
              directory: claudeModDir,
              socketPath: socket,
              peerScript: peer,
              install: false,
            });
          }
        },
        catch: (failure) =>
          hubError(`Claude Code's settings could not change: ${messageOf(failure)}`),
      });
    }
    const modChange =
      input.claudeMod ?? (input.enabled === false && claudeModInstalled ? false : undefined);
    if (modChange !== undefined) {
      const install = modChange;
      yield* Effect.tryPromise({
        try: async () => {
          const claude = await readJsonSettings(claudeSettingsPath);
          if (claude === null)
            throw new Error(`${claudeSettingsPath} is not valid JSON; fix it first`);
          if (install)
            await ClaudeMod.writeClaudeMod({
              directory: claudeModDir,
              socketPath: socket,
              peerScript: peer,
            });
          await writeJsonSettings(
            claudeSettingsPath,
            withContextAccess(
              ClaudeMod.withClaudeMod(
                install ? withPeerHooks(claude, claudeHookGroups(scripts), dir, false) : claude,
                claudeModDir,
                install,
              ),
              contexts,
              install || claudeHooksInstalled,
            ),
          );
          claudeModInstalled = install;
          if (install) claudeHooksInstalled = false;
          ClaudeModRuntime.setClaudeModDirectory(install ? claudeModDir : undefined);
          if (!install) await ClaudeMod.removeClaudeMod(claudeModDir);
        },
        catch: (failure) =>
          hubError(`Claude Code's Peer Mod could not change: ${messageOf(failure)}`),
      });
    }
    if (input.codexHooks !== undefined) {
      const homes = yield* input.codexHooks ? prepareConfiguredCodexHomes : configuredCodexHomes;
      yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            homes.map((home) => installCodexPeerHooks(home, scripts, input.codexHooks === true)),
          ),
        catch: (failure) => hubError(`Codex's hooks could not change: ${messageOf(failure)}`),
      });
      yield* plugins.applyAdapterFiles({
        codexHomes: homes,
        peerScript: peer,
        install: input.codexHooks,
      });
    }
    if (input.codexHookApproval !== undefined) {
      const approval = input.codexHookApproval;
      const homes = yield* configuredCodexHomes;
      yield* Effect.tryPromise({
        try: () => trustConfiguredCodexPeerHooks(homes, approval, scripts),
        catch: (failure) =>
          hubError(`Codex's Peer hooks could not be trusted: ${messageOf(failure)}`),
      });
    }
    return yield* status.publish;
  });

  // The status's coordination is this service's to say, from before anything publishes.
  yield* status.coordinationFrom(coordinationStatus);

  return PeerAdapters.of({
    setCoordination,
    claudeMod: () => (claudeModInstalled ? claudeModDir : undefined),
  });
});

export const layer = Layer.effect(PeerAdapters, make);
