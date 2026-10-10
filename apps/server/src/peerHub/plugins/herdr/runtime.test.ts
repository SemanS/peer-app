// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the coordination log is a file of JSON lines on disk.
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerHerdrStatus, PeerHubError, PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { brokerFixture } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import { HerdrClient, type HerdrClientShape } from "./client/HerdrClient.ts";
import { HerdrProcess } from "./client/HerdrProcess.ts";
import {
  fakeHerdrProcess,
  fakeHerdrWorld,
  type FakeHerdrWorld,
} from "./client/HerdrProcess.testkit.ts";
import { HerdrPlugin } from "./index.ts";

/** herdr's socket as a stand-in with no agents; what the plugin asks of it is not the point here. */
const quietClient: HerdrClientShape = {
  follow: () => ({ read: async () => [], live: () => false, close: () => undefined }),
  list: async () => [],
  read: async () => ({ kind: "unavailable" }),
  prompt: async () => undefined,
  wake: async () => ({ status: "queued" }),
  focus: async () => undefined,
  notify: async () => undefined,
  start: async () => ({ paneId: "w1:p1", terminalId: "t1" }),
};

type Handlers = Record<string, (input: object) => Effect.Effect<PeerHubStatus, PeerHubError>>;
const SET_RUNTIME = "peer.herdr.setRuntime";
const RESTART = "peer.herdr.restartRuntime";
const OPEN_TERMINAL = "peer.herdr.openTerminal";
const SET_INTEGRATION = "peer.herdr.setIntegration";

/** Ana's Peer under `baseDir` (a fresh one unless given), over the computer `world` describes. */
const ana = (world: FakeHerdrWorld, baseDir?: string) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: () => [200, {}] });
    const dir = baseDir ?? (yield* seedState(paymentsSeed(hub.url)));
    const core = yield* Layer.build(
      coreLayer(dir, { session: "phs_test", plugins: [HerdrPlugin] }),
    );
    return yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() =>
        Effect.succeed({
          enabled: false,
          policy: "coordinate",
          claudeHooks: false,
          logPath: "/tmp/coordination.jsonl",
          sessions: [],
          overlaps: [],
          findings: [],
          contexts: [],
          candidates: [],
        }),
      );
      const agents = yield* PeerAgents.PeerAgents;
      const start = PeerPlugins.startPlugins.pipe(
        Effect.provideService(HerdrClient, quietClient),
        Effect.provideService(HerdrProcess, fakeHerdrProcess(world)),
        Effect.provide(core),
      );
      return { dir, status, agents, start, plugins: yield* PeerPlugins.PeerPlugins };
    }).pipe(Effect.provide(core));
  });

/** The plugin's RPC handlers, called as the transport would, without its wrappers. */
const handlersOf = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  Effect.gen(function* () {
    const herdr = (yield* plugins.active).find((plugin) => plugin.id === "herdr");
    const handlers = herdr?.contributions.rpc?.handlers({
      effect: (_method, effect) => effect,
      stream: (_method, stream) => stream,
    });
    return handlers as Handlers;
  });

/** The first status of the herdr field that satisfies `seen`, read as the plugin runs. */
const herdrWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (herdr: PeerHerdrStatus) => boolean,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 500; attempt++) {
      const herdr = (yield* status.publish).herdr;
      if (herdr !== undefined && seen(herdr)) return herdr;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error("the herdr status never became what the test waits for"));
  });

const running = (herdr: PeerHerdrStatus) =>
  herdr.runtime.state === "running" && herdr.integrations.length === 2;

