import { assert, describe, it } from "@effect/vitest";
import type { PeerHerdrRuntime } from "@t3tools/contracts";

import { peerHerdrPaths, type HerdrBinary } from "./binary.ts";
import type { HerdrAgent } from "./herdr.ts";
import type { HerdrProcessShape } from "./HerdrProcess.ts";
import type { HerdrSpawned, HerdrStartResult } from "./server.ts";
import {
  HERDR_BACKOFF_MS,
  HERDR_TICK_MS,
  makeHerdrSupervisor,
  type HerdrRuntimeEvent,
} from "./supervisor.ts";

const STATE_DIR = "/home/ana/.peer";
const OWN_SOCKET = "/home/ana/.config/herdr/herdr.sock";
const PEER_PATHS = peerHerdrPaths(STATE_DIR, { XDG_CONFIG_HOME: "/home/ana/.config" });
const BIN = "/Applications/Peer.app/Contents/Resources/herdr/herdr";
const SECOND = 1000;
const MINUTE = 60 * SECOND;

interface Running {
  version: string;
  agents: Array<HerdrAgent>;
}

const agent = (id: string, extra: Partial<HerdrAgent> = {}): HerdrAgent => ({
  terminalId: `t-${id}`,
  paneId: id,
  agent: "claude",
  title: "agent",
  status: "working",
  completionSeq: undefined,
  cwd: undefined,
  session: undefined,
  ...extra,
});

/** The computer as the supervisor sees it through the port, and everything it was asked to do. */
function makeWorld(
  initial: { readonly bundledVersion?: string; readonly binary?: HerdrBinary } = {},
) {
  const world = {
    now: 1_000_000,
    own: null as Running | null,
    peer: null as Running | null,
    binary: initial.binary ?? ({ available: true, path: BIN } as HerdrBinary),
    bundledVersion: initial.bundledVersion ?? "0.9.3",
    /** What the next starts do, in order; a start past the end succeeds. */
    startOutcomes: [] as Array<"ok" | "fail" | "timeout">,
    stopFails: false,
    ownSocket: OWN_SOCKET,
    calls: [] as Array<string>,
    gate: null as Promise<void> | null,
    /** The port throws instead of answering, which it is not meant to. */
    broken: false,
    pids: 0,
  };
  const port: HerdrProcessShape = {
    binary: () => world.binary,
    paths: () => PEER_PATHS,
    ownSocketPath: () => world.ownSocket,
    binaryVersion: async () => world.bundledVersion,
    ping: async (socket) => {
      world.calls.push(`ping ${socket === PEER_PATHS.socketPath ? "peer" : "own"}`);
      await world.gate;
      if (world.broken) throw new Error("the port broke");
      const running = socket === PEER_PATHS.socketPath ? world.peer : world.own;
      return running === null ? null : { version: running.version, protocol: 22, capabilities: [] };
    },
    agents: async (socket) =>
      (socket === PEER_PATHS.socketPath ? world.peer : world.own)?.agents ?? null,
    start: async (home) => {
      assert.deepStrictEqual(home, { bin: BIN, paths: PEER_PATHS });
      world.calls.push("start");
      const outcome = world.startOutcomes.shift() ?? "ok";
      const spawned: HerdrSpawned = { pid: ++world.pids, exited: () => false };
      if (outcome === "ok") {
        world.peer = { version: world.bundledVersion, agents: [] };
        return { ok: true, version: world.bundledVersion, adopted: false, spawned };
      }
      const failure: HerdrStartResult =
        outcome === "timeout"
          ? {
              ok: false,
              reasonClass: "timeout",
              reason: "herdr did not answer within 15 seconds.",
              spawned,
            }
          : {
              ok: false,
              reasonClass: "exited",
              reason: "herdr exited right after it started (code 1).",
              spawned: undefined,
            };
      return failure;
    },
    stop: async (_home, spawned) => {
      world.calls.push(spawned === undefined ? "stop" : `stop pid ${spawned.pid}`);
      if (world.stopFails) return { stopped: false, reason: "herdr did not stop when asked." };
      world.peer = null;
      return { stopped: true };
    },
    attachedClients: async () => "unknown",
    attachCommand: (home) => `attach ${home.bin}`,
    openTerminal: async () => ({ opened: false, reason: "unused" }),
    integrations: async () => [],
    setIntegration: async () => ({ ok: true, messages: [] }),
  };
  const events: Array<HerdrRuntimeEvent> = [];
  const changes: Array<PeerHerdrRuntime> = [];
  const supervisor = (options: { readonly bundled?: boolean } = {}) =>
    makeHerdrSupervisor({
      port,
      stateDir: STATE_DIR,
      ...options,
      now: () => world.now,
      onEvent: (event) => events.push(event),
      onChange: (snapshot) => changes.push(snapshot),
    });
  const count = (call: string) => world.calls.filter((entry) => entry === call).length;
  return { world, supervisor, events, changes, count };
}

