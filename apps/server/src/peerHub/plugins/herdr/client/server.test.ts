// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off preferSchemaOverJson:off - a fixture executable standing in for herdr's server, which runs as a real detached process on a Unix socket in a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";

import { herdrServerEnv, peerHerdrPaths, type PeerHerdrPaths } from "./binary.ts";
import { pingHerdr } from "./herdr.ts";
import {
  readHerdrAttachedClients,
  readHerdrBinaryVersion,
  startHerdrServer,
  stopHerdrServer,
  type HerdrCommandRunner,
  type HerdrSpawned,
} from "./server.ts";

/**
 * A stand-in for `herdr`: `--session <name> server` listens on the session's socket and answers
 * `ping`, exits 1 with herdr's "already running" when something listens already, and
 * `server stop` asks the listener to end. `FIXTURE_MODE` makes it misbehave:
 * `hang` never listens, `exit` fails at once, `stubborn` ignores `server.stop`.
 */
const FIXTURE = `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const at = args.indexOf("--session");
const session = at >= 0 ? args[at + 1] : undefined;
const rest = args.filter((_, index) => index !== at && index !== at + 1);
const base = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr");
const dir = session ? path.join(base, "sessions", session) : base;
const socketPath = path.join(dir, "herdr.sock");
const mode = process.env.FIXTURE_MODE || "serve";
const version = process.env.FIXTURE_VERSION || "0.9.3";

if (rest[0] === "server" && rest[1] === "stop") {
  const client = net.connect(socketPath);
  client.on("connect", () => client.write(JSON.stringify({ id: "stop", method: "server.stop", params: {} }) + "\\n"));
  client.on("data", () => process.exit(0));
  client.on("error", () => {
    console.error("herdr server is not running");
    process.exit(1);
  });
} else if (rest[0] === "server") {
  if (mode === "exit") {
    console.error("fixture: failing on purpose");
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "started.json"),
    JSON.stringify({ pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2), env: process.env }),
  );
  if (mode === "hang") {
    setInterval(() => undefined, 1000);
  } else {
    const probe = net.connect(socketPath);
    probe.on("connect", () => {
      console.error("error: herdr server is already running");
      process.exit(1);
    });
    probe.on("error", () => {
      fs.rmSync(socketPath, { force: true });
      const server = net.createServer((socket) => {
        let buffer = "";
        socket.on("error", () => undefined);
        socket.on("data", (chunk) => {
          buffer += chunk;
          for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
            const request = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (request.method === "ping") {
              socket.write(JSON.stringify({ id: request.id, result: { type: "pong", version, protocol: 22, capabilities: [] } }) + "\\n");
            } else if (request.method === "server.stop") {
              socket.write(JSON.stringify({ id: request.id, result: { type: "ok" } }) + "\\n");
              if (mode !== "stubborn") setTimeout(() => process.exit(0), 5);
            }
          }
        });
      });
      server.listen(socketPath);
      process.on("SIGTERM", () => {
        fs.rmSync(socketPath, { force: true });
        process.exit(0);
      });
    });
  }
} else if (rest[0] === "status") {
  process.stdout.write(process.env.FIXTURE_STATUS || JSON.stringify({ version, session: session || null }));
}
`;

