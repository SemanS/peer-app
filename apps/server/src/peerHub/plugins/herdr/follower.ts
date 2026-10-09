// @effect-diagnostics nodeBuiltinImport:off - git in agents' checkouts: their branches, and the files they changed.
/**
 * Following herdr's agents. herdr's events say when an agent appears, leaves or changes state;
 * Peer then reads the list, with each agent's git branch, the workspace project its checkout
 * belongs to and, after it finished a turn, the files it changed. It shows a change at once and
 * tells the Hub within a couple of seconds. The events are subscribed before each list, and again
 * at once when herdr drops them for falling behind; without events (no herdr, or one from before
 * them) Peer reads the list every few seconds instead. Peer follows herdr only while the plugin
 * runs, and forgets its agents when it stops.
 *
 * @module peerHub/plugins/herdr/follower
 */
import * as NodeChildProcess from "node:child_process";

import type { PeerWorkStatus } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { run } from "../../core/local.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import type { HerdrAgent, HerdrFollower } from "./client/herdr.ts";
import { HerdrClient } from "./client/HerdrClient.ts";

/**
 * How often Peer reads herdr's agents when herdr sends no events, and when it
 * does (agents' titles change without an event).
 */
const HERDR_POLL_MS = 4_000;
const HERDR_RESYNC_MS = 15_000;
/** A change in herdr's agents reaches the hub at most this often. */
const HERDR_REPORT_GAP_MS = 2_000;

/** An agent herdr runs, with what Peer adds: its branch, its checkout's project, what it changed. */
export interface HerdrAgentState extends HerdrAgent {
  readonly branch: string | undefined;
  readonly postHocPaths?: ReadonlyArray<string>;
  readonly postHocPathsTruncated?: number;
  readonly place?: {
    readonly workspace: string;
    readonly projectId: string;
    readonly repositoryId: string;
  };
}

/** Paths from Git's NUL-delimited status; rename/copy records carry an extra source path. */
export function herdrStatusPaths(status: string): ReadonlyArray<string> {
  const entries = status.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.length < 4 || entry[2] !== " ") continue;
    paths.add(entry.slice(3));
    if (entry.slice(0, 2).includes("R") || entry.slice(0, 2).includes("C")) {
      const source = entries[++index];
      if (source) paths.add(source);
    }
  }
  return [...paths].toSorted();
}

/** Live enforcement sessions take precedence over observations within the hub's report limit. */
export function boundHerdrObservations<T>(
  primary: ReadonlyArray<T>,
  observations: ReadonlyArray<T>,
) {
  const available = Math.max(0, 50 - primary.length);
  return {
    sessions: [...primary, ...observations.slice(0, available)],
    skipped: Math.max(0, observations.length - available),
  };
}

/** Observes uncommitted paths in this worktree after work; it cannot attribute every change to its agent. */
export function readHerdrChangedPaths(cwd: string): Promise<ReadonlyArray<string> | null> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { timeout: 3000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, stdout) => resolve(error === null ? herdrStatusPaths(stdout) : null),
    );
  });
}

/** completion_seq catches a whole turn between polls; old servers need an observed working → idle edge. */
export class HerdrCompletionTracker {
  private readonly observed = new Map<
    string,
    { status: PeerWorkStatus; seq: number | undefined }
  >();

  completed(agent: HerdrAgent): boolean {
    const key = [
      agent.terminalId,
      agent.agent,
      agent.session?.id,
      agent.session?.path,
      agent.cwd,
    ].join("\0");
    const before = this.observed.get(key);
    this.observed.set(key, { status: agent.status, seq: agent.completionSeq });
    if (this.observed.size > 500) this.observed.delete(this.observed.keys().next().value!);
    if (agent.status !== "idle" && agent.status !== "done") return false;
    return agent.completionSeq !== undefined
      ? agent.completionSeq !== before?.seq
      : before?.status === "working";
  }
}

/**
 * What Peer shows and reports of herdr's agents, to tell a change from a re-read.
 * The completion is in it because a turn can start and finish between two reads
 * and leave the state as it was.
 */
