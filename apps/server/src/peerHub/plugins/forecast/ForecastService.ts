// @effect-diagnostics nodeBuiltinImport:off - the adapter owns a private scratch directory.
import * as NodePath from "node:path";
import {
  boundForecast,
  type PeerForecast,
  type PeerForecastConfigure,
  type PeerForecastPair,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { PeerState, projectKey } from "../../core/state/PeerState.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import { VcsProcess, layer as vcsLayer } from "../../../vcs/VcsProcess.ts";
import { createGit, sharedRef, type Repository, type MergeResult } from "./git.ts";
import { createJj, type JjClient } from "./client/jj.ts";
import { selectSubjects, pairsOf, type Subject } from "./subjects.ts";
import { inheritance, laterOf, sidesOf, workingCopyFor } from "./jjSources.ts";
import { makeShare, type Want } from "./share.ts";
import { makeChecks } from "./check.ts";
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
  SHARED_FETCH_GAP_MS,
  ForecastData,
} from "./limits.ts";

export type ForecastPair = Candidate & {
  left: Subject;
  right: Subject;
  git: Repository;
  result?: MergeResult | undefined;
  checkedAt?: number;
  /** A Jujutsu checkout: where its jj runs, and which side's change is the later one. */
  checkout?: string;
  later?: "a" | "b";
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
  jj?: JjClient,
) {
  return Effect.gen(function* () {
    const lock = yield* Semaphore.make(1),
      queue = yield* Queue.dropping<void>(1);
    const changes = yield* Effect.acquireRelease(PubSub.unbounded<PeerForecast>(), PubSub.shutdown);
    const data = state.pluginData("forecast", ForecastData);
    const share = jj === undefined ? undefined : makeShare(git, log);
    const checks =
      jj === undefined
        ? undefined
        : yield* makeChecks(jj, log, () => Queue.offer(queue, undefined));
    const inherit = inheritance(git),
      jjKinds = new Map<string, { jj: boolean; until: number }>(),
      fetchedAt = new Map<string, number>();
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
      // Sharing ends with the plugin: nothing of this person's stays on origin.
      if (share !== undefined) yield* share.apply(new Map(), yield* Clock.currentTimeMillis);
      yield* publish(empty(forcedOff ? "environment" : "disabled"));
    });
    const boot = Effect.gen(function* () {
      if (forcedOff) return yield* stop;
      yield* git.sweepScratch();
      const probe = yield* git.probeGit(),
        config = Option.getOrElse(
          yield* data.read,
          () => ({ teammates: false }) as typeof ForecastData.Type,
        );
      if (checks !== undefined) yield* checks.setCommand(config.check ?? "");
      active = probe.state === "supported";
      yield* publish({
        ...empty(),
        state: active ? "on" : "unsupported",
        ...(active ? { reason: undefined } : { reason: probe.state as PeerForecast["reason"] }),
        git: probe.version,
        teammates: config.teammates,
        shareWip: config.shareWip ?? false,
        check: config.check ?? "",
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
          tips = new Map<string, string>(),
          wanted = new Map<string, Want>();
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
                const sharing =
                  share !== undefined &&
                  snapshot.shareWip === true &&
                  selected.subjects.some((v) => v.where === "here");
                if (!sharing && pairsOf(selected.subjects, { team: jj !== undefined }).length === 0)
                  continue;
                const checkout = state.checkoutPath(
                  s.persisted,
                  workspace.slug,
                  project.id,
                  repo.id,
                );
                const info = yield* git.discoverRepository(checkout).pipe(Effect.option);
                if (Option.isNone(info)) continue;
                const repository = info.value,
                  now = yield* Clock.currentTimeMillis;
                // A Jujutsu checkout is asked once a minute; Git projects cost no process.
                let isJj = false;
                if (jj !== undefined) {
                  const known = jjKinds.get(checkout);
                  if (known === undefined || known.until <= now)
                    jjKinds.set(checkout, {
                      jj: yield* jj.isJj(checkout),
                      until: now + 60_000,
                    });
                  isJj = jjKinds.get(checkout)!.jj;
                }
                let subjects = selected.subjects;
                if (!isJj && pairsOf(subjects).length === 0) continue;
                const remote = subjects.filter((v) => v.where === "origin");
                if (
                  snapshot.teammates &&
                  remote.length > 0 &&
                  now >= (fetchAt.get(repository.common) ?? 0)
                ) {
                  const fetch = yield* git.fetchBranches(
                    repository,
                    remote.map((v) => v.branch),
                  );
                  const shared = isJj ? yield* git.fetchShared(repository) : true;
                  fetchAt.set(
                    repository.common,
                    now +
                      (fetch.state === "done" && shared
                        ? isJj
                          ? SHARED_FETCH_GAP_MS
                          : FETCH_GAP_MS
                        : FETCH_BACKOFF_MS),
                  );
                  if (fetch.state === "done") fetchedAt.set(repository.common, now);
                  if (fetch.state === "failed" || !shared) fetchFailedAt = iso(now);
                }
                const ids = yield* git
                  .readTips(repository, [
                    ...subjects.map((v) => v.ref),
                    ...(isJj ? remote.map((v) => sharedRef(v.branch)) : []),
                  ])
                  .pipe(Effect.orElseSucceed(() => new Map<string, string>()));
                if (isJj) {
                  const copies = yield* jj!.workingCopies(checkout);
                  subjects = sidesOf({
                    subjects,
                    tips: ids,
                    copies,
                    now,
                    fetchedAt: fetchedAt.get(repository.common) ?? now,
                  });
                  const commits = subjects.flatMap((v) => ids.get(v.ref) ?? []),
                    times = yield* git.authorTimes(repository, commits),
                    changes = yield* jj!.changeIds(checkout, commits);
                  subjects = subjects.map((v) => {
                    const commit = ids.get(v.ref);
                    if (commit === undefined) return v;
                    const started = times.get(commit),
                      changeId = changes.get(commit);
                    return {
                      ...v,
                      ...(started === undefined ? {} : { started }),
                      ...(changeId === undefined ? {} : { changeId }),
                    };
                  });
                  if (sharing)
                    for (const v of subjects) {
                      const copy =
                        v.where === "here" ? workingCopyFor(v.branch, copies) : undefined;
                      if (copy !== undefined)
                        wanted.set(`${repository.common}:${v.branch}`, {
                          repository,
                          branch: v.branch,
                          commit: copy.commit,
                        });
                    }
                }
                for (const [ref, id] of ids) tips.set(`${repository.common}:${ref}`, id);
                notOnOrigin += subjects.filter(
                  (v) => v.where === "origin" && !ids.has(v.ref),
                ).length;
                for (const { a: left, b: right } of pairsOf(subjects, { team: isJj })) {
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
                    ...(isJj
                      ? {
                          checkout,
                          later: laterOf(
                            { subject: left, commit: a },
                            { subject: right, commit: b },
                          ),
                        }
                      : {}),
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
                const result = yield* git.mergeTree(
                  pair.git,
                  objects,
                  pair.a,
                  pair.b,
                  pair.checkout !== undefined,
                );
                recordResult(schedule, pair, result, at, (yield* Clock.currentTimeMillis) - at);
                merges++;
              }
            }),
          );
        });
        const finished = yield* compute.pipe(
          Effect.timeoutOption(ROUND_MS),
          Effect.map(Option.isSome),
          Effect.orElseSucceed(() => false),
        );
        // A round that did not reach every repository, or looked at one session only, must not
        // end a share it has not seen.
        if (share !== undefined)
          yield* share.apply(
            wanted,
            yield* Clock.currentTimeMillis,
            finished && force === undefined,
          );
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
        if (checks !== undefined)
          yield* checks.consider(
            next.flatMap((pair) =>
              pair.checkout !== undefined && pair.result?.state === "clean"
                ? [
                    {
                      key: pair.key,
                      cwd: pair.checkout,
                      repository: pair.git,
                      commits: [pair.a, pair.b] as const,
                    },
                  ]
                : [],
            ),
            now,
          );
        const inherited = jj === undefined ? new Map() : yield* inherit(next);
        yield* publish({
          ...snapshot,
          tracked,
          skipped,
          notOnOrigin,
          fetchFailedAt,
          checkedAt: iso(now),
          pairs: next.flatMap((pair): PeerForecastPair[] => {
            const conflict = pair.result?.state === "conflict" ? pair.result : undefined,
              check = checks?.resultOf(pair.key);
            // A clean pair is shown only with a check's result: without one it is no news.
            if (conflict === undefined && (pair.result?.state !== "clean" || check === undefined))
              return [];
            const inheritedFrom = inherited.get(pair);
            return [
              {
                workspace: pair.left.workspace,
                project: pair.left.project,
                repository: pair.left.repository,
                a: side(pair.left),
                b: side(pair.right),
                files: conflict?.files ?? [],
                more: conflict?.more ?? 0,
                checkedAt: iso(pair.checkedAt!),
                ...(pair.later === undefined ? {} : { later: pair.later }),
                ...(conflict?.lines === undefined ? {} : { lines: conflict.lines }),
                ...(inheritedFrom === undefined ? {} : { inheritedFrom }),
                ...(conflict === undefined && check !== undefined ? { check } : {}),
              },
            ];
          }),
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
      run: Effect.all([run, checks === undefined ? Effect.never : checks.work], {
        concurrency: "unbounded",
        discard: true,
      }),
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
          const check = input.check?.trim();
          if (
            input.teammates === undefined &&
            input.shareWip === undefined &&
            check === undefined
          ) {
            // "Check now" sends no field: it asks for a round at once, with the fetch gaps and
            // the checks' once-a-minute rule set aside, and returns the status as it is.
            fetchAt.clear();
            if (checks !== undefined) yield* checks.expedite;
            yield* round().pipe(Effect.ignore, Effect.forkDetach);
            return snapshot;
          }
          yield* data
            .update((previous) => {
              const kept = Option.getOrElse(
                previous,
                () => ({ teammates: false }) as typeof ForecastData.Type,
              );
              return {
                teammates: input.teammates ?? kept.teammates,
                ...((input.shareWip ?? kept.shareWip) === undefined
                  ? {}
                  : { shareWip: input.shareWip ?? kept.shareWip }),
                ...((check ?? kept.check) === undefined ? {} : { check: check ?? kept.check }),
              };
            })
            .pipe(state.lock.withPermits(1));
          if (check !== undefined && checks !== undefined) yield* checks.setCommand(check);
          if (input.shareWip === false && share !== undefined)
            yield* share.apply(new Map(), yield* Clock.currentTimeMillis);
          yield* lock.withPermits(1)(
            Effect.gen(function* () {
              if (input.teammates !== undefined) {
                records = records.filter(
                  (p) => p.left.where === "here" && p.right.where === "here",
                );
                yield* publish({
                  ...snapshot,
                  teammates: input.teammates,
                  notOnOrigin: input.teammates ? snapshot.notOnOrigin : 0,
                  pairs: snapshot.pairs.filter((p) => p.a.where === "here" && p.b.where === "here"),
                });
              }
              yield* publish({
                ...snapshot,
                ...(input.shareWip === undefined ? {} : { shareWip: input.shareWip }),
                ...(check === undefined ? {} : { check }),
              });
            }),
          );
          yield* kick;
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
  ...(subject.source === undefined ? {} : { source: subject.source }),
  ...(subject.readAt === undefined ? {} : { readAt: iso(subject.readAt) }),
  ...(subject.changeId === undefined ? {} : { changeId: subject.changeId }),
  ...(subject.agent === undefined ? {} : { agent: subject.agent }),
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
    const git = createGit(
      vcs,
      NodePath.join(state.hubHome, "coord", "forecast"),
      yield* HostProcess.Platform,
    );
    return yield* makeForecast(
      state,
      git,
      agents.log,
      (yield* HostProcess.Environment).PEER_FORECAST === "off",
      createJj(vcs, git),
    );
  }),
).pipe(Layer.provide(vcsLayer.pipe(Layer.provide(NodeServices.layer))));
