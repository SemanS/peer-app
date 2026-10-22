import { PEER_LOCAL_WORKSPACE, type PeerOverlap } from "@t3tools/contracts";
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - Claude Code's and Codex's settings in their homes on this computer, as JSON files.
/**
 * PeerAdapters: Peer's hooks in the agents' harnesses, which coordination runs through.
 *
 * Claude Code and Codex run Peer's settings hooks against the same broker. Codex also needs
 * its person's trust in each configured home. An older Claude Mod installation becomes hooks;
 * its package stays idle because a running session or shell may still load it.
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
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../../config.ts";
import * as Settings from "../../../serverSettings.ts";
import * as ClaudeMod from "../../claudeMod/install.ts";
import { resolveClaudePeerHookHomes } from "../../claudeHookHomes.ts";
import { writePreservingLink } from "../adapters/files.ts";
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
  await writePreservingLink(path, `${JSON.stringify(settings, null, 2)}\n`);
}

export class PeerAdapters extends Context.Service<
  PeerAdapters,
  {
    /** Agent coordination on or off, its policy, and Peer's hooks in Claude Code and Codex. */
    readonly setCoordination: (
      input: PeerHubSetCoordinationInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
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
  const userHome = yield* HostProcess.HomeDirectory;
  const codexHome = NodePath.resolve(
    expandHomePath(
      process.env.CODEX_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".codex"),
      userHome,
    ),
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

  const configuredClaudeHomes = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(Effect.orDie);
    return yield* resolveClaudePeerHookHomes(
      current.providerInstances,
      NodePath.dirname(claudeSettingsPath),
    ).pipe(Effect.provideService(Path.Path, hostPath));
  });
  const claudeModDir = ClaudeMod.peerClaudeModPath(dir);
  const retireClaudeMod = () =>
    ClaudeMod.refreshClaudeMod({
      directory: claudeModDir,
      socketPath: socket,
      peerScript: peer,
      install: false,
    });
  const configureClaudeHooks = async (home: string, install: boolean) => {
    const settingsPath = NodePath.join(home, "settings.json");
    const claude = await readJsonSettings(settingsPath);
    if (claude === null) throw new Error(`${settingsPath} is not valid JSON; fix it first`);
    const next = withContextAccess(
      withPeerHooks(
        ClaudeMod.withClaudeMod(claude, claudeModDir, false),
        claudeHookGroups(scripts),
        dir,
        install,
      ),
      contexts,
      install,
    );
    if (settingsDiffer(next, claude)) await writeJsonSettings(settingsPath, next);
  };
  const initialClaudeHomes = yield* configuredClaudeHomes;
  yield* Effect.tryPromise(async () => {
    const initialSettings = await Promise.all(
      initialClaudeHomes.map((home) => readJsonSettings(NodePath.join(home, "settings.json"))),
    );
    const legacyModInstalled = initialSettings.some((claude) => {
      const env = claude?.env;
      return ClaudeMod.namesClaudeMod(
        typeof env === "object" && env !== null
          ? (env as Record<string, unknown>).CLAUDE_CODE_PLUGIN_DIRS
          : undefined,
        claudeModDir,
      );
    });
    // The Mod was injected into every SDK profile, even profiles without its settings entry.
    for (const [index, home] of initialClaudeHomes.entries()) {
      if (legacyModInstalled || hasPeerHooks(initialSettings[index] ?? {}, dir))
        await configureClaudeHooks(home, true);
    }
    await retireClaudeMod();
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `Claude Code's Peer hooks could not be updated: ${messageOf(failure.cause)}`,
      ),
    ),
  );

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
      const claudeHomes = yield* configuredClaudeHomes;
      const claudeSettings = yield* Effect.promise(() =>
        Promise.all(
          claudeHomes.map((home) => readJsonSettings(NodePath.join(home, "settings.json"))),
        ),
      );
      const claudeHooksInstalled = claudeSettings.every((claude) =>
        hasPeerHooks(claude ?? {}, dir),
      );
      const local = yield* coordination.localView.pipe(
        Effect.map((view) => ({ view, error: null as string | null })),
        Effect.catch((failure) => Effect.succeed({ view: null, error: failure.detail })),
      );
      const snapshot = coordination.broker()?.snapshot() ?? {
        sessions: [],
        overlaps: (local.view?.overlaps ?? []).map((overlap): PeerOverlap => ({
          ...overlap,
          workspace: PEER_LOCAL_WORKSPACE,
        })),
        policies: {},
        findings: (local.view?.findings ?? []).map((finding) => ({
          ...finding,
          workspace: PEER_LOCAL_WORKSPACE,
        })),
        contexts: (local.view?.contexts ?? []).map((context) => ({
          ...context,
          workspace: PEER_LOCAL_WORKSPACE,
        })),
        advice: [],
      };
      return {
        local: {
          available: local.view !== null,
          workspace: PEER_LOCAL_WORKSPACE,
          ...(local.error === null ? {} : { error: local.error }),
        },
        enabled: s.persisted.coordination?.enabled ?? true,
        policy: s.persisted.coordination?.policy ?? "coordinate",
        claudeHooks: claudeHooksInstalled,
        claudeHooksPresent: claudeSettings.some((claude) => hasPeerHooks(claude ?? {}, dir)),
        claudeMod: false,
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
          ...(overlap.decision === undefined ? {} : { decision: overlap.decision }),
        })),
        policies: snapshot.policies,
      } satisfies PeerHubStatus["coordination"];
    });

  const setCoordination: PeerAdapters["Service"]["setCoordination"] = Effect.fn(
    "PeerAdapters.setCoordination",
  )(function* (input) {
    const claudeHooks = input.claudeHooks ?? input.claudeMod;
    const current = (yield* state.read).persisted.coordination ?? {
      enabled: true,
      policy: "coordinate" as const,
    };
    // Hooks run Peer's scripts, which coordination writes: installing them turns it on.
    const next = {
      enabled:
        claudeHooks === true || input.codexHooks === true
          ? true
          : (input.enabled ?? current.enabled),
      policy: input.policy ?? current.policy,
    };
    yield* state.updatePersisted((p) => ({ ...p, coordination: next }));
    if (next.enabled) yield* coordination.start;
    else yield* coordination.stop;
    if (claudeHooks !== undefined) {
      const homes = yield* configuredClaudeHomes;
      yield* Effect.tryPromise({
        try: async () => {
          for (const home of homes) await configureClaudeHooks(home, claudeHooks);
          await retireClaudeMod();
        },
        catch: (failure) =>
          hubError(`Claude Code's settings could not change: ${messageOf(failure)}`),
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
  });
});

export const layer = Layer.effect(PeerAdapters, make);
