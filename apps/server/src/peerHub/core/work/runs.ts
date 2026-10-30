// @effect-diagnostics nodeBuiltinImport:off globalDate:off - run tokens and their hashes, and the broker's wall-clock run times.
/**
 * Runs: one attempt of one agent on one task, from its start until it ends (design D1). A run
 * outlives the provider sessions inside it, so the task keeps its work whatever the harness does:
 * a `--resume`, a crash, a pane restart or a Peer restart.
 *
 * `RunBook` keeps this computer's runs in memory and on disk (`persisted.runs`), where the broker
 * reads them without waiting (a hook never waits): every change is a map update now and a write
 * of `peer-hub.json` after it. Runs are the one record of which task a thread, a herdr pane or a
 * session works on (design D3); every start path creates its run through `create`. `PeerRuns` is
 * the service around it: creating runs for start paths, listing them with the Hub's, ending them,
 * taking one over from another computer of the same person and keeping the Hub's copy current
 * (design D5, D8).
 *
 * @module peerHub/core/work/runs
 */
import * as NodeCrypto from "node:crypto";

import {
  PEER_LOCAL_WORKSPACE,
  PeerHubError,
  type PeerHubEndRunInput,
  type PeerHubRunsInput,
  type PeerRun,
  type PeerRunCounts,
  type PeerRunOutcome,
  type PeerRunRuntime,
  type PeerRunState,
  type PeerWorkRun,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { runsApi, type RunBody } from "../hub/runsApi.ts";
import { runtimeOfKey } from "../state/legacyAssignments.ts";
import * as PeerState from "../state/PeerState.ts";
import { runHolding, runKeys, type PersistedRun } from "../state/PeerState.ts";
import { mintRunId } from "../state/runIds.ts";

export { mintRunId };

/** The Hub keeps the newest 20 sessions of a run and counts the rest; so does this computer. */
const MAX_SESSIONS = 20;
/** How long a `requestId` names the run it created: a retry within it creates none. */
const REQUEST_MS = 24 * 60 * 60 * 1000;
/** How long a Hub without `/runs` is not asked again. */
const UNSUPPORTED_MS = 60 * 60 * 1000;

export const hashToken = (token: string) =>
  NodeCrypto.createHash("sha256").update(token).digest("hex");

/** Derived, never stored (design D1). */
export function stateOf(run: Pick<PersistedRun, "endedAt" | "sessions">): PeerRunState {
  if (run.endedAt !== undefined) return "ended";
  return run.sessions.some((session) => session.to === undefined) ? "running" : "detached";
}

/** A run as the contracts and the Hub's views show it. */
export function toPeerRun(run: PersistedRun): PeerRun {
  const { tokenHash: _t, keys: _k, pane: _p, pending: _s, hubTask: _h, local: _l, ...shown } = run;
  return { ...shown, state: stateOf(run) };
}

// The Hub keeps a run's environments itself, from its handovers; a `PUT` never names them.
const bodyOf = (run: PersistedRun, email: string): RunBody => {
  const { state: _state, environments: _e, ...body } = toPeerRun(run);
  return body.email === "" ? { ...body, email } : body;
};

/** How many of each task's runs here are in each state, for a project. */
export function runCounts(
  runs: ReadonlyArray<PersistedRun>,
  workspace: string,
  project: string,
): ReadonlyMap<string, PeerRunCounts> {
  const out = new Map<string, { running: number; detached: number; ended: number }>();
  for (const run of runs) {
    if (run.workspace !== workspace || run.project !== project) continue;
    const counts = out.get(run.task) ?? { running: 0, detached: 0, ended: 0 };
    counts[stateOf(run)] += 1;
    out.set(run.task, counts);
  }
  return out;
}

/**
 * A project's runs here that have not ended, newest first, as the work view carries them: the keys
 * that put this computer's chats and agents on their tasks.
 */
export function workRunsOf(
  runs: ReadonlyArray<PersistedRun>,
  workspace: string,
  project: string,
): ReadonlyArray<PeerWorkRun> {
  return runs
    .filter(
      (run) => run.endedAt === undefined && run.workspace === workspace && run.project === project,
    )
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
    .map((run) => ({
      id: run.id,
      task: run.task,
      agent: run.agent,
      runtime: run.runtime,
      state: stateOf(run),
      keys: [...new Set(runKeys(run))],
    }));
}

export interface CreateRun {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
  readonly agent: string;
  readonly runtime: PeerRunRuntime;
  readonly requestId?: string | undefined;
  readonly thread?: string | undefined;
  readonly keys?: ReadonlyArray<string> | undefined;
  readonly pane?: string | undefined;
  /** An id minted ahead, so a session's files can be named by it before the run is written. */
  readonly id?: string | undefined;
}

export interface CreatedRun {
  readonly run: PersistedRun;
  /** Shown once; absent for a request seen before whose token this process no longer holds. */
  readonly token?: string | undefined;
  readonly created: boolean;
}

export interface RunBookIo {
  readonly environment: string;
  readonly email: () => string | null;
  readonly now: () => number;
  /** Writes the runs. */
  readonly save: (runs: Readonly<Record<string, PersistedRun>>) => Promise<void>;
  /**
   * Sends what changed to the Hub: the broker calls it at the coordination report's cadence, the
   * work refresh at its own, so a write never waits on the Hub.
   */
  readonly push?: () => Promise<void>;
}

/** This computer's runs (see the module's comment). */
export class RunBook {
  private runs: Record<string, PersistedRun>;
  private saving: Promise<void> = Promise.resolve();
  /** Tokens of runs a request created, so a retry of it while Peer runs gets the same one. */
  private readonly tokens = new Map<string, string>();
  private readonly endListeners = new Set<(run: PersistedRun) => void>();
  readonly io: RunBookIo;

  constructor(initial: Readonly<Record<string, PersistedRun>>, io: RunBookIo) {
    this.runs = { ...initial };
    this.io = io;
  }

  get(id: string): PersistedRun | undefined {
    return Object.hasOwn(this.runs, id) ? this.runs[id] : undefined;
  }

  all(): ReadonlyArray<PersistedRun> {
    return Object.values(this.runs);
  }

  /** A project's runs here, or one task's, newest first. */
  list(filter: {
    readonly workspace?: string | undefined;
    readonly project?: string | undefined;
    readonly task?: string | undefined;
  }): ReadonlyArray<PersistedRun> {
    return this.all()
      .filter(
        (run) =>
          (filter.workspace === undefined || run.workspace === filter.workspace) &&
          (filter.project === undefined || run.project === filter.project) &&
          (filter.task === undefined || run.task === filter.task),
      )
      .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  }

  ofTask(workspace: string, project: string, task: string): ReadonlyArray<PersistedRun> {
    return this.list({ workspace, project, task });
  }

  /** Hears every run that ends here, whatever ended it; the returned function stops it. */
  onEnded(listener: (run: PersistedRun) => void): () => void {
    this.endListeners.add(listener);
    return () => void this.endListeners.delete(listener);
  }

  mintId(): string {
    return mintRunId(this.io.now());
  }

  /** Whether `token` is the one the run handed its process; a run Peer does not know matches none. */
  claim(id: string, token: string | undefined): boolean {
    const hash = this.get(id)?.tokenHash;
    if (hash === undefined || token === undefined) return false;
    const given = Buffer.from(hashToken(token), "hex");
    const kept = Buffer.from(hash, "hex");
    return given.length === kept.length && NodeCrypto.timingSafeEqual(given, kept);
  }

  /** The run that holds a thread key now: the newest of those not ended. */
  holderOf(key: string): PersistedRun | undefined {
    return runHolding(this.runs, key);
  }

  /**
   * This person's run on a task that a new session continues: the one its last session was, or a
   * detached one whose last session had the same agent and the same thread or pane (design D3).
   */
  adoptable(input: {
    readonly workspace: string;
    readonly project: string;
    readonly task: string;
    readonly agent: string;
    readonly session: string;
    readonly thread?: string | undefined;
    readonly pane?: string | undefined;
  }): PersistedRun | undefined {
    const email = this.io.email() ?? "";
    return this.ofTask(input.workspace, input.project, input.task).find((run) => {
      if (run.endedAt !== undefined || (run.email !== "" && run.email !== email)) return false;
      const last = run.sessions.at(-1);
      if (last?.id === input.session) return true;
      if (stateOf(run) !== "detached") return false;
      if (run.agent !== input.agent && run.sessions.length > 0) return false;
      return (
        (input.thread !== undefined && run.thread === input.thread) ||
        (input.pane !== undefined && run.pane === input.pane)
      );
    });
  }

  async create(input: CreateRun): Promise<CreatedRun> {
    const now = this.io.now();
    if (input.requestId !== undefined) {
      const seen = this.all().find(
        (run) => run.requestId === input.requestId && now - Date.parse(run.startedAt) < REQUEST_MS,
      );
      if (seen !== undefined) return { run: seen, token: this.tokens.get(seen.id), created: false };
    }
    const token = NodeCrypto.randomBytes(16).toString("hex");
    const id = input.id ?? mintRunId(now);
    const keys = input.keys ?? [];
    const run: PersistedRun = {
      id,
      workspace: input.workspace,
      project: input.project,
      task: input.task,
      email: this.io.email() ?? "",
      environment: this.io.environment,
      agent: input.agent,
      runtime: input.runtime,
      ...(input.thread === undefined ? {} : { thread: input.thread }),
      startedAt: new Date(now).toISOString(),
      sessions: [],
      sessionsBefore: 0,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      tokenHash: hashToken(token),
      ...(keys.length === 0 ? {} : { keys: [...keys] }),
      ...(input.pane === undefined ? {} : { pane: input.pane }),
      pending: true,
    };
    if (input.requestId !== undefined) this.tokens.set(id, token);
    // A key names one run's work: a new run takes it from whichever had it.
    const next = { ...this.withoutKeys([...keys, ...(input.thread ? [input.thread] : [])]) };
    next[id] = run;
    await this.write(next);
    return { run, token, created: true };
  }

  /**
   * A session joins a run: a session it had before is reopened, any other live one ends in the
   * record (one live session per run, design D1). Says which sessions it replaced.
   */
  async attach(
    id: string,
    session: string,
    place: { readonly agent?: string; readonly pane?: string | undefined } = {},
  ): Promise<{ readonly replaced: ReadonlyArray<string> }> {
    const run = this.get(id);
    if (run === undefined || run.endedAt !== undefined) return { replaced: [] };
    const at = new Date(this.io.now()).toISOString();
    const last = run.sessions.at(-1);
    let sessions = [...run.sessions];
    let before = run.sessionsBefore;
    const replaced = sessions
      .filter((s) => s.to === undefined && s.id !== session)
      .map((s) => s.id);
    sessions = sessions.map((s) => (s.to === undefined && s.id !== session ? { ...s, to: at } : s));
    if (last?.id === session) {
      const { to: _to, ...open } = sessions.at(-1)!;
      sessions[sessions.length - 1] = open;
    } else sessions.push({ id: session, from: at });
    while (sessions.length > MAX_SESSIONS) {
      sessions.shift();
      before += 1;
    }
    await this.put({
      ...run,
      sessions,
      sessionsBefore: before,
      ...(run.agent === "unknown" && place.agent !== undefined ? { agent: place.agent } : {}),
      ...(place.pane === undefined ? {} : { pane: place.pane }),
    });
    return { replaced };
  }

  /** A session of a run ended (its end, its expiry, Peer stopping); the run stays, detached. */
  async detach(id: string, session: string): Promise<void> {
    const run = this.get(id);
    if (run === undefined || !run.sessions.some((s) => s.id === session && s.to === undefined))
      return;
    const at = new Date(this.io.now()).toISOString();
    await this.put({
      ...run,
      sessions: run.sessions.map((s) =>
        s.id === session && s.to === undefined ? { ...s, to: at } : s,
      ),
    });
  }

  /** Ends a run with its outcome; one that ended already keeps its first. */
  async end(id: string, outcome: PeerRunOutcome): Promise<PersistedRun | undefined> {
    const run = this.get(id);
    if (run === undefined || run.endedAt !== undefined) return run;
    const at = new Date(this.io.now()).toISOString();
    const ended: PersistedRun = {
      ...run,
      endedAt: at,
      outcome,
      sessions: run.sessions.map((s) => (s.to === undefined ? { ...s, to: at } : s)),
    };
    await this.put(ended);
    for (const listener of this.endListeners) listener(ended);
    return ended;
  }

  /** Every run on a task that has not ended ends: the task closed, or went away. */
  async closeTask(workspace: string, project: string, task: string): Promise<void> {
    for (const run of this.ofTask(workspace, project, task))
      if (run.endedAt === undefined) await this.end(run.id, "task-closed");
  }

  /** A run holds a thread key besides its sessions' (a herdr terminal before its session is known). */
  async hold(id: string, key: string, pane?: string): Promise<void> {
    const run = this.get(id);
    if (run === undefined) return;
    const next = this.withoutKeys([key], id);
    next[id] = {
      ...run,
      keys: [...new Set([...(run.keys ?? []), key])],
      ...(pane === undefined ? {} : { pane }),
    };
    await this.write(next);
  }

  /**
   * A person puts one of this computer's threads on a task (`peerHub.assignThread`): the run that
   * holds its key moves, or a detached one starts through `create`; taken off every task, the run
   * it named ends, or only drops a key it held besides its thread or sessions.
   */
  async assign(
    key: string,
    assignment: {
      readonly workspace: string;
      readonly project: string;
      readonly task: string;
    } | null,
    requestId?: string,
  ): Promise<void> {
    const holder = this.holderOf(key);
    if (assignment === null) {
      if (holder === undefined) return;
      const held = holder.keys?.includes(key) === true;
      if (held && (holder.thread !== undefined || holder.sessions.length > 0)) {
        await this.put({ ...holder, keys: holder.keys!.filter((k) => k !== key) });
      } else await this.end(holder.id, "stopped");
      return;
    }
    if (holder !== undefined) {
      if (holder.workspace === assignment.workspace && holder.project === assignment.project) {
        if (holder.task !== assignment.task) await this.put({ ...holder, task: assignment.task });
        return;
      }
      await this.end(holder.id, "stopped");
    }
    const derived = runtimeOfKey(key);
    await this.create({
      ...assignment,
      ...derived,
      requestId,
      ...(derived.runtime === "peer" ? { thread: key } : { keys: [key] }),
    });
  }

  /**
   * Thread keys that changed (a runtime learned a session): a run keeps holding them, and its pane
   * follows, so Observe and a later session there find it. Only the run's keys move: the task is
   * the run's.
   */
  async rename(
    renames: ReadonlyArray<{
      readonly from: string;
      readonly to: string;
      readonly pane?: string | undefined;
    }>,
  ) {
    const next = { ...this.runs };
    let changed = false;
    for (const { from, to, pane } of renames) {
      const holder = this.holderOf(from);
      if (from === to || holder === undefined || !holder.keys?.includes(from)) continue;
      if (this.holderOf(to) !== undefined) continue;
      next[holder.id] = {
        ...next[holder.id]!,
        keys: (next[holder.id]!.keys ?? []).map((k) => (k === from ? to : k)),
        ...(pane === undefined ? {} : { pane }),
        pending: true,
      };
      changed = true;
    }
    if (changed) await this.write(next);
  }

  /**
   * A run another computer of this person minted, which the Hub handed over to this one (design
   * D8): kept here as this environment's from now on, with no token until a process continues it.
   */
  async takeOver(run: PeerRun): Promise<PersistedRun> {
    const { state: _state, ...row } = run;
    const environments = run.environments ?? [];
    const kept: PersistedRun = {
      ...row,
      environment: this.io.environment,
      // When this computer took it, so a session from before (on the other one) is not resumed.
      environments:
        environments.at(-1)?.id === this.io.environment
          ? environments
          : [
              ...environments,
              { id: this.io.environment, from: new Date(this.io.now()).toISOString() },
            ],
      hubTask: run.task,
      pending: false,
    };
    await this.write({ ...this.runs, [run.id]: kept });
    return kept;
  }

  /**
   * After a crash or a restart: a run whose live session this broker does not hold is detached
   * (design D5); hooks with a valid token attach again at their next event.
   */
  async recover(held: ReadonlySet<string>): Promise<void> {
    const at = new Date(this.io.now()).toISOString();
    const next = { ...this.runs };
    let changed = false;
    for (const run of this.all()) {
      if (run.endedAt !== undefined) continue;
      if (!run.sessions.some((s) => s.to === undefined && !held.has(s.id))) continue;
      next[run.id] = {
        ...run,
        sessions: run.sessions.map((s) =>
          s.to === undefined && !held.has(s.id) ? { ...s, to: at } : s,
        ),
        pending: true,
      };
      changed = true;
    }
    if (changed) await this.write(next);
  }

  /**
   * What a new process of a run needs (design D2, D6): its variables, with a token minted now (the
   * old process is gone, its token with it), and the last session to resume where it is known.
   */
  async continueEnv(id: string): Promise<
    | {
        readonly env: {
          readonly PEER_RUN: string;
          readonly PEER_RUN_TOKEN: string;
          readonly PEER_TASK: string;
        };
        readonly resume?: { readonly agent: string; readonly nativeId: string };
      }
    | undefined
  > {
    const run = this.get(id);
    if (run === undefined || run.endedAt !== undefined) return undefined;
    const token = NodeCrypto.randomBytes(16).toString("hex");
    await this.put({ ...run, tokenHash: hashToken(token) });
    const last = run.sessions.at(-1);
    // A session from before this computer took the run over ran elsewhere: nothing to resume here.
    const since = run.environments?.findLast((entry) => entry.id === this.io.environment)?.from;
    const separator =
      last === undefined || (since !== undefined && last.from < since) ? -1 : last.id.indexOf(":");
    return {
      env: { PEER_RUN: run.id, PEER_RUN_TOKEN: token, PEER_TASK: run.task },
      ...(last === undefined || separator < 0
        ? {}
        : {
            resume: { agent: last.id.slice(0, separator), nativeId: last.id.slice(separator + 1) },
          }),
    };
  }

  /**
   * A run another computer of this person took over (the Hub refuses this computer's writes of it):
   * it leaves this computer, whose sessions in it fall back as for a run Peer does not know.
   */
  async forget(id: string): Promise<void> {
    if (this.get(id) === undefined) return;
    const { [id]: _gone, ...rest } = this.runs;
    await this.write(rest);
  }

  /** What the Hub took: unchanged since, the run no longer waits to be sent. */
  async synced(sent: PersistedRun): Promise<void> {
    if (this.get(sent.id) !== sent) return;
    await this.write({ ...this.runs, [sent.id]: { ...sent, pending: false, hubTask: sent.task } });
  }

  /** Runs whose changes the Hub has not taken; this computer's own legacy runs never go. */
  pendingRuns(): ReadonlyArray<PersistedRun> {
    return this.all().filter(
      (run) => run.pending === true && run.local !== true && run.workspace !== PEER_LOCAL_WORKSPACE,
    );
  }

  /** Waits for the writes asked for so far. */
  flushed(): Promise<void> {
    return this.saving;
  }

  private withoutKeys(keys: ReadonlyArray<string>, except?: string): Record<string, PersistedRun> {
    const next = { ...this.runs };
    if (keys.length === 0) return next;
    for (const run of this.all()) {
      if (run.id === except || run.endedAt !== undefined || run.keys === undefined) continue;
      const kept = run.keys.filter((key) => !keys.includes(key));
      if (kept.length !== run.keys.length) next[run.id] = { ...run, keys: kept, pending: true };
    }
    return next;
  }

  private put(run: PersistedRun): Promise<void> {
    return this.write({ ...this.runs, [run.id]: { ...run, pending: true } });
  }

  private write(next: Record<string, PersistedRun>): Promise<void> {
    this.runs = next;
    const done = this.saving.then(() => this.io.save(next));
    this.saving = done.catch(() => undefined);
    return done;
  }
}

const hubError = (detail: string) => new PeerHubError({ detail });

export class PeerRuns extends Context.Service<
  PeerRuns,
  {
    /** The runs themselves, for the broker, which reads them without waiting. */
    readonly book: RunBook;
    readonly create: (input: CreateRun) => Effect.Effect<CreatedRun, PeerHubError>;
    /** A project's or a task's runs: this computer's, and the others' the Hub keeps. */
    readonly list: (input: PeerHubRunsInput) => Effect.Effect<ReadonlyArray<PeerRun>, PeerHubError>;
    /** Ends this computer's run (`stopped`), or asks the Hub to end another's, which decides who may. */
    readonly endRun: (input: PeerHubEndRunInput) => Effect.Effect<PeerRun, PeerHubError>;
    /** Sends the runs that changed to the Hub; a Hub without `/runs` is left alone for an hour. */
    readonly sync: Effect.Effect<void>;
    /**
     * Takes over a run another computer of this person minted (design D8): the Hub moves it to
     * this environment, refusing an ended run (`ended`) and another person's (`not_your_run`).
     */
    readonly takeOver: (run: PeerRun) => Effect.Effect<PersistedRun, PeerHubError>;
  }
>()("t3/peerHub/core/work/runs/PeerRuns") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const clock = yield* Clock.Clock;
  const api = runsApi(client);
  const services = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(services);
  const now = () => clock.currentTimeMillisUnsafe();
  let unsupportedUntil = 0;
  let syncing = false;

  // PeerState turned any assignments from before runs into runs as it loaded the file.
  const initial = (yield* state.read).persisted.runs ?? {};

  const send = (run: PersistedRun, email: string) =>
    Effect.gen(function* () {
      if (run.hubTask !== undefined && run.hubTask !== run.task)
        yield* api
          .patch(run.workspace, run.project, run.id, { task: run.task })
          .pipe(Effect.ignore);
      return yield* api.put(run.workspace, bodyOf(run, email));
    });

  const sync: PeerRuns["Service"]["sync"] = Effect.gen(function* () {
    if (syncing || now() < unsupportedUntil) return;
    const signedIn = yield* client.session.pipe(Effect.option);
    const email = state.current().persisted.email;
    if (Option.isNone(signedIn) || email === null) return;
    syncing = true;
    for (const run of book.pendingRuns()) {
      const sent = yield* send(run, email).pipe(Effect.result);
      if (sent._tag === "Success" && sent.success === null) {
        unsupportedUntil = now() + UNSUPPORTED_MS;
        return;
      }
      if (sent._tag === "Success") {
        yield* Effect.promise(() => book.synced(run));
        continue;
      }
      // Another computer of this person took the run over: it is that computer's to keep now.
      if (
        sent.failure.code === "not_your_run" &&
        (run.email === "" || run.email.toLowerCase() === email.toLowerCase())
      ) {
        yield* Effect.logInfo("Peer Hub says a run moved to another computer", { run: run.id });
        yield* Effect.promise(() => book.forget(run.id));
        continue;
      }
      // The Hub refused the run (another's, a task gone): repeating it changes nothing.
      if (sent.failure.refused === true) {
        yield* Effect.logWarning("Peer Hub refused a run", {
          run: run.id,
          code: sent.failure.code ?? null,
        });
        yield* Effect.promise(() => book.synced(run));
        continue;
      }
      return;
    }
  }).pipe(Effect.ensuring(Effect.sync(() => (syncing = false))));

  const save = (runs: Readonly<Record<string, PersistedRun>>) =>
    state.updatePersisted((p) => ({ ...p, runs: { ...runs } }));
  const book: RunBook = new RunBook(initial, {
    environment: state.environmentId,
    email: () => state.current().persisted.email,
    now,
    save: (runs) => runPromise(save(runs)),
    push: () => runPromise(sync),
  });

  const create: PeerRuns["Service"]["create"] = (input) =>
    Effect.tryPromise({
      try: () => book.create(input),
      catch: () => hubError("Could not save the run."),
    });

  const list: PeerRuns["Service"]["list"] = (input) =>
    Effect.gen(function* () {
      const local = book
        .list({ workspace: input.workspace, project: input.projectId, task: input.taskId })
        .map(toPeerRun);
      if (now() < unsupportedUntil) return local;
      const hub = yield* api
        .list(input.workspace, input.projectId, { task: input.taskId })
        .pipe(Effect.orElseSucceed(() => null));
      if (hub === null) return local;
      // This computer's own runs are newer here than in the Hub's copy, unless another computer
      // of the person took one over since: the Hub's then knows a later handover than this one.
      const handovers = (run: Pick<PeerRun, "environments">) => run.environments?.length ?? 0;
      const moved = new Set(
        hub.runs
          .filter((run) => {
            const here = book.get(run.id);
            return (
              here !== undefined &&
              run.environment !== state.environmentId &&
              handovers(run) > handovers(here)
            );
          })
          .map((run) => run.id),
      );
      const kept = local.filter((run) => !moved.has(run.id));
      const mine = new Set(kept.map((run) => run.id));
      return [...kept, ...hub.runs.filter((run) => !mine.has(run.id))].toSorted(
        (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
      );
    });

  const endRun: PeerRuns["Service"]["endRun"] = (input) =>
    Effect.gen(function* () {
      const own = book.get(input.runId);
      if (own !== undefined) {
        if (own.workspace !== input.workspace || own.project !== input.projectId)
          return yield* hubError("That run is not on this project.");
        const ended = yield* Effect.tryPromise({
          try: () => book.end(own.id, "stopped"),
          catch: () => hubError("Could not save the run."),
        });
        return toPeerRun(ended ?? own);
      }
      const ended = yield* api.patch(input.workspace, input.projectId, input.runId, {
        endedAt: DateTime.formatIso(yield* DateTime.now),
        outcome: "stopped",
      });
      if (ended === null) return yield* hubError("This Peer Hub does not keep runs yet.");
      return ended.run;
    });

  const takeOver: PeerRuns["Service"]["takeOver"] = (run) =>
    Effect.gen(function* () {
      // Revision 2 of `runs` moves runs between computers; a catalog not read yet is asked anyway.
      if ((yield* client.featuresRead) && ((yield* client.features).runs ?? 0) < 2)
        return yield* hubError("This Peer Hub does not move runs between computers yet.");
      const moved = yield* api
        .patch(run.workspace, run.project, run.id, { environment: state.environmentId })
        .pipe(
          Effect.mapError((failure) =>
            failure.code === "ended"
              ? hubError("This run has ended.")
              : failure.code === "not_your_run"
                ? hubError("This run is another person's; only its person continues it.")
                : failure,
          ),
        );
      if (moved === null)
        return yield* hubError(
          "This Peer Hub cannot hand runs between computers yet; continue it on the computer that started it.",
        );
      return yield* Effect.tryPromise({
        try: () => book.takeOver(moved.run),
        catch: () => hubError("Could not save the run."),
      });
    });

  return PeerRuns.of({ book, create, list, endRun, sync, takeOver });
});

export const layer = Layer.effect(PeerRuns, make);

/** The variables a process of a run carries (design D2): `PEER_RUN`, `PEER_RUN_TOKEN`, `PEER_TASK`. */
export type RunEnv = Readonly<Record<string, string>>;

/**
 * A start in a runtime Peer launches (herdr's, for `startAgent`, a role's agent): the run exists
 * before its agent does, so the agent's first hook proves it with the token; once the agent runs,
 * the run holds its thread key and pane, which is how the work view and Observe find it.
 */
export const launchInRun = <
  A extends { readonly threadKey: string; readonly paneId: string },
  E,
  R,
>(
  runs: PeerRuns["Service"],
  input: CreateRun,
  launch: (env: RunEnv) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const { run, token } = yield* runs.create(input);
    const started = yield* launch({
      PEER_RUN: run.id,
      ...(token === undefined ? {} : { PEER_RUN_TOKEN: token }),
      PEER_TASK: run.task,
    });
    yield* Effect.promise(() =>
      runs.book.hold(run.id, started.threadKey, started.paneId).catch(() => undefined),
    );
    return { run: run.id, started };
  });
