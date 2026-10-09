// @effect-diagnostics nodeBuiltinImport:off - the adapter owns a private scratch directory.
import * as NodePath from "node:path";
import { boundForecast, type PeerForecast, type PeerForecastConfigure } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform, HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import { PeerState, projectKey } from "../../core/state/PeerState.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import { VcsProcess, layer as vcsLayer } from "../../../vcs/VcsProcess.ts";
import { createGit, type Repository, type MergeResult } from "./git.ts";
import { selectSubjects, pairsOf, type Subject } from "./subjects.ts";
import {
  newSchedule,
  candidates,
  observeTips,
  recordResult,
  resultOf,
  type Candidate,
} from "./schedule.ts";
import {
  POLL_MS,
  IDLE_MS,
  KICK_MS,
  ROUND_MS,
  REFRESH_GAP_MS,
  FETCH_GAP_MS,
  FETCH_BACKOFF_MS,
} from "./limits.ts";

export type ForecastPair = Candidate & {
  left: Subject;
  right: Subject;
  git: Repository;
  result?: MergeResult | undefined;
  checkedAt?: number;
};
const iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at));
const empty = (reason: PeerForecast["reason"] = "disabled"): PeerForecast => ({
  state: "off",
  reason,
  teammates: false,
  pairs: [],
  tracked: 0,
  skipped: 0,
  notOnOrigin: 0,
  paused: [],
});
const digest = (value: PeerForecast) => JSON.stringify({ ...value, checkedAt: undefined });

