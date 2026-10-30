// @effect-diagnostics nodeBuiltinImport:off globalDate:off - run tokens and their hashes, and the broker's wall-clock run times.
/**
 * Runs: one attempt of one agent on one task, from its start until it ends (design D1). A run
 * outlives the provider sessions inside it, so the task keeps its work whatever the harness does:
 * a `--resume`, a crash, a pane restart or a Peer restart.
 *
 * `RunBook` keeps this computer's runs in memory and on disk (`persisted.runs`), where the broker
 * reads them without waiting (a hook never waits): every change is a map update now and a write
 * of `peer-hub.json` after it, which also rewrites the assignments index the code from before
 * runs reads (design D3). `PeerRuns` is the service around it: creating runs for start paths,
 * listing them with the Hub's, ending them and keeping the Hub's copy current (design D5).
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
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { runsApi, type RunBody } from "../hub/runsApi.ts";
import * as PeerState from "../state/PeerState.ts";
import type { PersistedRun, PersistedState } from "../state/PeerState.ts";

/** The Hub keeps the newest 20 sessions of a run and counts the rest; so does this computer. */
const MAX_SESSIONS = 20;
/** How long a `requestId` names the run it created: a retry within it creates none. */
const REQUEST_MS = 24 * 60 * 60 * 1000;
/** How long a Hub without `/runs` is not asked again. */
const UNSUPPORTED_MS = 60 * 60 * 1000;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * `run_` and 20 Crockford base-32 characters of a ULID: its 10 time characters, so ids sort by
 * start, and the first 10 of its randomness.
 */
export function mintRunId(now: number, random: Buffer = NodeCrypto.randomBytes(7)): string {
  let time = "";
  let rest = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i++) {
    time = `${CROCKFORD[rest % 32]}${time}`;
    rest = Math.floor(rest / 32);
  }
  let bits = BigInt(`0x${random.toString("hex").padStart(14, "0")}`);
  let tail = "";
  for (let i = 0; i < 10; i++) {
    tail = `${CROCKFORD[Number(bits & 31n)]}${tail}`;
    bits >>= 5n;
  }
  return `run_${time}${tail}`;
}

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

const bodyOf = (run: PersistedRun, email: string): RunBody => {
  const { state: _state, ...body } = toPeerRun(run);
  return body.email === "" ? { ...body, email } : body;
};

/** Every thread key that names a run's work: its held keys, its thread, its last session's. */
export function keysOf(run: PersistedRun): ReadonlyArray<string> {
  const last = run.sessions.at(-1);
  return [
    ...(run.keys ?? []),
    ...(run.thread === undefined ? [] : [run.thread]),
    ...(last === undefined ? [] : [last.id, `herdr:${last.id}`]),
  ];
}

/**
 * The assignments index of the code from before runs (design D3), from every run that has not
 * ended; a newer run's key wins. The last session's keys stay while a run is detached, so a herdr
 * pane whose agent exited keeps its task in the work report as it did.
 */