const scratch: Array<string> = [];
const spawnedPids: Array<number> = [];
afterEach(() => {
  // Only processes these tests spawned; each is signalled by the pid the spawn returned.
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  for (const dir of scratch.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** A fixture herdr with a session of its own; sockets stay short, as macOS limits their length. */
function setup(extraEnv: Record<string, string> = {}) {
  const root = NodeFS.mkdtempSync(
    NodePath.join(NodeFS.existsSync("/tmp") ? "/tmp" : NodeOS.tmpdir(), "ph-"),
  );
  scratch.push(root);
  const bin = NodePath.join(root, "herdr");
  NodeFS.writeFileSync(bin, FIXTURE, { mode: 0o755 });
  NodeFS.chmodSync(bin, 0o755);
  const xdg = NodePath.join(root, "x");
  const paths: PeerHerdrPaths = peerHerdrPaths(NodePath.join(root, "state"), {
    XDG_CONFIG_HOME: xdg,
  });
  const env = herdrServerEnv(
    {
      PATH: process.env.PATH,
      HOME: NodeOS.homedir(),
      XDG_CONFIG_HOME: xdg,
      ELECTRON_RUN_AS_NODE: "1",
      T3CODE_HOME: "/peer/home",
      ...extraEnv,
    },
    { configPath: paths.configPath, platform: "darwin" },
  );
  const remember = (spawned: HerdrSpawned | undefined) => {
    if (spawned !== undefined) spawnedPids.push(spawned.pid);
  };
  return { root, bin, paths, env, remember };
}

const fast = { pollMs: 10, settleMs: 20 };

describe("startHerdrServer", () => {
  it("starts a detached server in its own session and returns once it answers", async () => {
    const herdr = setup();
    const started = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(started.ok, true);
    if (!started.ok) return;
    herdr.remember(started.spawned);
    assert.strictEqual(started.version, "0.9.3");
    assert.strictEqual(started.adopted, false);
    assert.strictEqual((await pingHerdr(herdr.paths.socketPath))?.protocol, 22);

    const record = JSON.parse(
      NodeFS.readFileSync(NodePath.join(herdr.paths.sessionDir, "started.json"), "utf8"),
    );
    assert.deepStrictEqual(record.argv, ["--session", herdr.paths.session, "server"]);
    assert.strictEqual(record.cwd, NodeOS.homedir());
    assert.strictEqual(record.pid, started.spawned?.pid);
    assert.strictEqual(record.env.HERDR_CONFIG_PATH, herdr.paths.configPath);
    assert.strictEqual(record.env.HERDR_MACOS_SERVER_CONTEXT, "user");
    assert.notProperty(record.env, "ELECTRON_RUN_AS_NODE");
    assert.notProperty(record.env, "T3CODE_HOME");
    assert.isString(record.env.PATH);
  });

  it("leaves the server running when Peer lets go of the process", async () => {
    const herdr = setup();
    const started = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(started.ok, true);
    if (!started.ok) return;
    herdr.remember(started.spawned);
    // Nothing of the child is kept: the result holds a pid and a flag, not the process handle.
    const pid = started.spawned?.pid ?? 0;
    assert.isAbove(pid, 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(started.spawned?.exited(), false);
    assert.doesNotThrow(() => process.kill(pid, 0));
    assert.isNotNull(await pingHerdr(herdr.paths.socketPath));
  });

  it("counts a second server giving way to the first as ready", async () => {
    const herdr = setup();
    const first = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(first.ok, true);
    if (first.ok) herdr.remember(first.spawned);

    // The first server answers at once; the second exits within the time it is given to.
    const second = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
      settleMs: 5000,
    });
    assert.strictEqual(second.ok, true);
    if (!second.ok) return;
    herdr.remember(second.spawned);
    assert.strictEqual(second.adopted, true);
    assert.isNotNull(await pingHerdr(herdr.paths.socketPath));
  });

  it("fails with a reason when the server exits and nothing else answers", async () => {
    const herdr = setup({ FIXTURE_MODE: "exit" });
    const started = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(started.ok, false);
    if (started.ok) return;
    assert.strictEqual(started.reasonClass, "exited");
    assert.match(started.reason, /exited right after it started \(code 1\)/);
  });

  it("gives up with a reason when the server never answers, leaving it alone", async () => {
    const herdr = setup({ FIXTURE_MODE: "hang" });
    const started = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      readyMs: 300,
      ...fast,
    });
    herdr.remember(started.spawned);
    assert.strictEqual(started.ok, false);
    if (started.ok) return;
    assert.strictEqual(started.reasonClass, "timeout");
    assert.match(started.reason, /did not answer within/);
    assert.strictEqual(started.spawned?.exited(), false, "a slow server is not killed");
  });

  it("fails with a reason when the binary cannot be run", async () => {
    const herdr = setup();
    const started = await startHerdrServer({
      bin: NodePath.join(herdr.root, "missing"),
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(started.ok, false);
    if (started.ok) return;
    assert.strictEqual(started.reasonClass, "spawn");
    assert.match(started.reason, /ENOENT/);
    assert.notInclude(started.reason, herdr.root);
  });
});

describe("stopHerdrServer", () => {
  it("stops the server through `server stop`", async () => {
    const herdr = setup();
    const started = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(started.ok, true);
    if (!started.ok) return;
    herdr.remember(started.spawned);
    const commands: Array<ReadonlyArray<string>> = [];
    const run: HerdrCommandRunner = async (file, args, options) => {
      commands.push([file, ...args]);
      return (await import("./server.ts")).runHerdrCommand(file, args, options);
    };
    const stopped = await stopHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      spawned: started.spawned,
      run,
      ...fast,
    });
    assert.deepStrictEqual(stopped, { stopped: true });
    assert.deepStrictEqual(commands, [
      [herdr.bin, "--session", herdr.paths.session, "server", "stop"],
    ]);
    assert.strictEqual(await pingHerdr(herdr.paths.socketPath), null);
  });

  it("signals the process it started when `server stop` does not end it", async () => {
    const herdr = setup({ FIXTURE_MODE: "stubborn" });
    const started = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(started.ok, true);
    if (!started.ok) return;
    herdr.remember(started.spawned);
    const signals: Array<readonly [number, NodeJS.Signals]> = [];
    const stopped = await stopHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      spawned: started.spawned,
      waitMs: 200,
      kill: (pid, signal) => {
        signals.push([pid, signal]);
        process.kill(pid, signal);
      },
      ...fast,
    });
    assert.deepStrictEqual(stopped, { stopped: true });
    assert.deepStrictEqual(signals, [[started.spawned?.pid ?? 0, "SIGTERM"]]);
  });

  it("does not signal a pid it did not start, and reports a server that stays up", async () => {
    const herdr = setup({ FIXTURE_MODE: "stubborn" });
    const started = await startHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      ...fast,
    });
    assert.strictEqual(started.ok, true);
    if (!started.ok) return;
    herdr.remember(started.spawned);
    const stopped = await stopHerdrServer({
      bin: herdr.bin,
      paths: herdr.paths,
      env: herdr.env,
      waitMs: 100,
      kill: () => assert.fail("no pid is known"),
      ...fast,
    });
    assert.deepStrictEqual(stopped, { stopped: false, reason: "herdr did not stop when asked." });
  });

  it("has nothing to do when no server answers and none is ours", async () => {
    const herdr = setup();
    const run: HerdrCommandRunner = () => assert.fail("nothing to stop");
    assert.deepStrictEqual(
      await stopHerdrServer({ bin: herdr.bin, paths: herdr.paths, env: herdr.env, run, ...fast }),
      { stopped: true },
    );
  });

  it("never signals a process that already ended", async () => {
    const herdr = setup();
    const gone: HerdrSpawned = { pid: 2 ** 22, exited: () => true };
    assert.deepStrictEqual(
      await stopHerdrServer({
        bin: herdr.bin,
        paths: herdr.paths,
        env: herdr.env,
        spawned: gone,
        kill: () => assert.fail("a finished process is not ours to signal"),
        ...fast,
      }),
      { stopped: true },
    );
  });
});

