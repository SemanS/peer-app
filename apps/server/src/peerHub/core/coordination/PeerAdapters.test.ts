// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - Claude Code's settings and Peer Mod's files in a temporary home.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as ClaudeMod from "../../claudeMod/install.ts";
import * as Settings from "../../../serverSettings.ts";
import { claudeHookGroups, hasPeerHooks, withPeerHooks } from "../adapters/scripts.ts";
import type { CoordinationBroker } from "../broker/Broker.ts";
import { brokerFixture } from "../broker/testkit.ts";
import { coreLayer, emptyT3, seedState } from "../testkit.ts";
import * as PeerAdapters from "./PeerAdapters.ts";
import * as PeerCoordination from "./PeerCoordination.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Peer's coordination files under `baseDir`, as PeerCoordination lays them out. */
const pathsOf = (baseDir: string): PeerCoordination.CoordinationPaths => {
  const dir = NodePath.join(baseDir, "coord");
  return {
    dir,
    socket: NodePath.join(baseDir, "coord.sock"),
    log: NodePath.join(baseDir, "coordination.jsonl"),
    contexts: NodePath.join(dir, "contexts"),
    peer: NodePath.join(dir, "bin", "peer"),
    scripts: { hook: NodePath.join(dir, "hook"), wait: NodePath.join(dir, "wait") },
  };
};

const hooksOnly = (paths: PeerCoordination.CoordinationPaths) =>
  withPeerHooks({ env: {} }, claudeHookGroups(paths.scripts), paths.dir, true);

const modInstalled = (paths: PeerCoordination.CoordinationPaths) =>
  ClaudeMod.withClaudeMod(
    { model: "opus", env: { CLAUDE_CODE_PLUGIN_DIRS: "/other/plugin", PRIVATE_SETTING: "kept" } },
    ClaudeMod.peerClaudeModPath(paths.dir),
    true,
  );

/** What an older Peer left in its Mod directory. */
const olderMod = async (paths: PeerCoordination.CoordinationPaths) => {
  const directory = ClaudeMod.peerClaudeModPath(paths.dir);
  await ClaudeMod.writeClaudeMod({ directory, socketPath: paths.socket, peerScript: paths.peer });
  await NodeFSP.writeFile(
    NodePath.join(directory, "hooks", "register.js"),
    "export function register() {}\n",
  );
};

/**
 * Peer starting on a computer whose Claude Code settings are `settings`, after `before` laid out
 * Peer's files: the adapters, the coordination they report, and the Mod's hooks module then.
 */
const started = (input: {
  readonly settings: (paths: PeerCoordination.CoordinationPaths) => Record<string, unknown>;
  readonly before?: (paths: PeerCoordination.CoordinationPaths) => Promise<void>;
  readonly instances?: (
    baseDir: string,
  ) => Readonly<Record<ProviderInstanceId, ProviderInstanceConfig>>;
  /** The broker whose view the status reports; none by default, as before coordination starts. */
  readonly broker?: () => CoordinationBroker | null;
}) =>
  Effect.gen(function* () {
    const baseDir = yield* seedState();
    const paths = pathsOf(baseDir);
    const claudeDir = NodePath.join(baseDir, "claude");
    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(claudeDir, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(claudeDir, "settings.json"),
        JSON.stringify(input.settings(paths)),
      );
      await input.before?.(paths);
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeDir);
    vi.stubEnv("CODEX_HOME", NodePath.join(baseDir, "codex"));
    const core = yield* Layer.build(
      PeerAdapters.layer.pipe(
        Layer.provideMerge(
          Layer.mock(PeerCoordination.PeerCoordination)({
            paths,
            broker: input.broker ?? (() => null),
            start: Effect.void,
            stop: Effect.void,
          }),
        ),
        Layer.provideMerge(
          coreLayer(
            baseDir,
            input.instances === undefined
              ? {}
              : {
                  t3: Layer.merge(
                    emptyT3,
                    Settings.ServerSettingsService.layerTest({
                      providerInstances: input.instances(baseDir),
                    }).pipe(Layer.orDie),
                  ),
                },
          ),
        ),
      ),
    );
    const adapters = Context.get(core, PeerAdapters.PeerAdapters);
    const files = (active: boolean) =>
      ClaudeMod.claudeModFiles({ socketPath: paths.socket, peerScript: paths.peer, active })[
        "hooks/register.js"
      ];
    const registered = () =>
      NodeFSP.readFile(
        NodePath.join(ClaudeMod.peerClaudeModPath(paths.dir), "hooks", "register.js"),
        "utf8",
      ).catch(() => null);
    const settings = async (home = claudeDir) =>
      JSON.parse(await NodeFSP.readFile(NodePath.join(home, "settings.json"), "utf8")) as Record<
        string,
        unknown
      >;
    return { adapters, paths, files, registered, settings, baseDir, claudeDir };
  });