describe("which herdr serves", () => {
  it("uses the person's own herdr and starts none", async () => {
    const { world, supervisor, events, count } = makeWorld();
    world.own = { version: "0.9.3", agents: [agent("w1:p1"), agent("w1:p2")] };
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(herdr.snapshot(), {
      source: "own",
      state: "running",
      version: "0.9.3",
      bundledVersion: "0.9.3",
      agents: 2,
      resumable: 0,
      otherRunning: false,
    });
    assert.strictEqual(herdr.socketPath(), OWN_SOCKET);
    assert.strictEqual(count("start"), 0);
    assert.deepStrictEqual(events, [
      { event: "adopted", source: "own", version: "0.9.3", agents: 2 },
    ]);
  });

  it("adopts a Peer herdr that is already running, with its agents, and starts no other", async () => {
    const { world, supervisor, events, count } = makeWorld();
    world.peer = {
      version: "0.9.3",
      agents: [
        agent("w1:p1", { session: { id: "s1", path: undefined } }),
        agent("w1:p2", { agent: "codex" }),
        agent("w1:p3", { agent: "codex", session: { id: "s3", path: undefined } }),
        agent("w1:p4", { agent: "pi", session: { id: "s4", path: undefined } }),
      ],
    };
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(herdr.snapshot(), {
      source: "peer",
      state: "running",
      version: "0.9.3",
      bundledVersion: "0.9.3",
      agents: 4,
      resumable: 2,
      otherRunning: false,
      attachCommand: `attach ${BIN}`,
    });
    assert.strictEqual(herdr.socketPath(), PEER_PATHS.socketPath);
    assert.strictEqual(count("start"), 0);
    assert.deepStrictEqual(events, [
      { event: "adopted", source: "peer", version: "0.9.3", agents: 4 },
    ]);
  });

  it("starts Peer's herdr when none answers, and tells while it does", async () => {
    const { world, supervisor, events, changes, count } = makeWorld();
    const herdr = supervisor();
    await herdr.tick();
    assert.strictEqual(count("start"), 1);
    assert.deepStrictEqual(
      changes.map((change) => [change.source, change.state]),
      [
        ["peer", "starting"],
        ["peer", "running"],
      ],
    );
    const snapshot = herdr.snapshot();
    assert.strictEqual(snapshot.state, "running");
    assert.strictEqual(snapshot.version, "0.9.3");
    assert.strictEqual(herdr.socketPath(), PEER_PATHS.socketPath);
    assert.deepStrictEqual(events, [
      { event: "started", source: "peer", version: "0.9.3", agents: 0 },
    ]);
    // Nothing more to do on the next look.
    await herdr.tick();
    assert.strictEqual(count("start"), 1);
    assert.strictEqual(world.peer?.version, "0.9.3");
    assert.strictEqual(changes.length, 2, "a tick that changes nothing says nothing");
  });

  it("gives way to the person's herdr when Peer's runs no agents, and stops its own", async () => {
    const { world, supervisor, events } = makeWorld();
    world.own = { version: "0.9.3", agents: [] };
    world.peer = { version: "0.9.3", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().source, "own");
    assert.isNull(world.peer);
    assert.deepStrictEqual(
      events.map((event) => [event.event, event.source, event.reasonClass]),
      [
        ["stopped", "peer", "superseded"],
        ["adopted", "own", undefined],
      ],
    );
  });

  it("keeps Peer's herdr while it runs agents, says the other runs too, and moves after the last", async () => {
    const { world, supervisor, count } = makeWorld();
    world.own = { version: "0.9.3", agents: [] };
    world.peer = { version: "0.9.3", agents: [agent("w1:p1"), agent("w1:p2")] };
    const herdr = supervisor();
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().source, "peer");
    assert.strictEqual(herdr.snapshot().agents, 2);
    assert.isTrue(herdr.snapshot().otherRunning);
    assert.strictEqual(count("stop"), 0);

    world.peer.agents = [agent("w1:p2")];
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().source, "peer");
    assert.strictEqual(herdr.snapshot().agents, 1);

    world.peer.agents = [];
    await herdr.tick();
    assert.deepStrictEqual(
      [herdr.snapshot().source, herdr.snapshot().otherRunning, herdr.socketPath()],
      ["own", false, OWN_SOCKET],
    );
    assert.isNull(world.peer);
  });

  it("starts its own again when the person's herdr stops", async () => {
    const { world, supervisor, count } = makeWorld();
    world.own = { version: "0.9.3", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    world.own = null;
    await herdr.tick();
    assert.deepStrictEqual([herdr.snapshot().source, herdr.snapshot().state], ["peer", "running"]);
    assert.strictEqual(count("start"), 1);
  });

  it("treats Peer's socket named by the person's own variables as Peer's, not as a second herdr", async () => {
    const { world, supervisor, count } = makeWorld();
    world.ownSocket = PEER_PATHS.socketPath;
    world.peer = { version: "0.9.3", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(
      [herdr.snapshot().source, herdr.snapshot().otherRunning],
      ["peer", false],
    );
    assert.strictEqual(count("stop"), 0);
  });

  it("keeps using a herdr that will not stop when the person's takes over", async () => {
    const { world, supervisor } = makeWorld();
    world.own = { version: "0.9.3", agents: [] };
    world.peer = { version: "0.9.3", agents: [] };
    world.stopFails = true;
    const herdr = supervisor();
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().source, "own");
    assert.strictEqual(herdr.snapshot().state, "running");
    assert.isNotNull(world.peer);
  });

  it("is unavailable without a bundled binary, and still uses the person's herdr", async () => {
    const reason = "This build of Peer does not include herdr.";
    const { world, supervisor, count } = makeWorld({ binary: { available: false, reason } });
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(herdr.snapshot(), {
      source: "none",
      state: "unavailable",
      agents: 0,
      resumable: 0,
      otherRunning: false,
      reason,
    });
    assert.isUndefined(herdr.home());
    assert.strictEqual(count("start"), 0);
    assert.strictEqual(count("ping peer"), 0, "there is no Peer herdr to look for");

    world.own = { version: "0.9.3", agents: [agent("w1:p1")] };
    await herdr.tick();
    assert.deepStrictEqual([herdr.snapshot().source, herdr.snapshot().state], ["own", "running"]);
    assert.notProperty(herdr.snapshot(), "reason");
  });
});

