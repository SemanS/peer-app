// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off preferSchemaOverJson:off - runs the official herdr binary as real detached processes in temporary directories; waits are on the wall clock.
/**
 * Opt-in pass over the real `client/` modules with the official herdr binary, no model and no
 * network: `PEER_HERDR_REAL_BIN=<path to herdr> vp test run <this file>`. Without the variable the
 * file is skipped, so CI never runs it.
 *
 * Everything runs in fresh temporary directories: `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and
 * Peer's state directories. The process environment is replaced for the length of the run, so the
 * real `HerdrProcess` (which reads it on each call) and every herdr it starts see only those. Each
 * test stops the servers it started with `herdr --session <name> server stop`, and the cleanup
 * signals only a pid whose command line names one of this run's sessions.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { peerHerdrPaths } from "./binary.ts";
import { call, listHerdrAgents, pingHerdr } from "./herdr.ts";
import { realHerdrProcess, type HerdrProcessShape } from "./HerdrProcess.ts";
import { startHerdrAgent } from "./start.ts";
import { makeHerdrSupervisor, type HerdrRuntimeEvent } from "./supervisor.ts";
import { herdrAttachCommand } from "./terminal.ts";

const REAL_BIN = process.env.PEER_HERDR_REAL_BIN?.trim();

/** A native program named `claude` that draws an idle prompt and waits: herdr tells agents by it. */
const CLAUDE_FIXTURE = String.raw`
#include <signal.h>
#include <stdio.h>
#include <unistd.h>
int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("\x1b[2J\x1b[H");
  printf("Claude Code fixture\n\n");
  printf("\xe2\x95\xad\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x95\xae\n");
  printf("\xe2\x94\x82 > \xe2\x94\x82\n");
  printf("\xe2\x95\xb0\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x95\xaf\n");
  printf("  ? for shortcuts\n");
  for (;;) pause();
}
`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(
  what: string,
  read: () => Promise<T | undefined | false> | T | undefined | false,
  ms = 10_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

describe.skipIf(!REAL_BIN)("the real herdr", () => {
  const bin = REAL_BIN ?? "";
  const saved: NodeJS.ProcessEnv = { ...process.env };
  const realHome = NodeOS.userInfo().homedir;
  // Short paths: a Unix socket path must fit in about 100 bytes.
  let root = "";
  let home = "";
  let config = "";
  let workDir = "";
  let hasFixture = false;
  const stateDirs: Array<string> = [];
  const sessions = new Set<string>();

  const stateDir = (name: string): string => {
    const dir = NodePath.join(root, name);
    NodeFS.mkdirSync(dir, { recursive: true });
    stateDirs.push(dir);
    return dir;
  };

  /** A supervisor over the real process port, remembering the session so cleanup can stop it. */
  const supervisorFor = (dir: string, port: HerdrProcessShape = realHerdrProcess) => {
    const events: Array<HerdrRuntimeEvent> = [];
    const supervisor = makeHerdrSupervisor({ port, stateDir: dir, onEvent: (e) => events.push(e) });
    sessions.add(peerHerdrPaths(dir).session);
    return { supervisor, events, paths: peerHerdrPaths(dir) };
  };

  /** Pids whose command line is exactly this session's server, by `ps` (read only). */
  const serverPids = (session: string): Array<number> =>
    NodeChildProcess.execFileSync("ps", ["-o", "pid=,command=", "-ax"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes(`--session ${session} server`) && !line.includes(" stop"))
      .map((line) => Number(line.trim().split(/\s+/)[0]));

  const herdrCli = (session: string | undefined, ...args: string[]): string =>
    NodeChildProcess.execFileSync(
      bin,
      [...(session === undefined ? [] : ["--session", session]), ...args],
      { encoding: "utf8", env: process.env, cwd: home, stdio: ["ignore", "pipe", "pipe"] },
    );

  beforeAll(() => {
    // Short root so sockets fit: /tmp/ph.XXXXXX/cfg/herdr/sessions/peer-xxxxxxxx/herdr.sock.
    root = NodeFS.mkdtempSync("/tmp/ph.");
    home = NodePath.join(root, "home");
    config = NodePath.join(root, "cfg");
    workDir = NodePath.join(root, "work");
    const fixtureBin = NodePath.join(root, "bin");
    for (const dir of [home, config, workDir, fixtureBin, NodePath.join(root, "state")])
      NodeFS.mkdirSync(dir, { recursive: true });
    try {
      const source = NodePath.join(root, "claude.c");
      NodeFS.writeFileSync(source, CLAUDE_FIXTURE);
      NodeChildProcess.execFileSync("/usr/bin/cc", [
        "-o",
        NodePath.join(fixtureBin, "claude"),
        source,
      ]);
      hasFixture = true;
    } catch {
      hasFixture = false;
    }
    // Nothing of the person's: no herdr pointers, agent logins, Peer or Electron variables.
    for (const key of Object.keys(process.env))
      if (/^(HERDR_|ELECTRON_|T3CODE_|PEER_|CLAUDE|CODEX|ANTHROPIC|OPENAI|XDG_)/.test(key))
        delete process.env[key];
    Object.assign(process.env, {
      HOME: home,
      XDG_CONFIG_HOME: config,
      XDG_STATE_HOME: NodePath.join(root, "state"),
      PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: "/bin/zsh",
      TERM: "xterm-256color",
      PEER_HERDR_BIN: bin,
    });
  });

  afterAll(async () => {
    try {
      for (const session of sessions) {
        try {
          herdrCli(session, "server", "stop");
        } catch {
          // Not running.
        }
      }
      for (const session of sessions) {
        await until("a stopped server", () => serverPids(session).length === 0, 5_000).catch(() => {
          // `server stop` did not end it: SIGTERM only pids that name this run's sessions.
          for (const pid of serverPids(session)) process.kill(pid, "SIGTERM");
        });
      }
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
      if (root.startsWith("/tmp/ph.")) NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  const first = () => peerHerdrPaths(NodePath.join(root, "a"));

  it("keeps its files in the temporary directories", () => {
    const paths = first();
    assert.isTrue(paths.socketPath.startsWith(config));
    assert.isTrue(paths.socketPath.length < 100);
    assert.deepStrictEqual(realHerdrProcess.binary(), { available: true, path: bin });
  });

  it("starts by itself and answers within 15 seconds", async () => {
    const { supervisor, events, paths } = supervisorFor(stateDir("a"));
    const started = Date.now();
    await supervisor.tick();
    const took = Date.now() - started;
    const snapshot = supervisor.snapshot();
    assert.strictEqual(snapshot.state, "running");
    assert.strictEqual(snapshot.source, "peer");
    assert.strictEqual(snapshot.version, "0.9.3");
    assert.strictEqual(snapshot.bundledVersion, "0.9.3");
    assert.isBelow(took, 15_000);
    assert.strictEqual(supervisor.socketPath(), paths.socketPath);
    assert.deepStrictEqual(
      events.map((e) => e.event),
      ["started"],
    );
    assert.strictEqual(serverPids(paths.session).length, 1);
    assert.isTrue(NodeFS.existsSync(paths.configPath));
    // It lives in the temporary configuration directory, never in the person's.
    assert.isFalse(
      NodeFS.existsSync(NodePath.join(realHome, ".config", "herdr", "sessions", paths.session)),
    );
  }, 30_000);

  it("is adopted, not started again, by a second supervisor (a Peer restart)", async () => {
    const paths = first();
    const [pid] = serverPids(paths.session);
    const starts: Array<string> = [];
    const spy: HerdrProcessShape = {
      ...realHerdrProcess,
      start: (target) => {
        starts.push(target.paths.session);
        return realHerdrProcess.start(target);
      },
    };
    const { supervisor, events } = supervisorFor(NodePath.join(root, "a"), spy);
    await supervisor.tick();
    assert.strictEqual(supervisor.snapshot().state, "running");
    assert.strictEqual(supervisor.snapshot().source, "peer");
    assert.deepStrictEqual(starts, []);
    assert.deepStrictEqual(
      events.map((e) => e.event),
      ["adopted"],
    );
    assert.deepStrictEqual(serverPids(paths.session), [pid]);
  }, 30_000);

  it("answers an attach command that names Peer's session", async () => {
    const { supervisor, paths } = supervisorFor(NodePath.join(root, "a"));
    await supervisor.tick();
    const attach = supervisor.snapshot().attachCommand;
    assert.strictEqual(attach, herdrAttachCommand(bin, paths));
    const status = NodeChildProcess.execFileSync(
      "/bin/sh",
      ["-c", `${attach} status server --json`],
      { encoding: "utf8", env: process.env, cwd: home },
    );
    const report: unknown = JSON.parse(status);
    assert.strictEqual((report as { running?: unknown }).running, true);
    assert.strictEqual((report as { session?: unknown }).session, paths.session);
    assert.strictEqual((report as { socket?: unknown }).socket, paths.socketPath);
    // The same through the binary and session directly.
    const direct: unknown = JSON.parse(herdrCli(paths.session, "status", "server", "--json"));
    assert.strictEqual((direct as { running?: unknown }).running, true);
  }, 30_000);

  it("gives a second state directory a second session, both running", async () => {
    const one = supervisorFor(NodePath.join(root, "a"));
    const two = supervisorFor(stateDir("b"));
    await one.supervisor.tick();
    await two.supervisor.tick();
    assert.notStrictEqual(one.paths.session, two.paths.session);
    assert.notStrictEqual(one.paths.socketPath, two.paths.socketPath);
    assert.strictEqual(one.supervisor.snapshot().state, "running");
    assert.strictEqual(two.supervisor.snapshot().state, "running");
    assert.isNotNull(await pingHerdr(one.paths.socketPath));
    assert.isNotNull(await pingHerdr(two.paths.socketPath));
    assert.strictEqual(serverPids(one.paths.session).length, 1);
    assert.strictEqual(serverPids(two.paths.session).length, 1);
    // Stopping the second leaves the first.
    await two.supervisor.setBundled(false);
    assert.strictEqual(two.supervisor.snapshot().state, "off");
    assert.isNull(await pingHerdr(two.paths.socketPath));
    assert.deepStrictEqual(serverPids(two.paths.session), []);
    assert.isNotNull(await pingHerdr(one.paths.socketPath));
  }, 60_000);

  it("writes herdr's Claude Code integration only under the temporary HOME, and removes it", async () => {
    const listing = (dir: string): Array<string> =>
      (NodeFS.readdirSync(dir, { recursive: true }) as Array<string>)
        .map((entry) => NodePath.join(dir, entry))
        .toSorted();
    const realSettings = NodePath.join(realHome, ".claude", "settings.json");
    const realBefore = NodeFS.statSync(realSettings, { throwIfNoEntry: false })?.mtimeMs;
    const { supervisor } = supervisorFor(NodePath.join(root, "a"));
    await supervisor.tick();
    const target = supervisor.home();
    assert.isDefined(target);
    if (target === undefined) return;

    // No Claude Code folder yet: installing is refused and nothing is written.
    const before = listing(home);
    const refused = await realHerdrProcess.setIntegration(target, "claude", true);
    assert.isFalse(refused.ok);
    assert.deepStrictEqual(listing(home), before);

    NodeFS.mkdirSync(NodePath.join(home, ".claude"));
    const missing = await realHerdrProcess.integrations(target);
    assert.strictEqual(missing.find((i) => i.agent === "claude")?.state, "missing");

    const installed = await realHerdrProcess.setIntegration(target, "claude", true);
    assert.isTrue(installed.ok);
    const hook = NodePath.join(home, ".claude", "hooks", "herdr-agent-state.sh");
    assert.isTrue(NodeFS.existsSync(hook));
    assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".claude", "settings.json")));
    assert.include(
      NodeFS.readFileSync(NodePath.join(home, ".claude", "settings.json"), "utf8"),
      "herdr-agent-state.sh",
    );
    const files = (await realHerdrProcess.integrations(target)).find((i) => i.agent === "claude");
    assert.strictEqual(files?.state, "installed");
    // What the confirmation names is what was written.
    for (const file of files?.files ?? []) assert.isTrue(file.startsWith(home));
    for (const file of listing(home).filter((entry) => !before.includes(entry)))
      assert.isTrue(file.startsWith(NodePath.join(home, ".claude")), file);
    assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".codex")));

    const removed = await realHerdrProcess.setIntegration(target, "claude", false);
    assert.isTrue(removed.ok);
    assert.isFalse(NodeFS.existsSync(hook));
    const after = (await realHerdrProcess.integrations(target)).find((i) => i.agent === "claude");
    assert.strictEqual(after?.state, "missing");
    assert.notInclude(
      NodeFS.readFileSync(NodePath.join(home, ".claude", "settings.json"), "utf8"),
      "herdr-agent-state.sh",
    );
    // The person's own Claude Code settings were never touched.
    assert.strictEqual(
      NodeFS.statSync(realSettings, { throwIfNoEntry: false })?.mtimeMs,
      realBefore,
    );
  }, 60_000);

  it("ends with one server when two Peers start the same session at once", async () => {
    const dir = stateDir("c");
    const one = supervisorFor(dir);
    const two = supervisorFor(dir);
    await Promise.all([one.supervisor.tick(), two.supervisor.tick()]);
    assert.strictEqual(one.supervisor.snapshot().state, "running");
    assert.strictEqual(two.supervisor.snapshot().state, "running");
    await sleep(500);
    assert.strictEqual(serverPids(one.paths.session).length, 1);
    assert.isNotNull(await pingHerdr(one.paths.socketPath));
    await one.supervisor.setBundled(false);
    assert.deepStrictEqual(serverPids(one.paths.session), []);
  }, 60_000);

  it("keeps an agent running after the supervisor that started it is dropped, and restores the layout on Restart", async (context) => {
    if (!hasFixture) return context.skip();
    let current: ReturnType<typeof supervisorFor> | undefined = supervisorFor(
      NodePath.join(root, "a"),
    );
    await current.supervisor.tick();
    const { paths } = current;
    const started = await startHerdrAgent(
      { cwd: workDir, harness: "claude" },
      { socketPath: paths.socketPath, readyMs: 20_000 },
    );
    const agentsOf = async () => (await listHerdrAgents(paths.socketPath)) ?? [];
    const agent = (await agentsOf()).find((a) => a.paneId === started.paneId);
    assert.strictEqual(agent?.agent, "claude");
    const [pid] = serverPids(paths.session);

    // The supervisor that started it is gone; the detached server and its agent are not.
    current = undefined;
    await sleep(500);
    assert.deepStrictEqual(serverPids(paths.session), [pid]);
    assert.isTrue((await agentsOf()).some((a) => a.agent === "claude"));
    const later = supervisorFor(NodePath.join(root, "a"));
    await later.supervisor.tick();
    assert.strictEqual(later.supervisor.snapshot().agents, 1);
    assert.deepStrictEqual(serverPids(paths.session), [pid]);

    // Restart: a new server process; herdr writes `session.json` as it stops, and the layout
    // comes back from it.
    const sessionFile = NodePath.join(paths.sessionDir, "session.json");
    const labels = async () =>
      (
        (await call(paths.socketPath, "workspace.list", {})) as {
          workspaces?: ReadonlyArray<{ label?: string }>;
        }
      ).workspaces?.flatMap((w) => (w.label === undefined ? [] : [w.label])) ?? [];
    assert.include(await labels(), "Peer agents");
    await later.supervisor.restart();
    assert.strictEqual(later.supervisor.snapshot().state, "running");
    const [restarted] = serverPids(paths.session);
    assert.isDefined(restarted);
    assert.notStrictEqual(restarted, pid);
    assert.isTrue(NodeFS.existsSync(sessionFile));
    assert.include(await labels(), "Peer agents");
  }, 120_000);

  it("stops when turned off, and starts again when turned on", async () => {
    const { supervisor, paths } = supervisorFor(NodePath.join(root, "a"));
    await supervisor.tick();
    assert.strictEqual(supervisor.snapshot().state, "running");
    await supervisor.setBundled(false);
    assert.strictEqual(supervisor.snapshot().state, "off");
    assert.isNull(await pingHerdr(paths.socketPath));
    assert.deepStrictEqual(serverPids(paths.session), []);
    // Off stays off: a tick starts nothing.
    await supervisor.tick();
    assert.deepStrictEqual(serverPids(paths.session), []);
    await supervisor.setBundled(true);
    assert.strictEqual(supervisor.snapshot().state, "running");
    assert.strictEqual(serverPids(paths.session).length, 1);
    await supervisor.setBundled(false);
    assert.deepStrictEqual(serverPids(paths.session), []);
  }, 60_000);
});
