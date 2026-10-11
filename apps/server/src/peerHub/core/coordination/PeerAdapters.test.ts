// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - Claude Code's settings and Peer Mod's files in a temporary home.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as ClaudeMod from "../../claudeMod/install.ts";
import { claudeHookGroups, hasPeerHooks, withPeerHooks } from "../adapters/scripts.ts";
import type { CoordinationBroker } from "../broker/Broker.ts";
import { brokerFixture } from "../broker/testkit.ts";
import { coreLayer, seedState } from "../testkit.ts";
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
  ClaudeMod.withClaudeMod({}, ClaudeMod.peerClaudeModPath(paths.dir), true);

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
        Layer.provideMerge(coreLayer(baseDir)),
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
    const settings = async () =>
      JSON.parse(
        await NodeFSP.readFile(NodePath.join(claudeDir, "settings.json"), "utf8"),
      ) as Record<string, unknown>;
    return { adapters, paths, files, registered, settings };
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
        assert.isUndefined(adapters.claudeMod());
        const status = yield* adapters.setCoordination({});
        assert.isTrue(status.coordination.claudeHooks);
        assert.isFalse(status.coordination.claudeMod);
        assert.isTrue(hasPeerHooks(yield* Effect.promise(settings), paths.dir));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps a Mod its settings name active and current, and creates none otherwise", () =>
    Effect.gen(function* () {
      const installed = yield* started({ settings: modInstalled, before: olderMod });
      assert.strictEqual(yield* Effect.promise(installed.registered), installed.files(true));
      assert.isDefined(installed.adapters.claudeMod());
      const hooks = yield* started({ settings: hooksOnly });
      assert.isNull(yield* Effect.promise(hooks.registered));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("turns the Mod idle when its person switches Claude Code to Peer's hooks", () =>
    Effect.gen(function* () {
      const { adapters, files, registered } = yield* started({ settings: modInstalled });
      assert.strictEqual(yield* Effect.promise(registered), files(true));
      const status = yield* adapters.setCoordination({ claudeHooks: true });
      assert.isTrue(status.coordination.claudeHooks);
      assert.isFalse(status.coordination.claudeMod);
      assert.strictEqual(yield* Effect.promise(registered), files(false));
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