describe("Peer's herdr turned off and on", () => {
  it("never starts while off, and says so", async () => {
    const { supervisor, count } = makeWorld();
    const herdr = supervisor({ bundled: false });
    for (let tick = 0; tick < 3; tick++) await herdr.tick();
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["off", "none"]);
    assert.strictEqual(count("start"), 0);
  });

  it("still uses a herdr of Peer's that is already there while off", async () => {
    const { world, supervisor, count } = makeWorld();
    world.peer = { version: "0.9.3", agents: [] };
    const herdr = supervisor({ bundled: false });
    await herdr.tick();
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "peer"]);
    assert.strictEqual(count("stop"), 0);
  });

  it("stops Peer's herdr when turned off, agents and all, and starts it when turned on", async () => {
    const { world, supervisor, events, count } = makeWorld();
    const herdr = supervisor();
    await herdr.tick();
    world.peer!.agents = [agent("w1:p1")];

    await herdr.setBundled(false);
    assert.isNull(world.peer);
    assert.strictEqual(herdr.snapshot().state, "off");
    assert.isFalse(herdr.bundled());
    assert.deepStrictEqual(events.at(-1), {
      event: "stopped",
      source: "peer",
      version: "0.9.3",
      agents: 1,
      reasonClass: "turned-off",
    });
    await herdr.tick();
    assert.strictEqual(count("start"), 1, "off stays off");

    await herdr.setBundled(true);
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "peer"]);
    assert.strictEqual(count("start"), 2);
  });

  it("falls back to the person's herdr when turned off, if there is one", async () => {
    const { world, supervisor } = makeWorld();
    const herdr = supervisor();
    await herdr.tick();
    world.own = { version: "0.9.3", agents: [] };
    await herdr.setBundled(false);
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "own"]);
  });

  it("clears earlier failures when turned off and on", async () => {
    const { world, supervisor } = makeWorld();
    world.startOutcomes = ["fail", "fail", "fail"];
    const herdr = supervisor();
    await herdr.tick();
    world.now += HERDR_BACKOFF_MS[0]!;
    await herdr.tick();
    world.now += HERDR_BACKOFF_MS[1]!;
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().state, "failed");
    await herdr.setBundled(false);
    assert.strictEqual(herdr.snapshot().state, "off");
    await herdr.setBundled(true);
    assert.strictEqual(herdr.snapshot().state, "running");
  });
});

