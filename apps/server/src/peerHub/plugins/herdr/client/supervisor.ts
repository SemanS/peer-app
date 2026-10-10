/**
 * Which herdr serves this computer, and keeping Peer's own running when it should: the person's
 * herdr wins, Peer's bundled one fills in, and a herdr that runs agents is never taken away
 * unasked.
 *
 * Plain async code over the `HerdrProcess` port and a clock. A tick looks at both sockets and
 * moves the state one step; every transition runs one at a time.
 *
 * @module peerHub/plugins/herdr/client/supervisor
 */
import type { PeerHerdrRuntime } from "@t3tools/contracts";

import { compareHerdrVersions, type PeerHerdrPaths } from "./binary.ts";
import type { HerdrAgent, HerdrPing } from "./herdr.ts";
import type { HerdrHome, HerdrProcessShape } from "./HerdrProcess.ts";
import type { HerdrSpawned, HerdrStartResult } from "./server.ts";

/** How often the supervisor looks, unless a retry is due sooner. */
export const HERDR_TICK_MS = 5_000;
/** Waits before the next attempt after the first, second and third failure. */
export const HERDR_BACKOFF_MS: ReadonlyArray<number> = [1_000, 5_000, 30_000];
/** Failures within this window, this many of them, stop the attempts. */
export const HERDR_FAILURE_WINDOW_MS = 10 * 60_000;
export const HERDR_FAILURES_BEFORE_FAILED = 3;
/** After a herdr would not stop for an upgrade, the upgrade is not tried again for this long. */
const UPGRADE_RETRY_MS = 30_000;

/** What happened to Peer's herdr, for the coordination log: classes and counts, never content. */
export interface HerdrRuntimeEvent {
  readonly event: "started" | "adopted" | "stopped" | "restarted" | "upgraded" | "failed";
  readonly source: "own" | "peer";
  readonly version?: string;
  readonly fromVersion?: string;
  readonly agents: number;
  readonly reasonClass?: string;
}

export interface HerdrSupervisorOptions {
  readonly port: HerdrProcessShape;
  /** The Peer server's state directory, which names Peer's herdr session. */
  readonly stateDir: string;
  /** Whether Peer may run its own herdr; the owner's setting, on by default. */
  readonly bundled?: boolean;
  readonly now?: () => number;
  /** Called with the new snapshot after each change, never for a tick that changed nothing. */
  readonly onChange?: (snapshot: PeerHerdrRuntime) => void;
  readonly onEvent?: (event: HerdrRuntimeEvent) => void;
}

export interface HerdrSupervisor {
  /** The state to show now. */
  readonly snapshot: () => PeerHerdrRuntime;
  /** The socket every herdr call goes to now: Peer's while it serves, else the person's. */
  readonly socketPath: () => string;
  /** Peer's herdr, when this computer has a binary for it: for its terminal and integrations. */
  readonly home: () => HerdrHome | undefined;
  readonly bundled: () => boolean;
  /** One look at both herdrs and at most one step; ticks and changes never overlap. */
  readonly tick: () => Promise<void>;
  /** Turns Peer's own herdr on or off. Off stops it, agents and all; the caller has confirmed. */
  readonly setBundled: (on: boolean) => Promise<void>;
  /** Stops Peer's herdr and starts it again on the bundled version, clearing past failures. */
  readonly restart: () => Promise<void>;
  /**
   * Stops Peer's herdr if it runs no agents (the herdr plugin was turned off): true when none of
   * Peer's runs afterwards. One that runs agents, or cannot list them, is left running. Nothing is
   * started again until the next tick.
   */
  readonly stopIfIdle: () => Promise<boolean>;
  /** How long until the next tick is due: `HERDR_TICK_MS`, or less when a retry comes sooner. */
  readonly nextDelayMs: () => number;
}

/** What a tick learned about one herdr that answered. */
interface Seen {
  readonly ping: HerdrPing;
  readonly agents: ReadonlyArray<HerdrAgent> | null;
}

