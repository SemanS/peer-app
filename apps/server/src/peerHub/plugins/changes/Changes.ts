// @effect-diagnostics globalDate:off - a view is told in the reader's local clock; a mark is stamped with the time it was made.
/**
 * Changes: what each computer reports of its agents' Jujutsu changes (facts, never code), what the
 * Hub last said of everyone's, and the review marks of this person. A session's report is built
 * from read-only jj calls in its own workspace, at most every 10 seconds, at once when it stops;
 * the newest report per session waits while the Hub cannot be reached. The project view, the
 * status counts, `peer changes` and the start line read the Hub's last answer from memory. The
 * interface is what `make` returns, each member described there.
 *
 * @module peerHub/plugins/changes/Changes
 */
import {
  PEER_CHANGES_LIMITS,
  PeerHubError,
  type ChangeReport,
  type ChangeRow,
  type ChangesPlace,
  type MarkReviewedInput,
  type PeerChangesStatus,
  type ProjectChanges,
  type ReviewDiff,
  type ReviewDiffInput,
  type ReviewMark,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import {
  refused,
  type CliError,
  type PeerHookContext,
  type PeerSessionView,
} from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { checkoutKind, forgetCheckoutKind } from "../../core/vcs.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { plain } from "../../peerText.ts";
import * as Jj from "./client/jj.ts";
import { reviewDiffFor } from "./client/review.ts";
import * as Stack from "./client/stack.ts";
import { changesHub } from "./hub.ts";
import { indexText, startLine, type IndexRow, type Voice } from "./text.ts";

/** A session's report goes out at most this often. */
export const REPORT_EVERY_MS = 10_000;
/** A report or withdrawal the Hub could not take is tried again after this long, or at a resync. */
const RETRY_MS = 30_000;
/** A report that says what the last one did is not sent again until the Hub's row would age. */
const QUIET_MS = 5 * 60_000;
const LANDED_TTL_MS = 60_000;
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const NO_MARKS: typeof Reviewed.Type = { reviewed: {} };

const Reviewed = Schema.Struct({
  reviewed: Schema.Record(
    Schema.String,
    Schema.Struct({
      changeId: Schema.String,
      commit: Schema.String,
      version: Schema.Number,
      at: Schema.String,
      workspace: Schema.String,
      project: Schema.String,
    }),
  ),
});

/** What this computer keeps of one agent session's reports. */
interface Rec {
  readonly id: string;
  workspace: string;
  project: string;
  cwd: string;
  agent: string;
  task: string | undefined;
  seq: number;
  dueAt: number | undefined;
  lastSentAt: number;
  digest: string;
  reported: boolean;
  /** The newest report the Hub has not taken. */
  queued: ChangeReport | undefined;
  known: Map<string, Stack.Known>;
  /** The session's own changes at its last read, and everything between `@` and trunk. */
  own: ReadonlySet<string>;
  stack: ReadonlyArray<Jj.StackEntry>;
  problem: string | undefined;
}

type Event = { readonly kind: "wake" } | { readonly kind: "read"; readonly workspace: string };

type Sent = "sent" | "later" | "refused";

export class Changes extends Context.Service<
  Changes,
  {
    /** The status field: per project, how many changes are in flight and how many need a person. */
    readonly status: Effect.Effect<PeerChangesStatus>;
    /** A project's changes as this environment shows them, read from the Hub now when none were. */
    readonly view: (place: ChangesPlace) => Effect.Effect<ProjectChanges, PeerHubError>;
    /** The view now, then each time the Hub or this computer moves it. */
    readonly watch: (place: ChangesPlace) => Stream.Stream<ProjectChanges, PeerHubError>;
    /** A session took a step (or stopped, `urgent`): its report is due. Nothing waits on the Hub. */
    readonly touch: (session: PeerSessionView, urgent: boolean) => Effect.Effect<void>;
    /** A session ended: its rows are withdrawn. */
    readonly ended: (session: PeerSessionView) => Effect.Effect<void>;
    /** A person marks a version reviewed, or takes the mark back (null). */
    readonly markReviewed: (
      input: MarkReviewedInput,
    ) => Effect.Effect<ReviewMark | null, PeerHubError>;
    /** What moved in a change since the person's mark, or the whole change. */
    readonly reviewDiff: (input: ReviewDiffInput) => Effect.Effect<ReviewDiff, PeerHubError>;
    /** What `peer changes` prints, read from the Hub now. */
    readonly show: (session: PeerSessionView) => Effect.Effect<string, PeerHubError | CliError>;
    /** The start line of a session, from what the Hub last said. */
    readonly started: (ctx: PeerHookContext) => Effect.Effect<string | null>;
    /** The Hub said changes moved in a workspace: it is read within a moment. */
    readonly readSoon: (workspace: string) => Effect.Effect<void>;
    /** The Hub can be reached again: what waited goes now. */
    readonly flush: Effect.Effect<void>;
    /** Forgets one workspace's view, or every one (and what waits to be sent). */
    readonly forget: (workspace?: string) => Effect.Effect<void>;
    /** Forgets every workspace's view but these. */
    readonly keep: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
    /** The owner turned the plugin off: what it reported is withdrawn, best effort. */
    readonly withdrawAll: Effect.Effect<void>;
    /** Reads the Hub, reports as sessions step, until interrupted. */
    readonly run: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peerHub/plugins/changes/Changes") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const published = yield* PeerStatus.PeerStatus;
  const agents = yield* PeerAgents.PeerAgents;
  const work = yield* PeerWork.PeerWork;
  const hub = changesHub(yield* PeerHubClient.PeerHubClient);
  const data = state.pluginData("changes", Reviewed);
  const events = yield* Queue.unbounded<Event>();
  const bus = yield* Effect.acquireRelease(PubSub.unbounded<string>(), PubSub.shutdown);

  const recs = new Map<string, Rec>();
  /** workspace → project → what the Hub last said. */
  const views = new Map<string, Map<string, ReadonlyArray<ChangeRow>>>();
  const readAt = new Map<string, string>();
  const landed = new Map<string, { until: number; value: ProjectChanges["landed"] }>();
  /** Sessions that ended while the Hub could not hear it. */
  const withdrawals = new Map<string, { workspace: string; project: string; session: string }>();
  let retryAt: number | undefined;
  let support: PeerChangesStatus["hubSupport"] = "unknown";
  let contact: string | undefined;

  const locked = <A>(call: () => Promise<A>) => Effect.promise(() => Jj.attempt(call));
  const now = Clock.currentTimeMillis;
  const wake = Queue.offer(events, { kind: "wake" }).pipe(Effect.asVoid);

  const put = (workspace: string, rows: ReadonlyArray<ChangeRow> | null) =>
    Effect.gen(function* () {
      const was = support;
      const before = views.get(workspace);
      if (rows === null) {
        support = "unsupported";
        views.delete(workspace);
        for (const project of before?.keys() ?? [])
          yield* PubSub.publish(bus, `${workspace}/${project}`);
        return was !== support || before !== undefined;
      }
      support = "supported";
      contact = DateTime.formatIso(DateTime.makeUnsafe(yield* now));
      readAt.set(workspace, contact);
      const next = new Map<string, ReadonlyArray<ChangeRow>>();
      for (const row of rows) next.set(row.project, [...(next.get(row.project) ?? []), row]);
      views.set(workspace, next);
      let changed = was !== support || before === undefined;
      for (const project of new Set([...(before?.keys() ?? []), ...next.keys()])) {
        if (encodeJson(before?.get(project)) === encodeJson(next.get(project))) continue;
        changed = true;
        yield* PubSub.publish(bus, `${workspace}/${project}`);
      }
      return changed;
    });

  /** Reads a workspace from the Hub now and keeps it; null is a Hub without the feature. */
  const load = (workspace: string) =>
    Effect.gen(function* () {
      const answer = yield* hub.view(workspace);
      if (yield* put(workspace, answer === null ? null : answer.changes)) yield* published.publish;
      return answer;
    });
  const read = (workspace: string) => load(workspace).pipe(Effect.ignore);

  const rowsOf = (workspace: string, project: string) => views.get(workspace)?.get(project) ?? [];

  /** The task as the Hub's rows name it: its key, else its id. */
  const taskKey = (rec: Rec) =>
    rec.task === undefined
      ? Effect.succeed(undefined)
      : work.tasks(rec.workspace, rec.project).pipe(
          Effect.map((tasks) => {
            const found = tasks.find((task) => task.id === rec.task);
            return found?.key ?? rec.task;
          }),
        );

  /** Reads the session's workspace; null when it is no jj checkout or jj failed (kept in `problem`). */
  const analyse = (rec: Rec) =>
    Effect.gen(function* () {
      const kind = yield* Effect.promise(() => checkoutKind(rec.cwd));
      if (kind?.kind !== "jj") {
        rec.problem = undefined;
        return null;
      }
      const read = yield* Effect.promise(() => Jj.attempt(() => Stack.readOwn(rec.cwd)));
      if (!read.ok) {
        rec.problem = read.message;
        forgetCheckoutKind(rec.cwd);
        return null;
      }
      rec.problem = undefined;
      rec.stack = read.value.stack;
      rec.own = new Set(read.value.own.map((entry) => entry.changeId));
      return read.value.own;
    });

  const build = (rec: Rec) =>
    Effect.gen(function* () {
      const own = yield* analyse(rec);
      if (own === null) return null;
      const made = yield* Effect.promise(() =>
        Jj.attempt(() => Stack.reportedChanges(rec.cwd, own, rec.known)),
      );
      if (!made.ok) {
        rec.problem = made.message;
        return null;
      }
      const task = yield* taskKey(rec);
      rec.seq = Math.max(rec.seq + 1, yield* now);
      return {
        session: rec.id,
        seq: rec.seq,
        environment: state.environmentId,
        agent: rec.agent,
        ...(task === undefined ? {} : { task }),
        changes: made.value,
      } as ChangeReport;
    });

  const send = (rec: Rec, report: ChangeReport) =>
    Effect.gen(function* () {
      let body = report;
      for (let tries = 0; tries < 2; tries += 1) {
        const answer = yield* hub.report(rec.workspace, rec.project, body).pipe(Effect.result);
        if (answer._tag === "Failure") {
          if (answer.failure.refused === true) {
            yield* Effect.logWarning("the Hub refused a change report", {
              status: answer.failure.status,
              code: answer.failure.code,
            });
            return "refused" as Sent;
          }
          return "later" as Sent;
        }
        const value = answer.success;
        if (value === null) return "refused" as Sent;
        if (!("stale" in value)) return "sent" as Sent;
        // The Hub holds a higher seq (after a restart, say): continue from it, once.
        rec.seq = Math.max(value.stale + 1, rec.seq);
        body = { ...body, seq: rec.seq };
      }
      return "later" as Sent;
    });

  const reportNow = (rec: Rec) =>
    Effect.gen(function* () {
      rec.dueAt = undefined;
      const started = yield* now;
      const report = yield* build(rec);
      if (report === null) return;
      if (report.changes.length === 0 && !rec.reported && rec.queued === undefined) return;
      const digest = encodeJson(report.changes);
      if (rec.queued === undefined && digest === rec.digest && started - rec.lastSentAt < QUIET_MS)
        return;
      rec.queued = report;
      const outcome = yield* send(rec, report);
      const finished = yield* now;
      if (outcome === "later") {
        rec.dueAt = finished + RETRY_MS;
        return;
      }
      rec.queued = undefined;
      if (outcome === "refused") return;
      rec.reported = true;
      rec.digest = digest;
      rec.lastSentAt = finished;
      yield* agents.log("changes.reported", {
        changes: report.changes.length,
        ms: Math.max(0, finished - started),
      });
    });

  const withdraw = (target: { workspace: string; project: string; session: string }) =>
    Effect.gen(function* () {
      const key = `${target.workspace}/${target.project}/${target.session}`;
      const answer = yield* hub
        .withdraw(target.workspace, target.project, target.session)
        .pipe(Effect.result);
      if (answer._tag === "Success" || answer.failure.refused === true) {
        withdrawals.delete(key);
        return;
      }
      withdrawals.set(key, target);
      retryAt = (yield* now) + RETRY_MS;
    });

  const voiceOf = (workspace: string): Voice => ({
    person: (email) => state.nameOf(workspace, email),
  });

  /** The session's own changes and what they build on, from jj now (else from its last read). */
  const relations = (session: PeerSessionView, rows: ReadonlyArray<ChangeRow>) =>
    Effect.gen(function* () {
      const rec = recs.get(session.id) ?? fresh(session);
      yield* analyse(rec);
      const buildsOn = Stack.buildsOn(rec.stack, rec.own, rows);
      return { own: rec.own, buildsOn };
    });

  const fresh = (session: PeerSessionView): Rec => ({
    id: session.id,
    workspace: session.workspace,
    project: session.project,
    cwd: session.cwd,
    agent: session.agent,
    task: session.task,
    seq: 0,
    dueAt: undefined,
    lastSentAt: 0,
    digest: "",
    reported: false,
    queued: undefined,
    known: new Map(),
    own: new Set(),
    stack: [],
    problem: undefined,
  });

  const checkoutOf = (workspace: string, project: string) =>
    Effect.gen(function* () {
      const found = yield* state.project(workspace, project);
      const repository = found.project.repositories[0];
      const persisted = (yield* state.read).persisted;
      const candidates = [
        ...(repository === undefined
          ? []
          : [state.checkoutPath(persisted, workspace, project, repository.id)]),
        ...[...recs.values()]
          .filter((rec) => rec.workspace === workspace && rec.project === project)
          .map((rec) => rec.cwd),
      ];
      for (const cwd of candidates) {
        const kind = yield* Effect.promise(() => checkoutKind(cwd));
        if (kind?.kind === "jj") return { cwd, gitDir: kind.gitDir };
      }
      return yield* new PeerHubError({
        detail: "This project has no Jujutsu checkout on this computer.",
        refused: true,
      });
    });

  const landedOf = (workspace: string, project: string) =>
    Effect.gen(function* () {
      const key = `${workspace}/${project}`;
      const at = yield* now;
      const cached = landed.get(key);
      if (cached !== undefined && cached.until > at) return cached.value;
      const place = yield* checkoutOf(workspace, project).pipe(Effect.option);
      const trunk = Option.isNone(place)
        ? null
        : yield* locked(() => Jj.readTrunk(place.value.cwd));
      const value = trunk !== null && trunk.ok ? (trunk.value ?? undefined) : undefined;
      landed.set(key, { until: at + LANDED_TTL_MS, value });
      return value;
    });

  const marksOf = (rows: ReadonlyArray<ChangeRow>) =>
    data.read.pipe(
      Effect.map((stored) => {
        const reviewed = Option.getOrElse(stored, () => NO_MARKS).reviewed;
        return rows.flatMap(({ changeId }) => {
          const { commit, version, at } = reviewed[changeId] ?? {};
          return commit === undefined ? [] : [{ changeId, commit, version: version!, at: at! }];
        });
      }),
    );

  const compose = (workspace: string, project: string): Effect.Effect<ProjectChanges> =>
    Effect.gen(function* () {
      const live = new Set(
        [...recs.values()]
          .filter((rec) => rec.workspace === workspace && rec.project === project)
          .flatMap((rec) => [...rec.own]),
      );
      const rows = rowsOf(workspace, project).map((row): ChangeRow => {
        if (!live.has(row.changeId)) return row;
        const stat = Stack.linesOf(row.commitId);
        return {
          ...row,
          source: "live",
          ...(stat === undefined ? {} : { lines: stat }),
        };
      });
      const trunk = yield* landedOf(workspace, project);
      return {
        workspace,
        project,
        changes: rows,
        ...(trunk === undefined ? {} : { landed: trunk }),
        marks: yield* marksOf(rows),
        problems: [...recs.values()]
          .filter((rec) => rec.workspace === workspace && rec.project === project)
          .flatMap((rec) =>
            rec.problem === undefined
              ? []
              : [
                  {
                    workspace: rec.cwd.split("/").filter(Boolean).at(-1) ?? rec.cwd,
                    message: rec.problem,
                  },
                ],
          ),
        ...(readAt.has(workspace) ? { readAt: readAt.get(workspace)! } : {}),
      };
    });

  const drop = (workspace?: string) => {
    for (const slug of [...views.keys()])
      if (workspace === undefined || slug === workspace) views.delete(slug);
    for (const slug of [...readAt.keys()])
      if (workspace === undefined || slug === workspace) readAt.delete(slug);
    for (const [id, rec] of recs)
      if (workspace === undefined || rec.workspace === workspace) recs.delete(id);
    if (workspace === undefined) {
      support = "unknown";
      contact = undefined;
      landed.clear();
    }
  };

  return Changes.of({
    status: Effect.sync(() => {
      const projects = [...views].flatMap(([workspace, byProject]) =>
        [...byProject].map(([project, rows]) => ({
          workspace,
          project,
          inFlight: rows.length,
          needAttention: rows.filter((row) => row.conflict || row.divergent).length,
        })),
      );
      return {
        hubSupport: support,
        ...(contact === undefined ? {} : { lastContact: contact }),
        projects,
      } satisfies PeerChangesStatus;
    }),
    view: Effect.fn("Changes.view")(function* (place: ChangesPlace) {
      yield* state.project(place.workspace, place.project);
      if (!views.has(place.workspace)) yield* read(place.workspace);
      return yield* compose(place.workspace, place.project);
    }),
    watch: (place) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* state.project(place.workspace, place.project);
          if (!views.has(place.workspace)) yield* read(place.workspace);
          const key = `${place.workspace}/${place.project}`;
          const subscription = yield* PubSub.subscribe(bus);
          return Stream.concat(
            Stream.make(key),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((moved) => moved === key),
              Stream.debounce(300),
            ),
          ).pipe(
            Stream.mapEffect(() => compose(place.workspace, place.project)),
            Stream.changesWith((a, b) => encodeJson(a) === encodeJson(b)),
          );
        }),
      ),
    touch: (session, urgent) =>
      Effect.gen(function* () {
        if (session.public === true) return;
        const rec = recs.get(session.id) ?? fresh(session);
        recs.set(session.id, rec);
        rec.workspace = session.workspace;
        rec.project = session.project;
        rec.cwd = session.cwd;
        rec.agent = session.agent;
        rec.task = session.task;
        const at = yield* now;
        rec.dueAt = urgent ? at : (rec.dueAt ?? Math.max(at, rec.lastSentAt + REPORT_EVERY_MS));
        yield* wake;
      }),
    ended: (session) =>
      Effect.gen(function* () {
        const rec = recs.get(session.id);
        recs.delete(session.id);
        if (rec === undefined || !(rec.reported || rec.queued !== undefined)) return;
        yield* withdraw({ workspace: rec.workspace, project: rec.project, session: rec.id });
      }),
    markReviewed: Effect.fn("Changes.markReviewed")(function* (input: MarkReviewedInput) {
      const place = yield* checkoutOf(input.workspace, input.project);
      if (input.unmark === true) {
        yield* Effect.promise(() => Jj.unpinReviewed(place.gitDir, input.changeId));
        yield* data
          .update((current) => {
            const { [input.changeId]: _gone, ...rest } = Option.getOrElse(
              current,
              () => NO_MARKS,
            ).reviewed;
            return { reviewed: rest };
          })
          .pipe(state.lock.withPermits(1));
        yield* PubSub.publish(bus, `${input.workspace}/${input.project}`);
        return null;
      }
      if (!/^[0-9a-f]{40}$/.test(input.commit) || !/^[a-z]{1,32}$/.test(input.changeId))
        return yield* new PeerHubError({
          detail: "That is not a commit of a change.",
          refused: true,
        });
      if (!(yield* Effect.promise(() => Jj.storeHas(place.gitDir, input.commit))))
        return yield* new PeerHubError({
          detail: "That version is not on this computer yet: it is not pushed or shared.",
          refused: true,
        });
      const stored = yield* Effect.promise(() =>
        Jj.pinReviewed(place.gitDir, input.changeId, input.commit).then(
          () => null,
          (failure: unknown) => Jj.messageOf(failure),
        ),
      );
      if (stored !== null) return yield* new PeerHubError({ detail: stored, refused: true });
      const at = DateTime.formatIso(DateTime.makeUnsafe(yield* now));
      const mark = { changeId: input.changeId, commit: input.commit, version: input.version, at };
      yield* data
        .update((current) => ({
          reviewed: {
            ...Option.getOrElse(current, () => NO_MARKS).reviewed,
            [input.changeId]: { ...mark, workspace: input.workspace, project: input.project },
          },
        }))
        .pipe(state.lock.withPermits(1));
      yield* PubSub.publish(bus, `${input.workspace}/${input.project}`);
      return mark satisfies ReviewMark;
    }),
    reviewDiff: Effect.fn("Changes.reviewDiff")(function* (input: ReviewDiffInput) {
      const place = yield* checkoutOf(input.workspace, input.project);
      if (!views.has(input.workspace)) yield* read(input.workspace);
      const row = rowsOf(input.workspace, input.project).find(
        (candidate) => candidate.changeId === input.changeId,
      );
      if (row === undefined)
        return yield* new PeerHubError({
          detail: "That change is not in flight any more.",
          refused: true,
        });
      const mark = Option.getOrUndefined(yield* data.read)?.reviewed[input.changeId];
      const result = yield* locked(() =>
        reviewDiffFor({
          cwd: place.cwd,
          changeId: input.changeId,
          mode: input.mode,
          versions: row.versions,
          mark: mark === undefined ? undefined : { commit: mark.commit, version: mark.version },
          from: input.from,
        }),
      );
      return result.ok
        ? result.value
        : yield* new PeerHubError({ detail: result.message, refused: true });
    }),
    show: Effect.fn("Changes.show")(function* (session: PeerSessionView) {
      const answer = yield* hub.view(session.workspace, session.project, 8_000).pipe(Effect.result);
      if (answer._tag === "Success" && answer.success === null)
        return yield* Effect.fail(
          refused("this Peer Hub cannot list changes", "ask your person to update the Peer Hub."),
        );
      if (answer._tag === "Success")
        yield* put(session.workspace, answer.success!.changes).pipe(Effect.ignore);
      else if (!views.has(session.workspace)) return yield* Effect.fail(answer.failure);
      const rows = rowsOf(session.workspace, session.project);
      const { own, buildsOn } = yield* relations(session, rows);
      const found = yield* state.project(session.workspace, session.project);
      const indexed: IndexRow[] = rows.map((row) => ({
        row,
        mine: own.has(row.changeId),
        buildsOn: buildsOn.get(row.changeId),
      }));
      return indexText({
        project: found.project.name,
        rows: indexed,
        readAt: Date.parse(readAt.get(session.workspace) ?? "") || (yield* now),
        voice: voiceOf(session.workspace),
      });
    }),
    started: ({ session }) =>
      Effect.gen(function* () {
        const rows = rowsOf(session.workspace, session.project);
        if (rows.length === 0) return null;
        const { own, buildsOn } = yield* relations(session, rows);
        const below = new Map([...buildsOn.values()].map((row) => [row.changeId, row]));
        return startLine({
          buildsOn: [...below.values()],
          others: rows.filter((row) => !own.has(row.changeId) && !below.has(row.changeId)),
          voice: voiceOf(session.workspace),
        });
      }).pipe(Effect.orElseSucceed(() => null)),
    readSoon: (workspace) => Queue.offer(events, { kind: "read", workspace }).pipe(Effect.asVoid),
    flush: Effect.gen(function* () {
      const at = yield* now;
      for (const rec of recs.values()) if (rec.queued !== undefined) rec.dueAt = at;
      if (withdrawals.size > 0) retryAt = at;
      yield* wake;
    }),
    forget: (workspace) =>
      Effect.sync(() => drop(workspace)).pipe(Effect.andThen(Queue.clear(events)), Effect.asVoid),
    keep: (workspaces) =>
      Effect.sync(() => {
        for (const slug of views.keys()) if (!workspaces.includes(slug)) drop(slug);
      }),
    withdrawAll: Effect.gen(function* () {
      const reported = [...recs.values()].filter((rec) => rec.reported);
      recs.clear();
      for (const rec of reported)
        yield* withdraw({ workspace: rec.workspace, project: rec.project, session: rec.id });
      withdrawals.clear();
    }),
    run: Effect.gen(function* () {
      for (const { slug } of yield* state.workspaces) yield* read(slug);
      while (true) {
        const at = yield* now;
        const due = [...recs.values()].flatMap((rec) =>
          rec.dueAt === undefined ? [] : [rec.dueAt],
        );
        if (retryAt !== undefined) due.push(retryAt);
        const first =
          due.length === 0
            ? Option.some(yield* Queue.take(events))
            : yield* Queue.take(events).pipe(
                Effect.timeoutOption(`${Math.max(0, Math.min(...due) - at)} millis`),
              );
        const batch = Option.isSome(first) ? [first.value, ...(yield* Queue.clear(events))] : [];
        const reads = new Set(
          batch.flatMap((event) => (event.kind === "read" ? [event.workspace] : [])),
        );
        if (reads.size > 0) {
          // A burst of pings reads each workspace once.
          yield* Effect.sleep("300 millis");
          for (const event of yield* Queue.clear(events))
            if (event.kind === "read") reads.add(event.workspace);
          for (const workspace of reads) yield* read(workspace);
        }
        const later = yield* now;
        for (const rec of [...recs.values()])
          if (rec.dueAt !== undefined && rec.dueAt <= later) yield* reportNow(rec);
        if (retryAt !== undefined && retryAt <= later) {
          retryAt = undefined;
          for (const target of [...withdrawals.values()]) yield* withdraw(target);
        }
      }
    }),
  });
});

export const layer = Layer.effect(Changes, make);