describe("stopping Peer's herdr when the plugin is turned off", () => {
  it("stops an idle herdr, says so, and starts nothing until the next tick", async () => {
    const { world, supervisor, events, count } = makeWorld();
    const herdr = supervisor();
    await herdr.tick();
    assert.isTrue(await herdr.stopIfIdle());
    assert.isNull(world.peer);
    assert.strictEqual(count("start"), 1);
    assert.deepStrictEqual(events.at(-1), {
      event: "stopped",
      source: "peer",
      version: "0.9.3",
      agents: 0,
      reasonClass: "turned-off",
    });
    // Turned on again, it starts like the first time: no failure is counted for the stop.
    await herdr.tick();
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "peer"]);
    assert.strictEqual(count("start"), 2);
  });

  it("leaves a herdr that runs agents, and adopts it when turned on again", async () => {
    const { world, supervisor, events, count } = makeWorld();
    const herdr = supervisor();
    await herdr.tick();
    world.peer!.agents = [agent("w1:p1")];
    assert.isFalse(await herdr.stopIfIdle());
    assert.strictEqual(count("stop"), 0);
    assert.isNotNull(world.peer);
    const again = supervisor();
    await again.tick();
    assert.deepStrictEqual([again.snapshot().state, again.snapshot().agents], ["running", 1]);
    assert.strictEqual(events.at(-1)?.event, "adopted");
  });

  it("has nothing to stop where there is no herdr of Peer's, or it will not stop", async () => {
    const { world, supervisor } = makeWorld();
    assert.isTrue(await supervisor().stopIfIdle());
    const herdr = supervisor();
    await herdr.tick();
    world.stopFails = true;
    assert.isFalse(await herdr.stopIfIdle());
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "peer"]);
  });
});