/** The worker and explicit command share one lock and one process budget; hooks only read memory. */
export function makeForecast(
  state: PeerState["Service"],
  git: ReturnType<typeof createGit>,
  log: PeerAgents["Service"]["log"],
  forcedOff = false,
) {
  return Effect.gen(function* () {
    const lock = yield* Semaphore.make(1),
      queue = yield* Queue.dropping<void>(1);
    const changes = yield* Effect.acquireRelease(PubSub.unbounded<PeerForecast>(), PubSub.shutdown);
    const data = state.pluginData("forecast", Schema.Struct({ teammates: Schema.Boolean }));
    let snapshot = empty(forcedOff ? "environment" : "disabled"),
      schedule = newSchedule(),
      records: ForecastPair[] = [],
      active = false;
    const fetchAt = new Map<string, number>(),
      refreshAt = new Map<string, number>();
    const publish = (next: PeerForecast) =>
      Effect.gen(function* () {
        const bounded = boundForecast(next),
          changed = digest(snapshot) !== digest(bounded);
        snapshot = bounded;
        if (changed) yield* PubSub.publish(changes, snapshot);
      });
    const stop = Effect.gen(function* () {
      active = false;
      records = [];
      schedule = newSchedule();
      fetchAt.clear();
      refreshAt.clear();
      yield* publish(empty(forcedOff ? "environment" : "disabled"));
    });
    const boot = Effect.gen(function* () {
      if (forcedOff) return yield* stop;
      yield* git.sweepScratch();
      const probe = yield* git.probeGit(),
        config = Option.getOrElse(yield* data.read, () => ({ teammates: false }));
      active = probe.state === "supported";
      yield* publish({
        ...empty(),
        state: active ? "on" : "unsupported",
        ...(active ? { reason: undefined } : { reason: probe.state as PeerForecast["reason"] }),
        git: probe.version,
        teammates: config.teammates,
      });
      yield* log("forecast.git", { state: probe.state, version: probe.version });
    });
    const round = (force?: PeerSessionView) =>
      Effect.gen(function* () {
        if (!active) return;
        const start = yield* Clock.currentTimeMillis,
          s = yield* state.read;
        let fetchFailedAt = snapshot.fetchFailedAt,
          tracked = 0,
          skipped = 0,
          notOnOrigin = 0,
          merges = 0,
          reused = 0;
        const next: ForecastPair[] = [],
          tips = new Map<string, string>();
        const compute = Effect.gen(function* () {
          for (const workspace of s.persisted.workspaces)
            for (const project of workspace.manifest?.projects ?? [])
              for (const repo of project.repositories) {
                const selected = selectSubjects({
                  workspace: workspace.slug,
                  project: project.id,
                  repository: repo.id,
                  base: repo.branch,
                  email: s.persisted.email ?? "",
                  environment: state.environmentId,
                  teammates: snapshot.teammates,
                  local: s.localThreads.get(workspace.slug) ?? [],
                  remote: s.work.get(projectKey(workspace.slug, project.id))?.threads ?? [],
                  tasks: s.work.get(projectKey(workspace.slug, project.id))?.tasks ?? [],
                });
                tracked += selected.subjects.length;
                skipped += selected.skipped;
                if (pairsOf(selected.subjects).length === 0) continue;
                const info = yield* git
                  .discoverRepository(
                    state.checkoutPath(s.persisted, workspace.slug, project.id, repo.id),
                  )
                  .pipe(Effect.option);
                if (Option.isNone(info)) continue;
                const repository = info.value,
                  remote = selected.subjects.filter((v) => v.where === "origin"),
                  now = yield* Clock.currentTimeMillis;
                if (
                  snapshot.teammates &&
                  remote.length > 0 &&
                  now >= (fetchAt.get(repository.common) ?? 0)
                ) {
                  const fetch = yield* git.fetchBranches(
                    repository,
                    remote.map((v) => v.branch),
                  );
                  fetchAt.set(
                    repository.common,
                    now + (fetch.state === "done" ? FETCH_GAP_MS : FETCH_BACKOFF_MS),
                  );
                  if (fetch.state === "failed") fetchFailedAt = iso(now);
                }
                const ids = yield* git
                  .readTips(
                    repository,
                    selected.subjects.map((v) => v.ref),
                  )
                  .pipe(Effect.orElseSucceed(() => new Map<string, string>()));
                for (const [ref, id] of ids) tips.set(`${repository.common}:${ref}`, id);
                notOnOrigin += remote.filter((v) => !ids.has(v.ref)).length;
                for (const { a: left, b: right } of pairsOf(selected.subjects)) {
                  const a = ids.get(left.ref),
                    b = ids.get(right.ref);
                  if (a === undefined || b === undefined) continue;
                  const key = [
                    workspace.slug,
                    project.id,
                    repo.id,
                    ...[left.branch, right.branch].sort(),
                  ].join("/");
                  next.push({
                    key,
                    repository: repository.common,
                    a,
                    b,
                    refs: [`${repository.common}:${left.ref}`, `${repository.common}:${right.ref}`],
                    left,
                    right,
                    git: repository,
                  });
                }
              }
          observeTips(schedule, tips, yield* Clock.currentTimeMillis);
          const own = force === undefined ? next : next.filter((p) => onSide(p, force));
          // A duty-cycle wait is shared across rounds, and remains inside the round deadline.
          const wait = schedule.nextMergeAt - (yield* Clock.currentTimeMillis);
          if (wait > 0) yield* Effect.sleep(wait);
          const selected = candidates(
            schedule,
            own,
            yield* Clock.currentTimeMillis,
            force !== undefined,
          );
          yield* git.withScratch((objects) =>
            Effect.gen(function* () {
              for (const pair of selected) {
                const wait = schedule.nextMergeAt - (yield* Clock.currentTimeMillis);
                if (wait > 0) yield* Effect.sleep(wait);
                const at = yield* Clock.currentTimeMillis;
                const result = yield* git.mergeTree(pair.git, objects, pair.a, pair.b);
                recordResult(schedule, pair, result, at, (yield* Clock.currentTimeMillis) - at);
                merges++;
              }
            }),
          );
        });
        yield* compute.pipe(Effect.timeoutOption(ROUND_MS), Effect.ignore);
        for (const pair of next) {
          const memo = resultOf(schedule, pair);
          if (memo) {
            pair.result = memo.result;
            pair.checkedAt = memo.checkedAt;
            reused++;
          }
        }
        // Membership/setting changes during I/O discard the old round rather than resurrecting it.
        if (!active || state.current().persisted !== s.persisted) return;
        records = next;
        const now = yield* Clock.currentTimeMillis;
        yield* publish({
          ...snapshot,
          tracked,
          skipped,
          notOnOrigin,
          fetchFailedAt,
          checkedAt: iso(now),
          pairs: next.flatMap((pair) =>
            pair.result?.state === "conflict"
              ? [
                  {
                    workspace: pair.left.workspace,
                    project: pair.left.project,
                    repository: pair.left.repository,
                    a: side(pair.left),
                    b: side(pair.right),
                    files: pair.result.files,
                    more: pair.result.more,
                    checkedAt: iso(pair.checkedAt!),
                  },
                ]
              : [],
          ),
          paused: [...schedule.paused]
            .filter(([, until]) => until > now)
            .map(([repository, until]) => ({ repository, until: iso(until) })),
        });
        yield* log("forecast.round", {
          branches: tracked,
          reused: Math.max(0, reused - merges),
          merges,
          deferred: next.filter((p) => p.result === undefined).length,
          ms: now - start,
        });
      }).pipe(lock.withPermits(1));
    const kick = Queue.offer(queue, undefined).pipe(Effect.asVoid);
    const run = Effect.acquireUseRelease(
      boot.pipe(Effect.ignore),
      () =>
        Effect.gen(function* () {
          if (!active) return yield* Effect.never;
          while (true) {
            yield* round();
            yield* Effect.race(
              Queue.take(queue).pipe(Effect.andThen(Effect.sleep(KICK_MS))),
              Effect.sleep(records.length === 0 ? IDLE_MS : POLL_MS),
            );
          }
        }),
      () => stop.pipe(Effect.andThen(git.sweepScratch()), Effect.ignore),
    );
    return {
      read: Effect.sync(() => snapshot),
      boot,
      stop,
      forget: (workspace?: string) =>
        Effect.gen(function* () {
          records =
            workspace === undefined
              ? []
              : records.filter((pair) => pair.left.workspace !== workspace);
          schedule = newSchedule();
          yield* publish({
            ...snapshot,
            pairs:
              workspace === undefined
                ? []
                : snapshot.pairs.filter((pair) => pair.workspace !== workspace),
          });
        }),
      run,
      round,
      kick,
      pairs: Effect.sync(() => records),
      forSession: (session: PeerSessionView) => records.filter((pair) => onSide(pair, session)),
      refresh: (session: PeerSessionView) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (now - (refreshAt.get(session.id) ?? -Infinity) >= REFRESH_GAP_MS) {
            refreshAt.set(session.id, now);
            yield* round(session);
          }
          return snapshot;
        }),
      configure: (input: PeerForecastConfigure) =>
        Effect.gen(function* () {
          if (input.teammates !== undefined) {
            yield* data
              .update(() => ({ teammates: input.teammates! }))
              .pipe(state.lock.withPermits(1));
            yield* lock.withPermits(1)(
              Effect.gen(function* () {
                records = records.filter(
                  (p) => p.left.where === "here" && p.right.where === "here",
                );
                yield* publish({
                  ...snapshot,
                  teammates: input.teammates!,
                  notOnOrigin: input.teammates! ? snapshot.notOnOrigin : 0,
                  pairs: snapshot.pairs.filter((p) => p.a.where === "here" && p.b.where === "here"),
                });
              }),
            );
            yield* kick;
          }
          return snapshot;
        }),
      changes: Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.make(snapshot),
            Stream.fromSubscription(subscription).pipe(Stream.debounce(1000)),
          ).pipe(Stream.changesWith((a, b) => digest(a) === digest(b)));
        }),
      ),
    };
  });
}
export const onSide = (pair: ForecastPair, session: PeerSessionView) =>
  pair.left.workspace === session.workspace &&
  pair.left.project === session.project &&
  pair.left.repository === session.repositoryId &&
  (pair.left.branch === session.branch || pair.right.branch === session.branch);
const side = (subject: Subject) => ({
  branch: subject.branch,
  email: subject.email,
  title: subject.title,
  task: subject.task,
  where: subject.where,
});
export class Forecast extends Context.Service<
  Forecast,
  Effect.Success<ReturnType<typeof makeForecast>>
>()("t3/peerHub/plugins/forecast/ForecastService/Forecast") {}
export const layer = Layer.effect(
  Forecast,
  Effect.gen(function* () {
    const state = yield* PeerState,
      agents = yield* PeerAgents,
      vcs = yield* VcsProcess;
    return yield* makeForecast(
      state,
      createGit(vcs, NodePath.join(state.hubHome, "coord", "forecast"), yield* HostProcessPlatform),
      agents.log,
      (yield* HostProcessEnvironment).PEER_FORECAST === "off",
    );
  }),
).pipe(Layer.provide(vcsLayer.pipe(Layer.provide(NodeServices.layer))));