function herdrSignature(
  agents: ReadonlyArray<HerdrAgentState> | null,
  keyOf: (agent: HerdrAgentState) => string,
): string {
  if (agents === null) return "";
  return agents
    .map((a) =>
      [keyOf(a), a.paneId, a.status, a.completionSeq, a.title, a.cwd, a.branch].join("\u0000"),
    )
    .toSorted()
    .join("\u0001");
}

/** herdr's agents as the herdr plugin follows them. */
export interface HerdrAgents {
  /** As last read; null while no herdr server listens here, or Peer does not follow herdr. */
  readonly current: () => ReadonlyArray<HerdrAgentState> | null;
  /** The session an agent in a pane runs, as herdr's integration or Peer's own hooks say. */
  readonly sessionOf: (
    agent: HerdrAgent,
  ) => { readonly id: string | undefined; readonly path: string | undefined } | undefined;
  /**
   * An agent's thread key: its own session once known, so the thread outlives the pane and a
   * herdr restart; its terminal until then.
   */
  readonly keyOf: (agent: HerdrAgent) => string;
  /** Reads herdr's agents now. */
  readonly refresh: Effect.Effect<void>;
  /** Reads them now, then as herdr says they change, until interrupted; forgets them then. */
  readonly follow: Effect.Effect<never, never, Scope.Scope>;
}