describe("failures and retries", () => {
  const reason = "herdr exited right after it started (code 1).";

  it("waits 1 s, then 5 s, and gives up after three failures within ten minutes", async () => {
    const { world, supervisor, events, count } = makeWorld();
    world.startOutcomes = ["fail", "fail", "fail", "ok"];
    const herdr = supervisor();

    await herdr.tick();
    assert.strictEqual(count("start"), 1);
    assert.deepStrictEqual(
      [herdr.snapshot().state, herdr.snapshot().reason, herdr.nextDelayMs()],
      ["starting", reason, 1 * SECOND],
    );
    await herdr.tick();
    assert.strictEqual(count("start"), 1, "not before the wait is over");
    world.now += 1 * SECOND - 1;
    await herdr.tick();
    assert.strictEqual(count("start"), 1);
    world.now += 1;
    await herdr.tick();
    assert.strictEqual(count("start"), 2);
    assert.strictEqual(herdr.nextDelayMs(), HERDR_TICK_MS, "5 s is as far as one tick looks ahead");

    world.now += 5 * SECOND - 1;
    await herdr.tick();
    assert.strictEqual(count("start"), 2);
    world.now += 1;
    await herdr.tick();
    assert.strictEqual(count("start"), 3);
    assert.deepStrictEqual(
      [
        herdr.snapshot().state,
        herdr.snapshot().source,
        herdr.snapshot().reason,
        herdr.snapshot().log,
      ],
      ["failed", "none", reason, PEER_PATHS.logPath],
    );
    assert.deepStrictEqual(events, [
      { event: "failed", source: "peer", agents: 0, reasonClass: "exited" },
    ]);

    world.now += 60 * MINUTE;
    await herdr.tick();
    assert.strictEqual(count("start"), 3, "it does not try again by itself");
    assert.strictEqual(herdr.snapshot().state, "failed");
    assert.deepStrictEqual(HERDR_BACKOFF_MS, [1_000, 5_000, 30_000]);
  });

  it("offers Restart after it failed, and a restart starts afresh", async () => {
    const { world, supervisor, count } = makeWorld();
    world.startOutcomes = ["fail", "fail", "fail"];
    const herdr = supervisor();
    for (const wait of [0, 1 * SECOND, 5 * SECOND]) {
      world.now += wait;
      await herdr.tick();
    }
    assert.strictEqual(herdr.snapshot().state, "failed");
    await herdr.restart();
    assert.strictEqual(count("start"), 4);
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "peer"]);
    assert.notProperty(herdr.snapshot(), "log");
  });

  it("does not count failures older than ten minutes", async () => {
    const { world, supervisor, count } = makeWorld();
    world.startOutcomes = ["fail", "fail", "fail", "fail"];
    const herdr = supervisor();
    await herdr.tick();
    world.now += 11 * MINUTE;
    await herdr.tick();
    world.now += 5 * SECOND;
    await herdr.tick();
    assert.strictEqual(count("start"), 3);
    assert.strictEqual(
      herdr.snapshot().state,
      "starting",
      "two failures within ten minutes so far",
    );
    world.now += 30 * SECOND;
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().state, "failed");
  });

  it("starts again after herdr exits on its own, waiting a second", async () => {
    const { world, supervisor, events, count } = makeWorld();
    const herdr = supervisor();
    await herdr.tick();
    events.length = 0;

    world.peer = null;
    await herdr.tick();
    assert.deepStrictEqual(
      [herdr.snapshot().state, herdr.snapshot().reason, count("start")],
      ["starting", "herdr stopped answering.", 1],
    );
    world.now += 1 * SECOND;
    await herdr.tick();
    assert.strictEqual(count("start"), 2);
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "peer"]);
    assert.notProperty(herdr.snapshot(), "reason");
    assert.deepStrictEqual(events, [
      { event: "restarted", source: "peer", version: "0.9.3", agents: 0 },
    ]);
  });

  it("gives up on a herdr that keeps vanishing", async () => {
    const { world, supervisor, count } = makeWorld();
    const herdr = supervisor();
    await herdr.tick();
    for (let vanishing = 0; vanishing < 3; vanishing++) {
      world.peer = null;
      await herdr.tick();
      world.now += 31 * SECOND;
      await herdr.tick();
    }
    assert.strictEqual(herdr.snapshot().state, "failed");
    assert.strictEqual(count("start"), 3, "the third time it is not started again");
  });

  it("ends a start that never answered before trying again, by the pid it started", async () => {
    const { world, supervisor, count } = makeWorld();
    world.startOutcomes = ["timeout", "ok"];
    const herdr = supervisor();
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().reason, "herdr did not answer within 15 seconds.");
    world.now += 1 * SECOND;
    await herdr.tick();
    assert.deepStrictEqual(
      world.calls.filter((call) => call.startsWith("stop")),
      ["stop pid 1"],
    );
    assert.strictEqual(count("start"), 2);
    assert.strictEqual(herdr.snapshot().state, "running");
  });

  it("adopts a herdr that comes up late instead of starting another", async () => {
    const { world, supervisor, count } = makeWorld();
    world.startOutcomes = ["timeout"];
    const herdr = supervisor();
    await herdr.tick();
    world.peer = { version: "0.9.3", agents: [] };
    world.now += 1 * SECOND;
    await herdr.tick();
    assert.strictEqual(count("start"), 1);
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "peer"]);
  });

  it("recovers from failed when the person starts their own herdr", async () => {
    const { world, supervisor } = makeWorld();
    world.startOutcomes = ["fail", "fail", "fail"];
    const herdr = supervisor();
    for (const wait of [0, 1 * SECOND, 5 * SECOND]) {
      world.now += wait;
      await herdr.tick();
    }
    assert.strictEqual(herdr.snapshot().state, "failed");
    world.own = { version: "0.9.3", agents: [] };
    await herdr.tick();
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().source], ["running", "own"]);
  });
});

