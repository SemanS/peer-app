// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off preferSchemaOverJson:off - Peer starts and stops herdr's server as a child process of this computer; its waits run on the wall clock and `status` answers a small JSON object read defensively.
/**
 * Peer's herdr server as a process: started detached so it outlives Peer, waited for until it
 * answers, stopped through herdr's own command, and asked who is attached.
 *
 * @module peerHub/plugins/herdr/client/server
 */
import * as NodeChild from "node:child_process";
import * as NodeOS from "node:os";

import type { PeerHerdrPaths } from "./binary.ts";
import { pingHerdr, type HerdrPing } from "./herdr.ts";

export interface HerdrCommandResult {
  /** The exit code, or null when the command could not run or ran out of time. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs herdr's binary to completion; tests give a stand-in. */
export type HerdrCommandRunner = (
  file: string,
  args: ReadonlyArray<string>,
  options: { readonly env: Readonly<Record<string, string>>; readonly timeoutMs?: number },
) => Promise<HerdrCommandResult>;

const COMMAND_TIMEOUT_MS = 15_000;

export const runHerdrCommand: HerdrCommandRunner = (file, args, options) =>
  new Promise((resolve) => {
    NodeChild.execFile(
      file,
      [...args],
      {
        env: { ...options.env },
        cwd: NodeOS.homedir(),
        timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        resolve({
          code: error === null ? 0 : typeof error.code === "number" ? error.code : null,
          stdout,
          stderr,
        }),
    );
  });

/** A herdr server process Peer started, which it may still stop by its pid. */
export interface HerdrSpawned {
  readonly pid: number;
  /** True once the process has ended, after which its pid is no longer ours to signal. */
  readonly exited: () => boolean;
}

export type HerdrStartResult =
  | {
      readonly ok: true;
      readonly version: string;
      /** Another server answered on the session's socket and this one gave way ("already running"). */
      readonly adopted: boolean;
      readonly spawned: HerdrSpawned | undefined;
    }
  | {
      readonly ok: false;
      readonly reasonClass: "spawn" | "exited" | "timeout";
      /** In words for a person; it names no path. */
      readonly reason: string;
      readonly spawned: HerdrSpawned | undefined;
    };

export interface StartHerdrServerInput {
  readonly bin: string;
  readonly paths: PeerHerdrPaths;
  /** The cleaned environment (`herdrServerEnv`), configuration file included. */
  readonly env: Readonly<Record<string, string>>;
  /** How long the server may take to answer; herdr restores a session before it does. */
  readonly readyMs?: number;
  readonly pollMs?: number;
  /**
   * How long a server that answers right away is given to be told "already running" and exit,
   * which is how a start learns that the answer was another server's.
   */
  readonly settleMs?: number;
  readonly ping?: (socketPath: string) => Promise<HerdrPing | null>;
  readonly spawn?: typeof NodeChild.spawn;
}

const READY_MS = 15_000;
const POLL_MS = 100;
const SETTLE_MS = 100;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Starts `herdr --session <name> server` the way herdr's own launcher does: in the person's home,
 * its own session, no terminal, `unref`ed so it survives Peer. Resolves once the server answers.
 *
 * A second server on the same socket exits with "already running"; when something answers by then
 * that is adoption, not failure, so two Peers racing on one session both end up with one herdr.
 */
export async function startHerdrServer(input: StartHerdrServerInput): Promise<HerdrStartResult> {
  const ping = input.ping ?? pingHerdr;
  const readyMs = input.readyMs ?? READY_MS;
  const pollMs = input.pollMs ?? POLL_MS;
  const spawn = input.spawn ?? NodeChild.spawn;

  let exitCode: number | null | undefined;
  let spawnError: string | undefined;
  const exit = Promise.withResolvers<void>();
  const child = spawn(input.bin, ["--session", input.paths.session, "server"], {
    cwd: NodeOS.homedir(),
    env: { ...input.env },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    spawnError = error.code ?? "unknown";
  });
  // `exit` fires with a code, or with null and a signal; both mean the server is gone.
  child.on("exit", (code) => {
    exitCode = code ?? -1;
    exit.resolve();
  });
  child.unref();
  const spawned: HerdrSpawned | undefined =
    child.pid === undefined ? undefined : { pid: child.pid, exited: () => exitCode !== undefined };

  const deadline = Date.now() + readyMs;
  for (;;) {
    const answer = await ping(input.paths.socketPath);
    if (answer !== null) {
      if (exitCode === undefined)
        await Promise.race([exit.promise, sleep(input.settleMs ?? SETTLE_MS)]);
      return {
        ok: true,
        version: answer.version,
        adopted: exitCode !== undefined && exitCode !== 0,
        spawned,
      };
    }
    if (spawnError !== undefined)
      return {
        ok: false,
        reasonClass: "spawn",
        reason: `herdr could not be started (${spawnError}).`,
        spawned: undefined,
      };
    if (exitCode !== undefined) {
      // The other server may only now be answering; look once more before calling this a failure.
      const late = await ping(input.paths.socketPath);
      if (late !== null) return { ok: true, version: late.version, adopted: true, spawned };
      return {
        ok: false,
        reasonClass: "exited",
        reason: `herdr exited right after it started (code ${exitCode}).`,
        spawned,
      };
    }
    if (Date.now() >= deadline)
      return {
        ok: false,
        reasonClass: "timeout",
        reason: `herdr did not answer within ${Math.round(readyMs / 1000)} seconds.`,
        spawned,
      };
    await sleep(pollMs);
  }
}

export interface StopHerdrServerInput {
  readonly bin: string;
  readonly paths: PeerHerdrPaths;
  readonly env: Readonly<Record<string, string>>;
  /** The process Peer started, when it did: signalled if `server stop` does not end it. */
  readonly spawned?: HerdrSpawned | undefined;
  /** How long to wait for the server to go quiet after each way of asking it to. */
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly run?: HerdrCommandRunner;
  readonly ping?: (socketPath: string) => Promise<HerdrPing | null>;
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
}

export type HerdrStopResult =
  | { readonly stopped: true }
  | { readonly stopped: false; readonly reason: string };

const STOP_WAIT_MS = 10_000;

/**
 * Stops the server through `herdr --session <name> server stop`, which ends its panes' processes
 * too. When that does not end it, SIGTERM goes to the process Peer started, never to any other.
 */
export async function stopHerdrServer(input: StopHerdrServerInput): Promise<HerdrStopResult> {
  const ping = input.ping ?? pingHerdr;
  const run = input.run ?? runHerdrCommand;
  const kill = input.kill ?? process.kill.bind(process);
  const waitMs = input.waitMs ?? STOP_WAIT_MS;
  const pollMs = input.pollMs ?? POLL_MS;
  const gone = async (): Promise<boolean> => {
    const deadline = Date.now() + waitMs;
    for (;;) {
      if ((await ping(input.paths.socketPath)) === null) return true;
      if (Date.now() >= deadline) return false;
      await sleep(pollMs);
    }
  };

  if ((await ping(input.paths.socketPath)) !== null) {
    await run(input.bin, ["--session", input.paths.session, "server", "stop"], {
      env: input.env,
      timeoutMs: waitMs,
    });
    if (await gone()) return { stopped: true };
  }
  // A server that never answered may still be a process of ours stuck in starting.
  const { spawned } = input;
  if (spawned !== undefined && !spawned.exited()) {
    try {
      kill(spawned.pid, "SIGTERM");
    } catch {
      // It ended on its own between the check and the signal.
    }
    if (await gone()) return { stopped: true };
  }
  return (await ping(input.paths.socketPath)) === null
    ? { stopped: true }
    : { stopped: false, reason: "herdr did not stop when asked." };
}

function jsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The version of the binary itself, from `herdr status client --json`. */
export async function readHerdrBinaryVersion(input: {
  readonly bin: string;
  readonly env: Readonly<Record<string, string>>;
  readonly run?: HerdrCommandRunner;
}): Promise<string | undefined> {
  const result = await (input.run ?? runHerdrCommand)(input.bin, ["status", "client", "--json"], {
    env: input.env,
  });
  const version = result.code === 0 ? jsonObject(result.stdout)?.version : undefined;
  return typeof version === "string" && version !== "" ? version : undefined;
}

/** How many clients are attached to a number of places herdr might report them. */
function clientCount(report: Record<string, unknown>): number | undefined {
  for (const key of ["clients", "attached_clients", "client_count", "attached"]) {
    const value = report[key];
    if (Array.isArray(value)) return value.length;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return undefined;
}

/**
 * How many terminal clients are attached to Peer's herdr, or "unknown". herdr 0.9.3's
 * `status client --json` describes the local binary (version, protocol, session) and reports no
 * attached clients, so with it this answers "unknown"; a herdr that adds a list or a count under
 * one of the usual names is understood without a change here. Callers treat "unknown" as not
 * knowing, never as zero.
 */
export async function readHerdrAttachedClients(input: {
  readonly bin: string;
  readonly paths: PeerHerdrPaths;
  readonly env: Readonly<Record<string, string>>;
  readonly run?: HerdrCommandRunner;
}): Promise<number | "unknown"> {
  const result = await (input.run ?? runHerdrCommand)(
    input.bin,
    ["--session", input.paths.session, "status", "client", "--json"],
    { env: input.env },
  );
  if (result.code !== 0) return "unknown";
  const report = jsonObject(result.stdout);
  if (report === undefined) return "unknown";
  const nested = report.client;
  return (
    clientCount(report) ??
    (typeof nested === "object" && nested !== null
      ? clientCount(nested as Record<string, unknown>)
      : undefined) ??
    "unknown"
  );
}