/** Agents herdr can bring back after a restart: Claude Code or Codex with their session reported. */
function resumableCount(agents: ReadonlyArray<HerdrAgent>): number {
  return agents.filter(
    (agent) => agent.session !== undefined && (agent.agent === "claude" || agent.agent === "codex"),
  ).length;
}

/** A herdr that runs agents, or whose agents cannot be listed, is not idle. */
const isBusy = (seen: Seen): boolean => seen.agents === null || seen.agents.length > 0;

export function makeHerdrSupervisor(options: HerdrSupervisorOptions): HerdrSupervisor {
  const { port } = options;
  const now = options.now ?? Date.now;
  const binary = port.binary();
  const paths: PeerHerdrPaths = port.paths(options.stateDir);
  const home: HerdrHome | undefined = binary.available ? { bin: binary.path, paths } : undefined;

  let bundled = options.bundled ?? true;
  // Fields of the snapshot.
  let source: PeerHerdrRuntime["source"] = "none";
  let state: PeerHerdrRuntime["state"] =
    home === undefined ? "unavailable" : bundled ? "starting" : "off";
  let version: string | undefined;
  let bundledVersion: string | undefined;
  let bundledVersionKnown = false;
  let agents = 0;
  let resumable = 0;
  let pendingUpgrade = false;
  let otherRunning = false;
  let notice: string | undefined;
  // Bookkeeping.
  let failures: Array<number> = [];
  let failed = false;
  let lastFailure: string | undefined;
  let nextAttemptAt = 0;
  let upgradeAfter = 0;
  let peerUp = false;
  let spawned: HerdrSpawned | undefined;
  let nextStart: "started" | "restarted" = "started";
  let used: "own" | "peer" | "none" = "none";
  let published = "";

  const snapshot = (): PeerHerdrRuntime => ({
    source,
    state,
    agents,
    resumable,
    otherRunning,
    ...(version === undefined ? {} : { version }),
    ...(bundledVersion === undefined ? {} : { bundledVersion }),
    ...(pendingUpgrade ? { pendingUpgrade: true } : {}),
    ...(state === "unavailable" && binary.available === false ? { reason: binary.reason } : {}),
    ...(notice === undefined ? {} : { reason: notice }),
    ...(state === "failed" && home !== undefined ? { log: paths.logPath } : {}),
    ...(source === "peer" && state === "running" && home !== undefined
      ? { attachCommand: port.attachCommand(home) }
      : {}),
  });

  const publish = () => {
    const current = snapshot();
    const key = JSON.stringify(current);
    if (key === published) return;
    published = key;
    options.onChange?.(current);
  };

  const emit = (event: HerdrRuntimeEvent) => options.onEvent?.(event);

  const socketPath = () =>
    source === "peer" && state === "running" && home !== undefined
      ? paths.socketPath
      : port.ownSocketPath();

  /** Something works: past failures no longer stop the attempts, though they still count. */
  const recover = () => {
    failed = false;
    nextAttemptAt = 0;
  };

  /** Sets the state to a herdr that serves. */
  const serve = (
    which: "own" | "peer",
    seen: Seen,
    extra: { readonly pending?: boolean; readonly other?: boolean; readonly notice?: string } = {},
  ) => {
    source = which;
    state = "running";
    version = seen.ping.version;
    agents = seen.agents?.length ?? 0;
    resumable = seen.agents === null ? 0 : resumableCount(seen.agents);
    pendingUpgrade = extra.pending ?? false;
    otherRunning = extra.other ?? false;
    notice = extra.notice;
    // A herdr this supervisor did not start has come into use.
    if (used !== which)
      emit({ event: "adopted", source: which, version: seen.ping.version, agents });
    used = which;
    recover();
  };

  const recordFailure = (reasonClass: string, reason: string) => {
    const at = now();
    failures = [...failures.filter((time) => at - time < HERDR_FAILURE_WINDOW_MS), at];
    lastFailure = reason;
    nextAttemptAt =
      at + (HERDR_BACKOFF_MS[Math.min(failures.length, HERDR_BACKOFF_MS.length) - 1] ?? 0);
    if (failures.length >= HERDR_FAILURES_BEFORE_FAILED && !failed) {
      failed = true;
      emit({ event: "failed", source: "peer", agents: 0, reasonClass });
    }
  };

  const clearFailures = () => {
    failures = [];
    failed = false;
    lastFailure = undefined;
    nextAttemptAt = 0;
  };

  const attemptsAllowed = () => !failed && now() >= nextAttemptAt;

  const bundledVersionOf = async (): Promise<string | undefined> => {
    if (!bundledVersionKnown && home !== undefined) {
      bundledVersionKnown = true;
      bundledVersion = await port.binaryVersion(home.bin, paths).catch(() => undefined);
    }
    return bundledVersion;
  };

  /** Peer's herdr is older than the bundled one. Unknown versions are left alone. */
  const olderThanBundled = (running: string): boolean => {
    const order =
      bundledVersion === undefined ? null : compareHerdrVersions(running, bundledVersion);
    return order !== null && order < 0;
  };

  const look = async (socket: string): Promise<Seen | null> => {
    const ping = await port.ping(socket);
    return ping === null ? null : { ping, agents: await port.agents(socket) };
  };

  /**
   * Stops Peer's herdr. One that will not stop stays in use, and the reason comes back. Only a
   * herdr given up for the person's, or turned off, is logged as stopped: a restart and an upgrade
   * are logged by the start that follows.
   */
  const stopPeer = async (
    seen: Seen,
    reasonClass: "superseded" | "turned-off" | "restart" | "upgrade",
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> => {
    if (home === undefined) return { ok: true };
    const before = { state, source };
    source = "peer";
    state = "stopping";
    publish();
    const result = await port
      .stop(home, spawned)
      .catch((): { readonly stopped: false; readonly reason: string } => ({
        stopped: false,
        reason: "herdr did not stop when asked.",
      }));
    if (!result.stopped) {
      ({ state, source } = before);
      return { ok: false, reason: result.reason };
    }
    peerUp = false;
    spawned = undefined;
    notice = undefined;
    if (used === "peer") used = "none";
    if (reasonClass === "superseded" || reasonClass === "turned-off")
      emit({
        event: "stopped",
        source: "peer",
        version: seen.ping.version,
        agents: seen.agents?.length ?? 0,
        reasonClass,
      });
    return { ok: true };
  };

  /** Starts Peer's herdr; the state afterwards says whether it serves. */
  const startPeer = async (kind: HerdrRuntimeEvent["event"], fromVersion?: string) => {
    if (home === undefined) return;
    source = "peer";
    state = "starting";
    version = undefined;
    agents = 0;
    resumable = 0;
    pendingUpgrade = false;
    notice = lastFailure;
    publish();
    // A start that never answered may still be a process of ours; two would fight for the socket.
    if (spawned !== undefined && !spawned.exited())
      await port.stop(home, spawned).catch(() => undefined);
    spawned = undefined;
    const result: HerdrStartResult = await port.start(home).catch((): HerdrStartResult => ({
      ok: false,
      reasonClass: "spawn",
      reason: "herdr could not be started.",
      spawned: undefined,
    }));
    spawned = result.spawned ?? spawned;
    if (!result.ok) {
      recordFailure(result.reasonClass, result.reason);
      peerUp = false;
      return;
    }
    peerUp = true;
    const seen = await look(paths.socketPath);
    // Gone again already: the next tick finds out.
    if (seen === null) return;
    // This supervisor started it, so serving it is not an adoption of someone else's herdr.
    used = "peer";
    serve("peer", seen);
    emit({
      event: result.adopted ? "adopted" : kind,
      source: "peer",
      version: seen.ping.version,
      ...(fromVersion === undefined ? {} : { fromVersion }),
      agents: seen.agents?.length ?? 0,
    });
  };

  /** No herdr serves: say which of the quiet states this is. */
  const idle = () => {
    source = "none";
    version = undefined;
    agents = 0;
    resumable = 0;
    pendingUpgrade = false;
    otherRunning = false;
    used = "none";
    if (home === undefined) {
      state = "unavailable";
      notice = undefined;
    } else if (!bundled) {
      state = "off";
      notice = undefined;
    } else if (failed) {
      state = "failed";
      notice = lastFailure;
    } else {
      state = "starting";
      notice = lastFailure;
    }
  };

  const evaluate = async () => {
    await bundledVersionOf();
    const ownSocket = port.ownSocketPath();
    // The person's variables can point at Peer's own socket (Peer started in one of its panes).
    const ownIsPeers = home !== undefined && ownSocket === paths.socketPath;
    const [own, peer] = await Promise.all([
      ownIsPeers ? null : look(ownSocket),
      home === undefined ? null : look(paths.socketPath),
    ]);

    // 1. Peer's herdr runs agents: keep using it, whatever else answers.
    if (peer !== null && isBusy(peer)) {
      peerUp = true;
      serve("peer", peer, {
        other: own !== null,
        pending: bundled && olderThanBundled(peer.ping.version),
      });
      return;
    }
    // 2. The person's own herdr serves; an idle one of Peer's gives way.
    if (own !== null) {
      if (peer !== null) await stopPeer(peer, "superseded");
      peerUp = false;
      serve("own", own);
      return;
    }
    // 3. Peer's idle herdr serves, moved to the bundled version when that is newer.
    if (peer !== null) {
      peerUp = true;
      let stuck: string | undefined;
      if (
        bundled &&
        olderThanBundled(peer.ping.version) &&
        attemptsAllowed() &&
        now() >= upgradeAfter
      ) {
        const stopped = await stopPeer(peer, "upgrade");
        if (stopped.ok) {
          await startPeer("upgraded", peer.ping.version);
          if (state === "running") return;
          idle();
          return;
        }
        upgradeAfter = now() + UPGRADE_RETRY_MS;
        stuck = stopped.reason;
      }
      serve("peer", peer, stuck === undefined ? {} : { notice: stuck });
      return;
    }
    // 4. Nothing answers. A herdr of Peer's that did is a failure, whatever its reason.
    if (peerUp) {
      peerUp = false;
      spawned = undefined;
      nextStart = "restarted";
      recordFailure("unresponsive", "herdr stopped answering.");
    }
    if (home !== undefined && bundled && attemptsAllowed()) {
      const kind = nextStart;
      nextStart = "started";
      await startPeer(kind);
      if (state === "running") return;
    }
    idle();
  };

  let chain: Promise<unknown> = Promise.resolve();
  /** Runs `task` after everything queued before it. */
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const settle = async () => {
    // The port answers rather than throws; if it ever throws, the state stands until the next look.
    await evaluate().catch(() => undefined);
    publish();
  };

  return {
    snapshot,
    socketPath,
    home: () => home,
    bundled: () => bundled,
    tick: () => serialize(settle),
    setBundled: (on) =>
      serialize(async () => {
        bundled = on;
        clearFailures();
        upgradeAfter = 0;
        if (!on && home !== undefined) {
          const peer = await look(paths.socketPath);
          if (peer !== null) await stopPeer(peer, "turned-off");
        }
        await settle();
      }),
    restart: () =>
      serialize(async () => {
        clearFailures();
        upgradeAfter = 0;
        nextStart = "restarted";
        if (home !== undefined) {
          const peer = await look(paths.socketPath);
          if (peer !== null && !(await stopPeer(peer, "restart")).ok) {
            // It stays in use; the next look says so.
            await settle();
            return;
          }
        }
        await settle();
      }),
    stopIfIdle: () =>
      serialize(async () => {
        const peer = home === undefined ? null : await look(paths.socketPath);
        if (peer === null) return true;
        if (isBusy(peer)) return false;
        const stopped = await stopPeer(peer, "turned-off");
        if (stopped.ok) idle();
        publish();
        return stopped.ok;
      }),
    nextDelayMs: () =>
      state === "starting" && !failed && nextAttemptAt > now()
        ? Math.min(HERDR_TICK_MS, nextAttemptAt - now())
        : HERDR_TICK_MS,
  };
}