describe("restarting", () => {
  it("restarts Peer's herdr on the bundled version", async () => {
    const { world, supervisor, events } = makeWorld();
    world.peer = { version: "0.9.3", agents: [agent("w1:p1")] };
    const herdr = supervisor();
    await herdr.tick();
    events.length = 0;
    await herdr.restart();
    assert.deepStrictEqual(
      world.calls.filter((call) => call === "start" || call.startsWith("stop")),
      ["stop", "start"],
    );
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().agents], ["running", 0]);
    assert.deepStrictEqual(events, [
      { event: "restarted", source: "peer", version: "0.9.3", agents: 0 },
    ]);
  });

  it("keeps the herdr that will not stop in use", async () => {
    const { world, supervisor, count } = makeWorld();
    world.peer = { version: "0.9.3", agents: [agent("w1:p1")] };
    world.stopFails = true;
    const herdr = supervisor();
    await herdr.tick();
    await herdr.restart();
    assert.strictEqual(count("start"), 0);
    assert.deepStrictEqual([herdr.snapshot().state, herdr.snapshot().agents], ["running", 1]);
  });
});

describe("versions", () => {
  it("upgrades an idle herdr without asking", async () => {
    const { world, supervisor, events, count } = makeWorld({ bundledVersion: "0.9.4" });
    world.peer = { version: "0.9.3", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(
      world.calls.filter((call) => call === "start" || call === "stop"),
      ["stop", "start"],
    );
    assert.strictEqual(herdr.snapshot().version, "0.9.4");
    assert.deepStrictEqual(events, [
      { event: "upgraded", source: "peer", version: "0.9.4", fromVersion: "0.9.3", agents: 0 },
    ]);
    await herdr.tick();
    assert.strictEqual(count("start"), 1);
  });

  it("leaves a herdr that runs agents, says an upgrade waits, and upgrades when the last one ends", async () => {
    const { world, supervisor, events, count } = makeWorld({ bundledVersion: "0.9.4" });
    world.peer = { version: "0.9.3", agents: [agent("w1:p1")] };
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(
      [herdr.snapshot().version, herdr.snapshot().bundledVersion, herdr.snapshot().pendingUpgrade],
      ["0.9.3", "0.9.4", true],
    );
    assert.strictEqual(count("stop"), 0);
    await herdr.tick();
    assert.strictEqual(count("stop"), 0);

    world.peer.agents = [];
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().version, "0.9.4");
    assert.notProperty(herdr.snapshot(), "pendingUpgrade");
    assert.deepStrictEqual(
      events.map((event) => event.event),
      ["adopted", "upgraded"],
    );
  });

  it("never downgrades", async () => {
    const { world, supervisor, count } = makeWorld({ bundledVersion: "0.9.3" });
    world.peer = { version: "0.10.0", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(
      [herdr.snapshot().version, herdr.snapshot().state, herdr.snapshot().pendingUpgrade],
      ["0.10.0", "running", undefined],
    );
    assert.strictEqual(count("stop") + count("start"), 0);
  });

  it("leaves a herdr whose version it cannot compare", async () => {
    const { world, supervisor, count } = makeWorld();
    world.peer = { version: "nightly", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().version, "nightly");
    assert.strictEqual(count("stop") + count("start"), 0);
  });

  it("does not move a herdr it was told to leave off", async () => {
    const { world, supervisor, count } = makeWorld({ bundledVersion: "0.9.4" });
    world.peer = { version: "0.9.3", agents: [] };
    const herdr = supervisor({ bundled: false });
    await herdr.tick();
    assert.strictEqual(count("stop") + count("start"), 0);
  });

  it("does not upgrade the person's own herdr", async () => {
    const { world, supervisor, count } = makeWorld({ bundledVersion: "0.9.4" });
    world.own = { version: "0.9.1", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual([herdr.snapshot().source, herdr.snapshot().version], ["own", "0.9.1"]);
    assert.strictEqual(count("stop") + count("start"), 0);
  });

  it("tries an upgrade it could not make again only after a while", async () => {
    const { world, supervisor, count } = makeWorld({ bundledVersion: "0.9.4" });
    world.peer = { version: "0.9.3", agents: [] };
    world.stopFails = true;
    const herdr = supervisor();
    await herdr.tick();
    assert.deepStrictEqual(
      [herdr.snapshot().state, herdr.snapshot().version, herdr.snapshot().reason],
      ["running", "0.9.3", "herdr did not stop when asked."],
    );
    await herdr.tick();
    assert.strictEqual(count("stop"), 1);
    world.now += 31 * SECOND;
    world.stopFails = false;
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().version, "0.9.4");
  });
});

describe("ticks", () => {
  it("runs two ticks started together one after the other", async () => {
    const { world, supervisor } = makeWorld();
    world.own = { version: "0.9.3", agents: [] };
    const release = Promise.withResolvers<void>();
    world.gate = release.promise;
    const herdr = supervisor();
    const first = herdr.tick();
    const second = herdr.tick();
    // Let everything that can run, run: the first tick is held at its first pings.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    assert.deepStrictEqual(world.calls, ["ping own", "ping peer"]);
    release.resolve();
    await Promise.all([first, second]);
    assert.deepStrictEqual(world.calls.slice(0, 2), ["ping own", "ping peer"]);
    assert.deepStrictEqual(
      world.calls.filter((call) => call.startsWith("ping")).length,
      4,
      "the second tick looks only after the first has finished",
    );
  });

  it("runs a restart queued behind a tick after it", async () => {
    const { world, supervisor } = makeWorld();
    world.peer = { version: "0.9.3", agents: [] };
    const release = Promise.withResolvers<void>();
    world.gate = release.promise;
    const herdr = supervisor();
    const tick = herdr.tick();
    const restart = herdr.restart();
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    assert.strictEqual(world.calls.includes("stop"), false);
    release.resolve();
    await Promise.all([tick, restart]);
    assert.deepStrictEqual(
      world.calls.filter((call) => call === "stop" || call === "start"),
      ["stop", "start"],
    );
  });

  it("keeps ticking after a port that throws", async () => {
    const { world, supervisor } = makeWorld();
    world.own = { version: "0.9.3", agents: [] };
    const herdr = supervisor();
    await herdr.tick();
    world.broken = true;
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().source, "own", "the state stands");
    world.broken = false;
    world.own = null;
    await herdr.tick();
    assert.strictEqual(herdr.snapshot().source, "peer");
  });
});
