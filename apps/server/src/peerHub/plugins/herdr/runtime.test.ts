// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the coordination log is a file of JSON lines on disk.
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerHerdrStatus, PeerHubError, PeerHubStatus } from "@t3tools/contracts";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
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
import { HerdrProcess, type HerdrProcessShape } from "./client/HerdrProcess.ts";
import {
  fakeHerdrProcess,
  fakeHerdrWorld,
  type FakeHerdrWorld,
} from "./client/HerdrProcess.testkit.ts";
import { HerdrPlugin } from "./index.ts";

/**
 * herdr's socket as a stand-in with no agents (or none running, with `listed` null); `asked` hears
 * of each call with the socket it got, and `followed` of the socket each follower was given.
 */
const clientAsking = (
  asked: Array<string>,
  followed: Array<string | (() => string) | undefined> = [],
  listed: ReadonlyArray<never> | null = [],
): HerdrClientShape => ({
  follow: (_onChange, _retryMs, socket) => {
    followed.push(socket);
    return { read: async () => [], live: () => false, close: () => undefined };
  },
  list: async (socket) => (asked.push(`list ${socket}`), listed),
  read: async () => ({ kind: "unavailable" }),
  prompt: async () => undefined,
  wake: async () => ({ status: "queued" }),
  focus: async (pane, socket) => void asked.push(`focus ${pane} ${socket}`),
  notify: async () => undefined,
  start: async () => ({ paneId: "w1:p1", terminalId: "t1" }),
});

type Handlers = Record<string, (input: object) => Effect.Effect<PeerHubStatus, PeerHubError>>;
const FOCUS = "peerHub.focusAgent";
const SET_RUNTIME = "peer.herdr.setRuntime";
const RESTART = "peer.herdr.restartRuntime";
const OPEN_TERMINAL = "peer.herdr.openTerminal";
const SET_INTEGRATION = "peer.herdr.setIntegration";

/** Ana's Peer under `baseDir` (a fresh one unless given), over the computer `world` describes. */
const ana = (
  world: FakeHerdrWorld,
  options: {
    readonly baseDir?: string;
    readonly asked?: Array<string>;
    readonly followed?: Array<string | (() => string) | undefined>;
    readonly listed?: null;
    readonly process?: HerdrProcessShape;
  } = {},
) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: () => [200, {}] });
    const dir = options.baseDir ?? (yield* seedState(paymentsSeed(hub.url)));
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
        Effect.provideService(
          HerdrClient,
          clientAsking(options.asked ?? [], options.followed, options.listed),
        ),
        Effect.provideService(HerdrProcess, options.process ?? fakeHerdrProcess(world)),
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
      const second = yield* ana(again, { baseDir: first.dir });
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

/** What the plugin contributes, as core reads it. */
const contributionsOf = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  Effect.gen(function* () {
    const herdr = (yield* plugins.active).find((plugin) => plugin.id === "herdr");
    return herdr?.contributions;
  });

