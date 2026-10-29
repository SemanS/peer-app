/**
 * Settle: an overlap whose agents ended still reaches its end. When a Claude Code or Codex session
 * that is not one of Peer's threads ends with an open overlap it is to close, the register keeps it;
 * the loop resumes that conversation once, headless, with the settle nudge, and when that cannot be
 * done or did not answer, it hands the overlap to the person with a note both people read.
 *
 * @module peerHub/plugins/settle/service
 */
import {
  PeerHubError,
  settleHandover,
  type PeerHubStatus,
  type PeerSettleStatus,
  type SettleHandoverReason,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";

import { ServerConfig } from "../../../config.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { resumeNative } from "../../core/coordination/PeerCoordination.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { type PeerSessionEndingContext, settleCandidate, settleNudge } from "../../core/plugin.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { PeerWork } from "../../core/work/PeerWork.ts";
import { settleHub } from "./hub.ts";
import {
  emptyRegister,
  entryKey,
  fileRegister,
  type SettleEntry,
  type SettleRegister,
} from "./register.ts";

/** How long after its end a session may still be resumed (design D4). */
export const SETTLE_WINDOW_MS = 10 * 60_000;
/** How long one resumption may run before it is killed (design D3). */
export const SETTLE_RESUME_TIMEOUT_MS = 5 * 60_000;
export const SETTLE_LOOP_MS = 15_000;
/**
 * How long a handover note is retried while the Hub cannot be reached, and how long a finished
 * entry is kept so the same pair is not resumed again.
 */
const KEEP_MS = 60 * 60_000;
const RESUMED =
  "Peer resumed this conversation only to settle that overlap: answer with that peer command, not with more work.";

/**
 * The CLI seam: core's `resumeNative` by default. A test gives a stand-in, never this person's CLIs.
 *
 * Codex form, checked 2026-10-29 against codex-cli 0.165.0-alpha.1.2: `codex exec resume
 * [SESSION_ID] [PROMPT]` takes the "Conversation/session id (UUID) or thread name". Peer's Codex
 * hooks report that UUID as `session_id` (the same id `codex queue --thread` is given), so the
 * native id of a `codex:<id>` session is what it takes; no rollout path is needed.
 */
export class SettleResumer extends Context.Reference<typeof resumeNative>(
  "t3/peerHub/plugins/settle/service/SettleResumer",
  { defaultValue: () => resumeNative },
) {}

type View = Effect.Success<ReturnType<PeerAgents["Service"]["view"]>>;
type Overlap = View["overlaps"][number];

const notesBy = (overlap: Overlap, session: string) =>
  overlap.notes.filter((note) => note.session === session).length;
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
/** What a CLI that has no such conversation says; anything else that fails is "resume failed". */
const NOT_FOUND = /no (conversation|session|thread|rollout)[^\n]*found|not found|does not exist/i;

export class Settle extends Context.Service<
  Settle,
  {
    readonly read: Effect.Effect<PeerSettleStatus>;
    readonly ending: (ctx: PeerSessionEndingContext) => Effect.Effect<void>;
    readonly setResume: (enabled: boolean) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** One pass over the register: what the loop does every 15 s. */
    readonly pass: Effect.Effect<void>;
    /** Waits for the resumptions running now to end and be judged. */
    readonly drain: Effect.Effect<void>;
    /** Forgets what waits, so turning the plugin on again resumes nothing old. */
    readonly stop: Effect.Effect<void>;
    readonly run: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peerHub/plugins/settle/service/Settle") {}

/** @public The service is tested with a stand-in CLI and Hub at its boundary. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig,
    agents = yield* PeerAgents,
    status = yield* PeerStatus,
    state = yield* PeerState,
    client = yield* PeerHubClient,
    work = yield* PeerWork,
    resume = yield* SettleResumer;
  const io = fileRegister(config.stateDir),
    hub = settleHub(client),
    lock = yield* Semaphore.make(1),
    writing = yield* Semaphore.make(1),
    wake = yield* Queue.dropping<void>(1),
    attempts = yield* FiberSet.make<void>();
  let register: SettleRegister = yield* Effect.tryPromise(() => io.read()).pipe(
    Effect.orElseSucceed(emptyRegister),
  );
  const running = new Set<string>();

  // One write at a time: they share the temporary file.
  const write = Effect.suspend(() => {
    const value = register;
    return Effect.tryPromise({
      try: () => io.write(value),
      catch: () => new PeerHubError({ detail: "Could not save the settle register." }),
    });
  }).pipe(writing.withPermits(1));
  const save = write.pipe(Effect.ignoreCause({ log: true }));
  const update = (key: string, change: (entry: SettleEntry) => SettleEntry) => {
    register = {
      ...register,
      entries: register.entries.map((entry) => (entryKey(entry) === key ? change(entry) : entry)),
    };
  };
  const log = (event: string, entry: SettleEntry, fields: Record<string, unknown> = {}) =>
    agents.log(`settle.${event}`, { overlap: entry.overlap, session: entry.session, ...fields });
  const publish = status.publish.pipe(Effect.asVoid);

  const snapshot = (): PeerSettleStatus => ({
    resume: register.resume,
    attempts: register.entries.flatMap((entry) =>
      entry.startedAt !== undefined && entry.doneAt === undefined && running.has(entryKey(entry))
        ? [
            {
              overlap: entry.overlap,
              workspace: entry.workspace,
              project: entry.project,
              session: entry.session,
              since: entry.startedAt,
            },
          ]
        : [],
    ),
  });
  const read = Effect.sync(snapshot);

  const finish = (entry: SettleEntry, why: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      update(entryKey(entry), (current) => {
        const { handover: _, ...rest } = current;
        return { ...rest, doneAt: iso(now) };
      });
      yield* log("done", entry, { why });
    });

  const signedIn = Effect.gen(function* () {
    const persisted = state.current().persisted;
    return persisted.email !== null && Option.isSome(yield* client.storedSession);
  });
  const coordinating = (workspace: string) => {
    const persisted = state.current().persisted;
    return (
      (persisted.coordination?.enabled ?? true) &&
      persisted.workspaces.some((candidate) => candidate.slug === workspace)
    );
  };

  /** Writes the handover note; while the Hub cannot take it, the entry waits for the next pass. */
  const handOver = (entry: SettleEntry, reason: SettleHandoverReason) =>
    Effect.gen(function* () {
      update(entryKey(entry), (current) => ({ ...current, handover: reason }));
      const email = state.current().persisted.email;
      const agent = `${email === null ? "Your" : `${state.nameOf(entry.workspace, email)}'s`} agent`;
      const written = yield* hub
        .handover({
          workspace: entry.workspace,
          project: entry.project,
          overlap: entry.overlap,
          text: settleHandover({ agent, reason }),
          op: `settle-handover:${entry.overlap}:${entry.session}`,
        })
        .pipe(
          Effect.as(true),
          Effect.catchTags({
            PeerHubError: (error) =>
              log("handover.failed", entry, { reason, error: error.detail }).pipe(Effect.as(false)),
          }),
        );
      if (!written) return;
      yield* finish(entry, `handover:${reason}`);
      yield* agents.hubChanged;
    });

  const nudge = (entry: SettleEntry, overlap: Overlap) =>
    Effect.gen(function* () {
      const tasks = overlap.files.flatMap((file) =>
        file.startsWith("task:") ? [file.slice("task:".length)] : [],
      );
      const names = new Map<string, string>();
      for (const task of tasks)
        names.set(task, yield* work.taskName(entry.workspace, entry.project, task));
      const other = overlap.notes.findLast(
        (note) => note.session !== undefined && note.session !== entry.session,
      );
      const otherName =
        other === undefined
          ? "an agent no longer at work"
          : `${state.nameOf(entry.workspace, other.email)}'s agent`;
      return `${settleNudge({
        overlap,
        other: otherName,
        otherEnded: true,
        taskName: (task) => names.get(task) ?? task,
        cli: "peer",
      })} ${RESUMED}`;
    });

  /** One resumption, judged by the overlap afterwards: an answer of the session's settles it. */
  const attempt = (entry: SettleEntry, text: string) =>
    Effect.gen(function* () {
      const key = entryKey(entry);
      const outcome = yield* Effect.promise(() =>
        resume(entry.agent as "claude" | "codex", entry.nativeId, entry.cwd, text, {
          timeoutMs: SETTLE_RESUME_TIMEOUT_MS,
        }),
      );
      yield* log(outcome.status === "ended" ? "resumed" : "failed", entry, {
        status: outcome.status,
        exit: outcome.exit,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        ...(outcome.stderr === undefined ? {} : { stderr: outcome.stderr }),
      });
      yield* agents.sync(entry.workspace, 2_000);
      yield* Effect.gen(function* () {
        const current = register.entries.find((candidate) => entryKey(candidate) === key);
        if (current === undefined || current.doneAt !== undefined) return;
        const overlap = (yield* agents.view(entry.workspace)).overlaps.find(
          (candidate) => candidate.id === entry.overlap,
        );
        if (overlap === undefined || overlap.state !== "open")
          return yield* finish(current, "closed");
        if (notesBy(overlap, entry.session) > (current.notesAtStart ?? current.notesAtEnd))
          return yield* finish(current, "answered");
        const reason: SettleHandoverReason =
          outcome.status === "timeout"
            ? "timeout"
            : outcome.status === "ended"
              ? "ended-again"
              : outcome.reason === "off"
                ? "off"
                : NOT_FOUND.test(`${outcome.reason ?? ""}\n${outcome.stderr ?? ""}`)
                  ? "not-found"
                  : "failed";
        yield* handOver(current, reason);
      }).pipe(lock.withPermits(1));
      running.delete(key);
      yield* save;
      yield* publish;
    }).pipe(Effect.ensuring(Effect.sync(() => running.delete(entryKey(entry)))));

  /** Design D4's guards, at the moment of the spawn. */
  const judge = (entry: SettleEntry, now: number) =>
    Effect.gen(function* () {
      const view = yield* agents.view(entry.workspace);
      const overlap = view.overlaps.find((candidate) => candidate.id === entry.overlap);
      if (overlap === undefined || overlap.state !== "open") return yield* finish(entry, "closed");
      if (entry.handover !== undefined) return yield* handOver(entry, entry.handover);
      // An attempt Peer's restart cut short: its process went with the old Peer.
      if (entry.startedAt !== undefined)
        return notesBy(overlap, entry.session) > (entry.notesAtStart ?? entry.notesAtEnd)
          ? yield* finish(entry, "answered")
          : yield* handOver(entry, "failed");
      if (notesBy(overlap, entry.session) > entry.notesAtEnd)
        return yield* finish(entry, "answered");
      if ((yield* agents.sessions).some((session) => session.id === entry.session))
        return yield* finish(entry, "reopened");
      const atWork = new Set(view.sessions.map((session) => session.id));
      if (overlap.sessions.some((id) => id !== entry.session && atWork.has(id))) {
        // The agent at work closes it and hears so at its next step.
        if (now - Date.parse(entry.endedAt) > SETTLE_WINDOW_MS)
          yield* finish(entry, "other-at-work");
        return;
      }
      const ended = overlap.sessions.filter((id) => !atWork.has(id));
      if (settleCandidate(overlap, ended) !== entry.session)
        return yield* finish(entry, "not-candidate");
      if (!register.resume) return yield* handOver(entry, "off");
      if (!entry.resumable) return yield* handOver(entry, "no-resume");
      if (
        entry.task !== undefined &&
        (yield* work.tasks(entry.workspace, entry.project)).some(
          (task) => task.id === entry.task && task.status === "done",
        )
      )
        return yield* finish(entry, "task-done");
      if (now - Date.parse(entry.endedAt) > SETTLE_WINDOW_MS)
        return yield* handOver(entry, "timeout");
      if (entry.attempts > 0) return yield* handOver(entry, "ended-again");
      const text = yield* nudge(entry, overlap);
      const started = {
        ...entry,
        attempts: entry.attempts + 1,
        startedAt: iso(now),
        notesAtStart: notesBy(overlap, entry.session),
      };
      update(entryKey(entry), () => started);
      running.add(entryKey(entry));
      // Saved before the spawn, so a restart during it never spawns a second one.
      yield* save;
      yield* log("resuming", entry, { agent: entry.agent });
      // The nudge is its prompt: core must not say it again at the resumed session's first step.
      agents.markSettled?.(entry.session, entry.overlap, overlap.notes.length);
      yield* FiberSet.run(attempts, attempt(started, text));
    });

  const pass = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const ready = yield* signedIn;
    const before = snapshot().attempts.length;
    register = {
      ...register,
      entries: register.entries.filter(
        (entry) => now - Date.parse(entry.doneAt ?? entry.endedAt) <= KEEP_MS,
      ),
    };
    for (const entry of register.entries) {
      if (entry.doneAt !== undefined || running.has(entryKey(entry))) continue;
      if (!ready || !coordinating(entry.workspace)) {
        // Nothing to resume or hand over from here; past the window it is let go.
        if (now - Date.parse(entry.endedAt) > SETTLE_WINDOW_MS)
          yield* finish(entry, "not-coordinating");
        continue;
      }
      yield* judge(entry, now);
    }
    yield* save;
    if (snapshot().attempts.length !== before) yield* publish;
  }).pipe(lock.withPermits(1));

  const ending = ({ session, overlaps }: PeerSessionEndingContext) =>
    Effect.gen(function* () {
      // A Peer thread is resumed by core's dormant wake, not here.
      if (session.thread !== undefined) return;
      const now = yield* Clock.currentTimeMillis;
      const known = new Set(register.entries.map(entryKey));
      const added: Array<SettleEntry> = [];
      for (const overlap of overlaps) {
        if (overlap.policy !== "coordinate") continue;
        // Whether it closes it or the other ended too is the loop's to tell, once both are gone.
        if (settleCandidate(overlap, [session.id]) !== session.id) continue;
        const key = entryKey({ overlap: overlap.id, session: session.id });
        // A resumed session ends too: its one attempt is judged by the loop, not started again.
        if (known.has(key)) continue;
        added.push({
          overlap: overlap.id,
          workspace: overlap.workspace,
          project: overlap.project,
          session: session.id,
          agent: session.agent,
          nativeId: session.id.slice(session.agent.length + 1),
          cwd: session.cwd,
          ...(session.task === undefined ? {} : { task: session.task }),
          resumable:
            session.adapter !== "mcp" && (session.agent === "claude" || session.agent === "codex"),
          endedAt: iso(now),
          notesAtEnd: overlap.notes.filter((note) => note.session === session.id).length,
          attempts: 0,
        });
      }
      if (added.length === 0) return;
      register = { ...register, entries: [...register.entries, ...added] };
      yield* save;
      for (const entry of added) yield* log("ended", entry, { resumable: entry.resumable });
      yield* Queue.offer(wake, undefined);
    });

  return Settle.of({
    read,
    ending,
    pass,
    drain: FiberSet.awaitEmpty(attempts),
    setResume: (enabled) =>
      Effect.gen(function* () {
        register = { ...register, resume: enabled };
        yield* write;
        return yield* status.publish;
      }).pipe(lock.withPermits(1)),
    stop: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      register = {
        ...register,
        entries: register.entries.map((entry) =>
          entry.doneAt !== undefined || running.has(entryKey(entry))
            ? entry
            : { ...entry, doneAt: iso(now) },
        ),
      };
      yield* save;
    }).pipe(lock.withPermits(1)),
    run: Effect.gen(function* () {
      while (true) {
        yield* pass;
        yield* Effect.race(Queue.take(wake), Effect.sleep(SETTLE_LOOP_MS));
      }
    }),
  });
});

export const layer = Layer.effect(Settle, make);