describe("herdr status", () => {
  const answering =
    (stdout: string, code: number | null = 0): HerdrCommandRunner =>
    async () => ({ code, stdout, stderr: "" });
  const input = () => {
    const herdr = setup();
    return { bin: herdr.bin, paths: herdr.paths, env: herdr.env };
  };

  it("reads the binary's version", async () => {
    const run = answering(JSON.stringify({ version: "0.9.3", channel: "stable", protocol: 22 }));
    assert.strictEqual(await readHerdrBinaryVersion({ ...input(), run }), "0.9.3");
    assert.strictEqual(
      await readHerdrBinaryVersion({ ...input(), run: answering("nope") }),
      undefined,
    );
    assert.strictEqual(
      await readHerdrBinaryVersion({ ...input(), run: answering("{}", 1) }),
      undefined,
    );
  });

  it("counts attached clients from a list or a number, wherever herdr puts them", async () => {
    const count = (report: unknown) =>
      readHerdrAttachedClients({ ...input(), run: answering(JSON.stringify(report)) });
    assert.strictEqual(await count({ clients: [{ id: 1 }, { id: 2 }] }), 2);
    assert.strictEqual(await count({ clients: [] }), 0);
    assert.strictEqual(await count({ client_count: 3 }), 3);
    assert.strictEqual(await count({ client: { attached_clients: 1 } }), 1);
  });

  it("says unknown for what it cannot read, as herdr 0.9.3's client status is", async () => {
    // The shape `herdr status client --json` has in 0.9.3: the local binary, no attached clients.
    const observed = {
      version: "0.9.3",
      channel: "stable",
      protocol: 22,
      endpoint_protocol_generation: 1,
      endpoint_capabilities: ["surface_interest", "presentation_effects_fence", "health_check"],
      remote_host_bridge: true,
      remote_bridge_idle_timeout: true,
      binary: "/Applications/Peer.app/Contents/Resources/herdr/herdr",
      session: "peer-01234567",
    };
    const unknown = async (run: HerdrCommandRunner) =>
      readHerdrAttachedClients({ ...input(), run });
    assert.strictEqual(await unknown(answering(JSON.stringify(observed))), "unknown");
    assert.strictEqual(await unknown(answering("not json")), "unknown");
    assert.strictEqual(await unknown(answering("[]")), "unknown");
    assert.strictEqual(await unknown(answering(JSON.stringify({ clients: "two" }))), "unknown");
    assert.strictEqual(await unknown(answering("{}", 1)), "unknown");
    assert.strictEqual(await unknown(answering("", null)), "unknown");
  });

  it("asks the session's own client status", async () => {
    const seen: Array<ReadonlyArray<string>> = [];
    const herdr = input();
    await readHerdrAttachedClients({
      ...herdr,
      run: async (file, args) => {
        seen.push([file, ...args]);
        return { code: 0, stdout: "{}", stderr: "" };
      },
    });
    assert.deepStrictEqual(seen, [
      [herdr.bin, "--session", herdr.paths.session, "status", "client", "--json"],
    ]);
  });
});