/** Follows herdr's agents with the herdr plugin's services. */
export const makeHerdrAgents = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const work = yield* PeerWork.PeerWork;
  const sessions = yield* PeerAgents.PeerAgents;
  const client = yield* HerdrClient;
  const scope = yield* Effect.scope;
  let agents: ReadonlyArray<HerdrAgentState> | null = null;
  /** herdr's events while Peer follows them; reads queue up behind one another there. */
  let follower: HerdrFollower | null = null;
  /** cwd → its git branch, refreshed every 30 s. */
  const branches = new Map<string, { readonly branch: string | undefined; readonly at: number }>();
  /** cwd → the workspace checkout a worktree outside it belongs to, rechecked every 30 s. */
  const places = new Map<
    string,
    { readonly at: number; readonly place: HerdrAgentState["place"] }
  >();
  const completions = new HerdrCompletionTracker();
  const observedPaths = new Map<
    string,
    { readonly paths: ReadonlyArray<string>; readonly truncated: number }
  >();
  /** herdr's events say to read its agents again; a burst of them is one signal. */
  const changed = yield* Queue.dropping<void>(1);

  const sessionOf: HerdrAgents["sessionOf"] = (agent) =>
    agent.session ?? sessions.inPane(agent.paneId);

  const keyOf: HerdrAgents["keyOf"] = (agent) => {
    const session = sessionOf(agent)?.id;
    return session === undefined
      ? `herdr:${agent.terminalId}`
      : `herdr:${agent.agent ?? "agent"}:${session}`;
  };

  const branchOf = (cwd: string | undefined, nowMillis: number) =>
    Effect.gen(function* () {
      if (cwd === undefined) return undefined;
      const cached = branches.get(cwd);
      if (cached !== undefined && nowMillis - cached.at < 30_000) return cached.branch;
      const branch = yield* Effect.tryPromise(() =>
        run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 3000 }),
      ).pipe(
        Effect.map((name) => (name === "" || name === "HEAD" ? undefined : name)),
        Effect.orElseSucceed(() => undefined),
      );
      branches.set(cwd, { branch, at: nowMillis });
      return branch;
    });

  /** The workspace project an agent's checkout belongs to, a worktree of one included. */
  const placeOf = (cwd: string | undefined, nowMillis: number) =>
    Effect.gen(function* () {
      const place = state.projectOfPath((yield* state.read).persisted, cwd);
      if (place !== undefined || cwd === undefined) return place;
      const cached = places.get(cwd);
      if (cached !== undefined && nowMillis - cached.at < 30_000) return cached.place;
      const resolved = yield* state.placeOf(cwd);
      const found =
        resolved === null
          ? undefined
          : {
              workspace: resolved.workspace,
              projectId: resolved.project,
              repositoryId: resolved.repositoryId,
            };
      places.set(cwd, { at: nowMillis, place: found });
      if (places.size > 500) places.delete(places.keys().next().value!);
      return found;
    });

  /** What herdr runs on this computer, with each agent's git branch and worktree's repository. */
  const refresh: HerdrAgents["refresh"] = Effect.gen(function* () {
    const listed = yield* Effect.promise(() =>
      follower === null ? client.list() : follower.read(),
    );
    const nowMillis = DateTime.toEpochMillis(yield* DateTime.now);
    agents =
      listed === null
        ? null
        : yield* Effect.forEach(listed, (agent) =>
            Effect.gen(function* () {
              const branch = yield* branchOf(agent.cwd, nowMillis);
              const observationKey = [
                agent.terminalId,
                agent.agent,
                agent.session?.id,
                agent.session?.path,
                agent.cwd,
              ].join("\0");
              if (completions.completed(agent) && agent.cwd !== undefined) {
                const paths = yield* Effect.promise(() => readHerdrChangedPaths(agent.cwd!));
                if (paths !== null)
                  observedPaths.set(observationKey, {
                    paths: paths.slice(0, 200),
                    truncated: Math.max(0, paths.length - 200),
                  });
                if (observedPaths.size > 500)
                  observedPaths.delete(observedPaths.keys().next().value!);
              }
              const observation = observedPaths.get(observationKey);
              const place = yield* placeOf(agent.cwd, nowMillis);
              return {
                ...agent,
                branch,
                ...(observation === undefined
                  ? {}
                  : {
                      postHocPaths: observation.paths,
                      postHocPathsTruncated: observation.truncated,
                    }),
                ...(place === undefined ? {} : { place }),
              };
            }),
          );
  });

  /** An agent placed on a task under its terminal keeps the task once its session is known. */
  const keepKeys = (list: ReadonlyArray<HerdrAgentState>) =>
    work.rename(
      list.flatMap((agent) => {
        const from = `herdr:${agent.terminalId}`;
        const to = keyOf(agent);
        return to === from ? [] : [{ from, to }];
      }),
    );

  /** Tells the Hub of this computer's threads, in the plugin's scope: a stop does not cut it. */
  const report = work
    .refresh()
    .pipe(
      state.lock.withPermits(1),
      Effect.andThen(status.publish),
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(scope),
      Effect.asVoid,
    );

  const follow: HerdrAgents["follow"] = Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        follower?.close();
        follower = null;
        agents = null;
      }),
    );
    follower = client.follow(() => void Queue.offerUnsafe(changed, undefined), HERDR_RESYNC_MS);
    let shown = "";
    let reported = "";
    let reportedAt = 0;

    const step = Effect.gen(function* () {
      yield* refresh;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      yield* keepKeys(agents ?? []);
      const seen = herdrSignature(agents, keyOf);
      if (seen !== shown) {
        shown = seen;
        yield* status.publish;
      }
      if (seen !== reported && now - reportedAt >= HERDR_REPORT_GAP_MS) {
        reported = seen;
        reportedAt = now;
        yield* report;
      }
      return seen !== reported
        ? Math.max(100, HERDR_REPORT_GAP_MS - (now - reportedAt))
        : follower?.live() === true
          ? HERDR_RESYNC_MS
          : HERDR_POLL_MS;
    });

    while (true) {
      const wait = yield* step.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Peer could not read herdr's agents", cause).pipe(
            Effect.as(HERDR_POLL_MS),
          ),
        ),
      );
      const woken = yield* Queue.take(changed).pipe(Effect.timeoutOption(wait));
      if (Option.isSome(woken)) {
        // An agent starting or finishing sends a few events at once; read once they settle.
        yield* Effect.sleep(150);
        yield* Queue.clear(changed);
      }
    }
  });

  return {
    current: () => agents,
    sessionOf,
    keyOf,
    refresh,
    follow,
  } satisfies HerdrAgents;
});