/** Lets promises the effects wait on settle. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true });

describe("herdr's agents and the herdr in use", () => {
  it.effect("goes to the socket of the herdr that serves, and moves with it", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const followed: Array<string | (() => string) | undefined> = [];
      const world = fakeHerdrWorld();
      const { status, start, plugins } = yield* ana(world, { asked, followed });
      yield* start;
      yield* herdrWhen(status, running);
      const rpc = yield* handlersOf(plugins);
      yield* rpc[FOCUS]!({ paneId: "w1:p1" });
      assert.include(asked, `focus w1:p1 ${world.peerSocket}`);
      // The follower is given a function, so it reads the socket of the herdr in use each time.
      const follower = followed[0];
      assert.isFunction(follower);
      assert.strictEqual(typeof follower === "function" ? follower() : follower, world.peerSocket);

      // The person starts their own herdr while Peer's is idle: Peer gives way, and calls follow.
      world.own = { version: "0.9.4", agents: [] };
      yield* (yield* handlersOf(plugins))[RESTART]!({});
      yield* rpc[FOCUS]!({ paneId: "w1:p2" });
      assert.include(asked, "focus w1:p2 /home/ana/.config/herdr/herdr.sock");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps today's socket where Peer has no herdr of its own", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const world = fakeHerdrWorld({
        binary: { available: false, reason: "This build of Peer does not include herdr." },
        own: { version: "0.9.3", agents: [] },
      });
      const { status, start, plugins } = yield* ana(world, { asked });
      yield* start;
      yield* herdrWhen(status, (next) => next.runtime.source === "own");
      yield* (yield* handlersOf(plugins))[FOCUS]!({ paneId: "w1:p1" });
      assert.include(asked, "focus w1:p1 /home/ana/.config/herdr/herdr.sock");
      assert.strictEqual(world.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("showing an agent in herdr", () => {
  const withWindow = (world: FakeHerdrWorld) =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const opened = fakeHerdrProcess(world);
      const ours = {
        ...opened,
        openTerminal: async (home: Parameters<typeof opened.openTerminal>[0]) => {
          asked.push("open window");
          return opened.openTerminal(home);
        },
      };
      const made = yield* ana(world, { asked, process: ours });
      yield* made.start;
      yield* herdrWhen(made.status, (next) => next.runtime.state === "running");
      return { ...made, asked, rpc: yield* handlersOf(made.plugins) };
    });

  it.effect("opens a window first when none is attached, then brings the agent forward", () =>
    Effect.gen(function* () {
      const { rpc, asked } = yield* withWindow(fakeHerdrWorld({ attached: 0 }));
      const shown = yield* Effect.forkChild(rpc[FOCUS]!({ paneId: "w1:p1", openWindow: true }));
      yield* settle;
      yield* TestClock.adjust("250 millis");
      yield* Fiber.join(shown);
      assert.deepStrictEqual(
        asked.filter((line) => !line.startsWith("follow") && !line.startsWith("list")),
        ["open window", asked.find((line) => line.startsWith("focus"))],
      );
      assert.match(asked.at(-1) ?? "", /^focus w1:p1 /);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("only focuses when a window is attached, or when it was not asked to open one", () =>
    Effect.gen(function* () {
      const attached = yield* withWindow(fakeHerdrWorld({ attached: 1 }));
      yield* attached.rpc[FOCUS]!({ paneId: "w1:p1", openWindow: true });
      assert.notInclude(attached.asked, "open window");

      const unasked = yield* withWindow(fakeHerdrWorld({ attached: 0 }));
      yield* unasked.rpc[FOCUS]!({ paneId: "w1:p1" });
      assert.notInclude(unasked.asked, "open window");
      assert.match(unasked.asked.at(-1) ?? "", /^focus w1:p1 /);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("opens one window per run when herdr cannot say who is attached", () =>
    Effect.gen(function* () {
      const { rpc, asked } = yield* withWindow(fakeHerdrWorld({ attached: "unknown" }));
      const first = yield* Effect.forkChild(rpc[FOCUS]!({ paneId: "w1:p1", openWindow: true }));
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(first);
      yield* rpc[FOCUS]!({ paneId: "w1:p2", openWindow: true });
      assert.strictEqual(asked.filter((line) => line === "open window").length, 1);
      assert.strictEqual(asked.filter((line) => line.startsWith("focus")).length, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("brings the agent forward even when no terminal exists, and says how to attach", () =>
    Effect.gen(function* () {
      const { rpc, asked } = yield* withWindow(
        fakeHerdrWorld({
          attached: 0,
          terminal: { opened: false, reason: "Peer found no terminal application." },
        }),
      );
      const refused = yield* rpc[FOCUS]!({ paneId: "w1:p1", openWindow: true }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused));
      assert.match(
        Result.isFailure(refused) ? refused.failure.message : "",
        /no terminal application\. To attach by hand, run: herdr --session peer-/,
      );
      assert.match(asked.at(-1) ?? "", /^focus w1:p1 /);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not open a window onto the person's own herdr", () =>
    Effect.gen(function* () {
      const { rpc, asked } = yield* withWindow(
        fakeHerdrWorld({ attached: 0, own: { version: "0.9.4", agents: [] } }),
      );
      yield* rpc[FOCUS]!({ paneId: "w1:p1", openWindow: true });
      assert.notInclude(asked, "open window");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("turning the herdr plugin off", () => {
  it.effect("stops Peer's herdr when it runs no agents, and starts it again when turned on", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { status, start, plugins } = yield* ana(world);
      yield* start;
      yield* herdrWhen(status, running);
      yield* plugins.setPlugin({ id: "herdr", enabled: false });
      assert.isNull(world.peer);
      assert.isFalse(Object.hasOwn(yield* status.publish, "herdr"));

      yield* plugins.setPlugin({ id: "herdr", enabled: true });
      yield* herdrWhen(status, (next) => next.runtime.state === "running");
      assert.deepStrictEqual(world.calls, ["start", "stop", "start"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves a herdr that runs agents running, and uses it when turned on again", () =>
    Effect.gen(function* () {
      const world = fakeHerdrWorld();
      const { status, start, plugins } = yield* ana(world);
      yield* start;
      yield* herdrWhen(status, running);
      world.peer!.agents.push({
        terminalId: "t1",
        paneId: "w1:p1",
        agent: "claude",
        title: "Split payments",
        status: "working",
        completionSeq: undefined,
        cwd: undefined,
        session: undefined,
      });
      yield* plugins.setPlugin({ id: "herdr", enabled: false });
      assert.isNotNull(world.peer);
      assert.deepStrictEqual(world.calls, ["start"]);

      yield* plugins.setPlugin({ id: "herdr", enabled: true });
      const back = yield* herdrWhen(status, (next) => next.runtime.agents === 1);
      assert.deepStrictEqual([back.runtime.source, back.runtime.state], ["peer", "running"]);
      assert.deepStrictEqual(world.calls, ["start"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("starting an agent while herdr is not ready", () => {
  const reasonOf = (world: FakeHerdrWorld, listed?: null) =>
    Effect.gen(function* () {
      const { status, start, plugins } = yield* ana(world, listed === undefined ? {} : { listed });
      yield* start;
      yield* herdrWhen(status, (next) => next.runtime.state !== "starting");
      const launcher = (yield* contributionsOf(plugins))?.taskLauncher;
      return { reason: yield* launcher!.unavailable, status, plugins };
    });

  it.effect("has no reason while a herdr serves", () =>
    Effect.gen(function* () {
      assert.isNull((yield* reasonOf(fakeHerdrWorld())).reason);
      assert.isNull(
        (yield* reasonOf(fakeHerdrWorld({ own: { version: "0.9.4", agents: [] } }))).reason,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says Peer's herdr is off, in the words of the design", () =>
    Effect.gen(function* () {
      const { status, start, plugins } = yield* ana(fakeHerdrWorld());
      yield* start;
      yield* herdrWhen(status, running);
      yield* (yield* handlersOf(plugins))[SET_RUNTIME]!({ on: false });
      const launcher = (yield* contributionsOf(plugins))?.taskLauncher;
      assert.strictEqual(
        yield* launcher!.unavailable,
        "Peer's herdr is off. Turn it on in Settings → Workspaces, or start your own herdr.",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says herdr is starting while a first start has failed and the next is due", () =>
    Effect.gen(function* () {
      const { status, start, plugins } = yield* ana(fakeHerdrWorld({ startFails: true }));
      yield* start;
      yield* herdrWhen(status, (next) => next.runtime.reason !== undefined);
      const launcher = (yield* contributionsOf(plugins))?.taskLauncher;
      assert.strictEqual(yield* launcher!.unavailable, "herdr is starting on this computer");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the install instruction where Peer has no herdr to start", () =>
    Effect.gen(function* () {
      const none = fakeHerdrWorld({
        binary: { available: false, reason: "This build of Peer does not include herdr." },
      });
      assert.match(
        (yield* reasonOf(none, null)).reason ?? "",
        /^herdr is not running on this environment\. Install it from https:\/\/herdr\.dev\/docs\/install\//,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