export function assignmentsOf(
  runs: Readonly<Record<string, PersistedRun>>,
): NonNullable<PersistedState["assignments"]> {
  const out: Record<string, { workspace: string; project: string; task: string }> = {};
  const open = Object.values(runs)
    .filter((run) => run.endedAt === undefined)
    .toSorted((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const run of open)
    for (const key of keysOf(run))
      out[key] = { workspace: run.workspace, project: run.project, task: run.task };
  return out;
}

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

/** The runtime and agent a thread key says, for a run made from an assignment. */
function fromKey(key: string): { readonly runtime: PeerRunRuntime; readonly agent: string } {
  if (key.startsWith("peer:")) return { runtime: "peer", agent: "unknown" };
  if (key.startsWith("retained:")) return { runtime: "terminal", agent: "unknown" };
  const parts = key.split(":");
  if (key.startsWith("herdr:"))
    return { runtime: "herdr", agent: parts.length >= 3 ? parts[1]! : "unknown" };
  return { runtime: "terminal", agent: parts.length >= 2 ? parts[0]! : "unknown" };
}

/**
 * The assignments written before runs, each as a detached run that keeps its key and stays on this
 * computer (`local`): the Hub never heard of them and would only refuse them.
 */
export function importAssignments(
  assignments: NonNullable<PersistedState["assignments"]>,
  environment: string,
  email: string | null,
  now: number,
): Record<string, PersistedRun> {
  const runs: Record<string, PersistedRun> = {};
  for (const [key, assignment] of Object.entries(assignments)) {
    const id = mintRunId(now);
    runs[id] = {
      id,
      ...assignment,
      email: email ?? "",
      environment,
      ...fromKey(key),
      ...(key.startsWith("peer:") ? { thread: key } : { keys: [key] }),
      startedAt: new Date(now).toISOString(),
      sessions: [],
      sessionsBefore: 0,
      local: true,
    };
  }
  return runs;
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
  /** Writes the runs and the assignments index made of them. */
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
    return this.all()
      .filter((run) => run.endedAt === undefined && keysOf(run).includes(key))
      .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
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
   * `PeerWork.assign` over runs (design D3): a key put on a task moves the run that holds it, or
   * starts a detached one; a key taken off a task ends the run it named, or only drops a held key.
   */
  async assign(
    key: string,
    assignment: {
      readonly workspace: string;
      readonly project: string;
      readonly task: string;
    } | null,
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
    const derived = fromKey(key);
    await this.create({
      ...assignment,
      ...derived,
      ...(derived.runtime === "peer" ? { thread: key } : { keys: [key] }),
    });
  }

  /** Thread keys that changed (a runtime learned a session): a run keeps holding them. */
  async rename(renames: ReadonlyArray<{ readonly from: string; readonly to: string }>) {
    const next = { ...this.runs };
    let changed = false;
    for (const { from, to } of renames) {
      const holder = this.holderOf(from);
      if (from === to || holder === undefined || !holder.keys?.includes(from)) continue;
      if (this.holderOf(to) !== undefined) continue;
      next[holder.id] = {
        ...next[holder.id]!,
        keys: (next[holder.id]!.keys ?? []).map((k) => (k === from ? to : k)),
        pending: true,
      };
      changed = true;
    }
    if (changed) await this.write(next);
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
    const separator = last?.id.indexOf(":") ?? -1;
    return {
      env: { PEER_RUN: run.id, PEER_RUN_TOKEN: token, PEER_TASK: run.task },
      ...(last === undefined || separator < 0
        ? {}
        : {
            resume: { agent: last.id.slice(0, separator), nativeId: last.id.slice(separator + 1) },
          }),
    };
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

  const { persisted } = yield* state.read;
  const legacy =
    persisted.runs === undefined && Object.keys(persisted.assignments ?? {}).length > 0;
  const initial =
    persisted.runs ??
    importAssignments(persisted.assignments ?? {}, state.environmentId, persisted.email, now());

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
    state.updatePersisted((p) => ({ ...p, runs: { ...runs }, assignments: assignmentsOf(runs) }));
  const book: RunBook = new RunBook(initial, {
    environment: state.environmentId,
    email: () => state.current().persisted.email,
    now,
    save: (runs) => runPromise(save(runs)),
    push: () => runPromise(sync),
  });
  // The assignments from before runs become runs once, so the index is written from runs only.
  if (legacy) yield* save(initial).pipe(Effect.ignore);

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
      // This computer's own runs are newer here than in the Hub's copy.
      const mine = new Set(local.map((run) => run.id));
      return [...local, ...hub.runs.filter((run) => !mine.has(run.id))].toSorted(
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

  return PeerRuns.of({ book, create, list, endRun, sync });
});

export const layer = Layer.effect(PeerRuns, make);