describe("Peer's adapters in Claude Code when Peer starts", () => {
  it.effect(
    "leaves a Mod its settings do not name idle and current, so Peer's hooks alone coordinate",
    () =>
      Effect.gen(function* () {
        // Peer's hooks in the settings, and a Mod an environment outside them still loads.
        const { adapters, files, registered, settings, paths } = yield* started({
          settings: hooksOnly,
          before: olderMod,
        });
        assert.strictEqual(yield* Effect.promise(registered), files(false));
        const status = yield* adapters.setCoordination({});
        assert.isTrue(status.coordination.claudeHooks);
        assert.isFalse(status.coordination.claudeMod);
        assert.isTrue(hasPeerHooks(yield* Effect.promise(() => settings()), paths.dir));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("migrates an installed Mod to hooks without changing other Claude settings", () =>
    Effect.gen(function* () {
      const installed = yield* started({ settings: modInstalled, before: olderMod });
      assert.strictEqual(yield* Effect.promise(installed.registered), installed.files(false));
      const status = yield* installed.adapters.setCoordination({});
      assert.isTrue(status.coordination.claudeHooks);
      assert.isFalse(status.coordination.claudeMod);
      const settings = yield* Effect.promise(() => installed.settings());
      assert.isTrue(hasPeerHooks(settings, installed.paths.dir));
      assert.strictEqual(settings.model, "opus");
      assert.deepStrictEqual(settings.env, {
        CLAUDE_CODE_PLUGIN_DIRS: "/other/plugin",
        PRIVATE_SETTING: "kept",
      });
      const hooks = yield* started({ settings: hooksOnly });
      assert.isNull(yield* Effect.promise(hooks.registered));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("installs hooks when an older client requests the Mod", () =>
    Effect.gen(function* () {
      const { adapters, files, registered, settings, paths } = yield* started({
        settings: () => ({}),
        before: olderMod,
      });
      const status = yield* adapters.setCoordination({ claudeMod: true });
      assert.isTrue(status.coordination.claudeHooks);
      assert.isFalse(status.coordination.claudeMod);
      assert.isTrue(hasPeerHooks(yield* Effect.promise(() => settings()), paths.dir));
      assert.strictEqual(yield* Effect.promise(registered), files(false));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves Claude without Peer hooks when no adapter was installed", () =>
    Effect.gen(function* () {
      const { adapters, settings } = yield* started({ settings: () => ({ model: "opus" }) });
      const status = yield* adapters.setCoordination({});
      assert.isFalse(status.coordination.claudeHooks);
      assert.isFalse(status.coordination.claudeMod);
      assert.deepStrictEqual(yield* Effect.promise(() => settings()), { model: "opus" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("gives the explicit hook choice precedence over a legacy Mod choice", () =>
    Effect.gen(function* () {
      const { adapters } = yield* started({ settings: modInstalled });
      const status = yield* adapters.setCoordination({ claudeHooks: true, claudeMod: false });
      assert.isTrue(status.coordination.claudeHooks);
      assert.isFalse(status.coordination.claudeMod);
      const removed = yield* adapters.setCoordination({ claudeHooks: false, claudeMod: true });
      assert.isFalse(removed.coordination.claudeHooks);
      assert.isFalse(removed.coordination.claudeHooksPresent);
      assert.isFalse(removed.coordination.claudeMod);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("pauses coordination without removing hooks, and removes only Peer's hooks", () =>
    Effect.gen(function* () {
      const theirs = {
        hooks: { Stop: [{ hooks: [{ type: "command", command: "/other/notify" }] }] },
        permissions: { allow: ["Bash(npm test)"] },
      };
      const { adapters, settings } = yield* started({ settings: () => theirs });
      yield* adapters.setCoordination({ claudeHooks: true });
      const paused = yield* adapters.setCoordination({ enabled: false });
      assert.isFalse(paused.coordination.enabled);
      assert.isTrue(paused.coordination.claudeHooks);
      const removed = yield* adapters.setCoordination({ claudeHooks: false });
      assert.isFalse(removed.coordination.claudeHooks);
      assert.deepStrictEqual(yield* Effect.promise(() => settings()), theirs);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  const customHome = (baseDir: string) => NodePath.join(baseDir, "claude-work");
  const customInstance = (baseDir: string) => ({
    [ProviderInstanceId.make("claude-work")]: {
      driver: ProviderDriverKind.make("claude"),
      config: { homePath: customHome(baseDir) },
    },
  });

  it.effect("migrates the Mod opt-in to every configured Claude home", () =>
    Effect.gen(function* () {
      const { adapters, settings, baseDir, paths } = yield* started({
        settings: modInstalled,
        instances: customInstance,
      });
      assert.isTrue(
        hasPeerHooks(yield* Effect.promise(() => settings(customHome(baseDir))), paths.dir),
      );
      assert.isTrue((yield* adapters.setCoordination({})).coordination.claudeHooks);
      yield* adapters.setCoordination({ claudeHooks: false });
      const removed = yield* Effect.promise(() => settings(customHome(baseDir)));
      assert.isFalse(hasPeerHooks(removed, paths.dir));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports missing hooks in a new profile and installs them in every home", () =>
    Effect.gen(function* () {
      const { adapters, settings, baseDir, paths } = yield* started({
        settings: hooksOnly,
        instances: customInstance,
      });
      const partial = (yield* adapters.setCoordination({})).coordination;
      assert.isFalse(partial.claudeHooks);
      assert.isTrue(partial.claudeHooksPresent);
      const theirs = { model: "sonnet", env: { PRIVATE_SETTING: "kept" } };
      const file = NodePath.join(customHome(baseDir), "settings.json");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(customHome(baseDir), { recursive: true });
        await NodeFSP.writeFile(file, JSON.stringify(theirs));
      });
      assert.isTrue(
        (yield* adapters.setCoordination({ claudeHooks: true })).coordination.claudeHooks,
      );
      assert.isTrue(hasPeerHooks(yield* Effect.promise(() => settings()), paths.dir));
      yield* adapters.setCoordination({ claudeMod: false });
      assert.deepStrictEqual(yield* Effect.promise(() => settings(customHome(baseDir))), theirs);
      assert.isFalse(hasPeerHooks(yield* Effect.promise(() => settings()), paths.dir));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports installed hooks even when retiring the legacy package fails", () =>
    Effect.gen(function* () {
      const { adapters, settings, paths } = yield* started({
        settings: modInstalled,
        before: async (paths) => {
          await olderMod(paths);
          await NodeFSP.writeFile(
            NodePath.join(ClaudeMod.peerClaudeModPath(paths.dir), ".claude-plugin", "plugin.json"),
            '{"name":"other"}',
          );
        },
      });
      assert.isTrue(hasPeerHooks(yield* Effect.promise(() => settings()), paths.dir));
      assert.isTrue((yield* adapters.setCoordination({})).coordination.claudeHooks);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses to change malformed settings", () =>
    Effect.gen(function* () {
      const { adapters, claudeDir } = yield* started({ settings: () => ({}) });
      const file = NodePath.join(claudeDir, "settings.json");
      yield* Effect.promise(() => NodeFSP.writeFile(file, "{invalid json"));
      const result = yield* adapters.setCoordination({ claudeHooks: true }).pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(
        yield* Effect.promise(() => NodeFSP.readFile(file, "utf8")),
        "{invalid json",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves a linked Claude settings file when adding and removing hooks", () =>
    Effect.gen(function* () {
      const theirs = { model: "opus" };
      const { adapters, settings, claudeDir, baseDir } = yield* started({ settings: () => theirs });
      const file = NodePath.join(claudeDir, "settings.json");
      const target = NodePath.join(baseDir, "shared-settings.json");
      yield* Effect.promise(async () => {
        await NodeFSP.rename(file, target);
        await NodeFSP.symlink(target, file);
      });
      yield* adapters.setCoordination({ claudeHooks: true });
      assert.isTrue((yield* Effect.promise(() => NodeFSP.lstat(file))).isSymbolicLink());
      yield* adapters.setCoordination({ claudeHooks: false });
      assert.isTrue((yield* Effect.promise(() => NodeFSP.lstat(file))).isSymbolicLink());
      assert.deepStrictEqual(yield* Effect.promise(() => settings()), theirs);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("the coordination Peer reports to its clients", () => {
  const overlap = {
    id: "abc123def456",
    project: "app",
    sessions: ["claude:ana", "claude:bob"],
    files: ["payments/webhooks.ts"],
    state: "open" as const,
    notes: [],
    openedAt: "2026-10-11T10:00:00Z",
    updatedAt: "2026-10-11T10:00:00Z",
  };

  it.effect(
    "says what decided an overlap, and which policy each project sets, as the Hub sent them",
    () =>
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() => brokerFixture(() => ({ policy: () => "coordinate" }))),
          (f) => Effect.promise(f.dispose),
        );
        const decision = { policy: "ask", source: "project", pattern: "payments/**" } as const;
        fixture.broker.views.set("acme", {
          sessions: [],
          overlaps: [
            { ...overlap, decision },
            { ...overlap, id: "older", files: ["docs/setup.md"] },
          ],
          // `lockstep` is a policy of a newer Hub, which this Peer does not apply.
          policies: { app: "notify", camp: "lockstep" },
          at: overlap.updatedAt,
        });
        const { adapters } = yield* started({
          settings: hooksOnly,
          broker: () => fixture.broker,
        });
        const { coordination } = yield* adapters.setCoordination({});
        const decided = coordination.overlaps.find((o) => o.id === overlap.id);
        const without = coordination.overlaps.find((o) => o.id === "older");
        assert.deepStrictEqual(decided?.decision, decision);
        // The project's path rule decides the overlap's policy for every computer.
        assert.strictEqual(decided?.policy, "ask");
        // An overlap of a Hub from before decisions carries none, not an empty one.
        assert.notProperty(without ?? {}, "decision");
        assert.strictEqual(without?.policy, "notify");
        assert.deepStrictEqual(coordination.policies, { acme: { app: "notify" } });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("lists no policies while coordination has no view of any workspace", () =>
    Effect.gen(function* () {
      const { adapters } = yield* started({ settings: hooksOnly });
      const { coordination } = yield* adapters.setCoordination({});
      assert.deepStrictEqual(coordination.policies, {});
      assert.deepStrictEqual(coordination.overlaps, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