describe("the herdr runtime", () => {
  it.effect("is on by default, starts Peer's herdr and shows it in the status", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { status, start } = yield* ana(world);
      yield* start;
      const herdr = yield* herdrWhen(status, running);
      assert.strictEqual(herdr.bundled, true);
      const { attachCommand, ...runtime } = herdr.runtime;
      assert.deepStrictEqual(runtime, {
        source: "peer",
        state: "running",
        version: "0.9.3",
        bundledVersion: "0.9.3",
        agents: 0,
        resumable: 0,
        otherRunning: false,
      });
      assert.match(attachCommand ?? "", /^herdr --session peer-[0-9a-f]{8}$/);
      assert.deepStrictEqual(
        herdr.integrations.map((integration) => [integration.agent, integration.state]),
        [
          ["claude", "missing"],
          ["codex", "missing"],
        ],
      );
      assert.deepStrictEqual(world.calls, ["start"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("uses the person's herdr and starts none of its own", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({ own: { version: "0.9.4", agents: [] } });
      const { status, start } = yield* ana(world);
      yield* start;
      const herdr = yield* herdrWhen(status, (next) => next.runtime.state === "running");
      assert.deepStrictEqual(
        [herdr.runtime.source, herdr.runtime.version, herdr.runtime.attachCommand],
        ["own", "0.9.4", undefined],
      );
      assert.deepStrictEqual(world.calls, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is unavailable without a bundled binary and without a herdr of the person's", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld({
        binary: { available: false, reason: "This build of Peer does not include herdr." },
      });
      const { status, start } = yield* ana(world);
      yield* start;
      const herdr = yield* herdrWhen(status, (next) => next.runtime.state === "unavailable");
      assert.deepStrictEqual(herdr, {
        bundled: true,
        runtime: {
          source: "none",
          state: "unavailable",
          agents: 0,
          resumable: 0,
          otherRunning: false,
          reason: "This build of Peer does not include herdr.",
        },
        integrations: [],
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("turns off and on, and keeps the choice when it is created again", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const first = yield* ana(world);
      yield* first.start;
      const rpc = yield* handlersOf(first.plugins);
      yield* herdrWhen(first.status, running);

      const off = yield* rpc[SET_RUNTIME]!({ on: false });
      assert.deepStrictEqual(
        [off.herdr?.bundled, off.herdr?.runtime.state, off.herdr?.runtime.source],
        [false, "off", "none"],
      );
      assert.isNull(world.peer);

      // A new runtime on the same state reads the choice: it starts nothing.
      const again = fakeHerdrWorld();
      const second = yield* ana(again, first.dir);
      yield* second.start;
      const stayed = yield* herdrWhen(second.status, (next) => next.runtime.state === "off");
      assert.strictEqual(stayed.bundled, false);
      assert.deepStrictEqual(again.calls, []);

      const on = yield* (yield* handlersOf(second.plugins))[SET_RUNTIME]!({ on: true });
      assert.deepStrictEqual(
        [on.herdr?.bundled, on.herdr?.runtime.state, on.herdr?.runtime.source],
        [true, "running", "peer"],
      );
      assert.deepStrictEqual(again.calls, ["start"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("restarts Peer's herdr", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { status, start, plugins } = yield* ana(world);
      yield* start;
      yield* herdrWhen(status, running);
      const restarted = yield* (yield* handlersOf(plugins))[RESTART]!({});
      assert.strictEqual(restarted.herdr?.runtime.state, "running");
      assert.deepStrictEqual(world.calls, ["start", "stop", "start"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("opens a terminal, or fails with the command to attach by hand", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { status, start, plugins } = yield* ana(world);
      yield* start;
      yield* herdrWhen(status, running);
      const rpc = yield* handlersOf(plugins);

      yield* rpc[OPEN_TERMINAL]!({});
      assert.deepStrictEqual(world.calls, ["start", "open terminal"]);

      world.terminal = {
        opened: false,
        reason: "Peer found no terminal application it can open on this computer.",
      };
      const refused = yield* rpc[OPEN_TERMINAL]!({}).pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused));
      const message = Result.isFailure(refused) ? refused.failure.message : "";
      assert.include(message, "no terminal application");
      assert.match(message, /To attach by hand, run: herdr --session peer-[0-9a-f]{8}$/);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("installs and removes an integration, and says what it could not do", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { status, start, plugins } = yield* ana(world);
      yield* start;
      yield* herdrWhen(status, running);
      const rpc = yield* handlersOf(plugins);
      const states = (next: PeerHubStatus) =>
        next.herdr?.integrations.map((integration) => `${integration.agent}:${integration.state}`);

      const installed = yield* rpc[SET_INTEGRATION]!({ agent: "claude", installed: true });
      assert.deepStrictEqual(states(installed), ["claude:installed", "codex:missing"]);
      const removed = yield* rpc[SET_INTEGRATION]!({ agent: "claude", installed: false });
      assert.deepStrictEqual(states(removed), ["claude:missing", "codex:missing"]);
      assert.deepStrictEqual(world.calls, ["start", "install claude", "uninstall claude"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("publishes the status after each change", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { status, start, plugins } = yield* ana(world);
      yield* start;
      yield* herdrWhen(status, running);
      const rpc = yield* handlersOf(plugins);
      const seen = yield* Queue.unbounded<PeerHerdrStatus | undefined>();
      yield* status.changes.pipe(
        Stream.runForEach((next) => Queue.offer(seen, next.herdr)),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      const heard = Effect.gen(function* () {
        yield* Effect.yieldNow;
        return (yield* Queue.clear(seen)).at(-1);
      });

      yield* rpc[SET_INTEGRATION]!({ agent: "codex", installed: true });
      assert.deepStrictEqual(
        (yield* heard)?.integrations.map((integration) => integration.state),
        ["missing", "installed"],
      );
      yield* rpc[SET_RUNTIME]!({ on: false });
      assert.strictEqual((yield* heard)?.runtime.state, "off");
      yield* rpc[SET_RUNTIME]!({ on: true });
      assert.strictEqual((yield* heard)?.runtime.state, "running");
      // A restart that ends where it began changes nothing to send: the status is the same.
      const restarted = yield* rpc[RESTART]!({});
      assert.deepStrictEqual(restarted.herdr, (yield* status.publish).herdr);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("logs what happened to Peer's herdr without a path, a command or a variable", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { agents, status, start, plugins } = yield* ana(world);
      const broker = yield* Effect.acquireRelease(
        Effect.promise(() => brokerFixture()),
        (made) => Effect.promise(() => made.dispose()),
      );
      yield* agents.attach(broker.broker);
      yield* start;
      yield* herdrWhen(status, running);
      const rpc = yield* handlersOf(plugins);
      yield* rpc[RESTART]!({});
      yield* rpc[SET_RUNTIME]!({ on: false });
      yield* Effect.promise(() => broker.broker.host.log.idle());

      const lines = (yield* Effect.promise(() =>
        NodeFSP.readFile(broker.broker.host.logPath, "utf8"),
      ))
        .split("\n")
        .filter((line) => line.includes("herdr.runtime."))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.deepStrictEqual(
        lines.map((line) => line.event),
        ["herdr.runtime.started", "herdr.runtime.restarted", "herdr.runtime.stopped"],
      );
      for (const line of lines) {
        const { t: _time, event: _event, ...fields } = line;
        assert.hasAllKeys(fields, [
          "source",
          "version",
          "agents",
          ...(line.reasonClass ? ["reasonClass"] : []),
        ]);
        assert.notMatch(JSON.stringify(line), /Applications|herdr --session|\/home\//);
      }
      assert.deepStrictEqual(lines.at(-1)?.reasonClass, "turned-off");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
