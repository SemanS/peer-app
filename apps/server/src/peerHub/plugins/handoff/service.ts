import {
  PeerHandoffTarget,
  PeerHubError,
  type PeerHandoffStatus,
  type PeerHandoffPlace,
  type PeerHandoffOutcome,
  type PeerHandoffSetTarget,
  type PeerHandoffPackage,
  type PeerWorkThread,
} from "@t3tools/contracts";
import * as Fiber from "effect/Fiber";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Option from "effect/Option";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import { gitHubRepository } from "../../workLifecycle.ts";
import { hubCalls } from "./hub.ts";
import * as Gh from "./client/ghWrite.ts";
import {
  applyRegion,
  removeRegion,
  blockOf,
  earlierCopyNotice,
  hasRegion,
  replyLines,
} from "./render.ts";
import { targetsOf, pullRequest } from "./targets.ts";
const Settings = Schema.Struct({
  target: PeerHandoffTarget,
  projectTargets: Schema.Record(Schema.String, PeerHandoffTarget),
});
const defaults: typeof Settings.Type = { target: "comment" as const, projectTargets: {} };
const key = (p: PeerHandoffPlace) => `${p.workspace}/${p.projectId}/${p.taskId}`;
const failure = (detail: string) => new PeerHubError({ detail, refused: true });
type MutableOutcome = {
  -readonly [K in keyof PeerHandoffOutcome]: K extends "targets"
    ? Array<PeerHandoffOutcome["targets"][number]>
    : K extends "notices"
      ? string[]
      : PeerHandoffOutcome[K];
};
const empty = (p: PeerHandoffPlace): MutableOutcome => ({
  workspace: p.workspace,
  project: p.projectId,
  task: p.taskId,
  number: null,
  contextVersion: null,
  changed: false,
  stored: false,
  targets: [],
  notices: [],
});
export class HandoffService extends Context.Service<
  HandoffService,
  {
    readonly snapshot: Effect.Effect<PeerHandoffStatus>;
    readonly refresh: (workspace?: string) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
    readonly cleanup: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly read: (
      p: PeerHandoffPlace,
    ) => Effect.Effect<ReadonlyArray<PeerHandoffPackage>, PeerHubError>;
    readonly handOff: (p: PeerHandoffPlace) => Effect.Effect<PeerHandoffOutcome, PeerHubError>;
    readonly afterReview: (
      session: PeerSessionView,
      remainingMs: number,
    ) => Effect.Effect<ReadonlyArray<string>>;
    readonly withdraw: (p: PeerHandoffPlace) => Effect.Effect<PeerHandoffOutcome, PeerHubError>;
    readonly setTarget: (
      input: PeerHandoffSetTarget,
    ) => Effect.Effect<PeerHandoffStatus, PeerHubError>;
  }
>()("t3/peerHub/plugins/handoff/service/HandoffService") {}
export const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState,
    work = yield* PeerWork.PeerWork,
    published = yield* PeerStatus.PeerStatus,
    plugins = yield* PeerPlugins.PeerPlugins,
    agents = yield* PeerAgents.PeerAgents,
    gh = yield* Gh.GhWrite,
    hub = hubCalls(yield* PeerHubClient.PeerHubClient);
  const settings = state.pluginData("handoff", Settings);
  // The author's own handoff comments on a pull request: what Withdraw deletes, and what a
  // description write checks for as an earlier copy.
  const ownComments = (url: string) =>
    gh
      .login()
      .pipe(
        Effect.flatMap((login) =>
          gh.comments(url).pipe(Effect.map((all) => all.filter((c) => c.login === login))),
        ),
      );
  const summaries = new Map<string, PeerHandoffStatus["summaries"][number]>(),
    deliveries = new Map<string, PeerHandoffOutcome>(),
    locks = new Map<string, Semaphore.Semaphore>();
  const serial = <A, E>(p: PeerHandoffPlace, e: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      let lock = locks.get(key(p));
      if (!lock) {
        lock = yield* Semaphore.make(1);
        locks.set(key(p), lock);
      }
      return yield* lock.withPermits(1)(e);
    });
  const readSettings = settings.read.pipe(Effect.map((v) => Option.getOrElse(v, () => defaults)));
  const snapshot = Effect.gen(function* () {
    return {
      ...(yield* readSettings),
      summaries: [...summaries.values()]
        .sort((a, b) => b.composedAt.localeCompare(a.composedAt))
        .slice(0, 50),
      deliveries: [...deliveries.values()].toReversed().slice(0, 50),
    };
  });
  const remember = (p: PeerHandoffPlace, o: PeerHandoffOutcome) =>
    Effect.gen(function* () {
      deliveries.delete(key(p));
      deliveries.set(key(p), o);
      while (deliveries.size > 50) deliveries.delete(deliveries.keys().next().value!);
      yield* published.publish;
    });
  const trimSummaries = () => {
    const keep = new Set(
      [...summaries.entries()]
        .sort(([, a], [, b]) => b.composedAt.localeCompare(a.composedAt))
        .slice(0, 50)
        .map(([k]) => k),
    );
    for (const k of summaries.keys()) if (!keep.has(k)) summaries.delete(k);
  };
  const refresh = (workspace?: string) =>
    Effect.gen(function* () {
      for (const ws of (yield* state.workspaces).filter(
        (w) => !workspace || w.slug === workspace,
      )) {
        const rows = yield* hub.list(ws.slug).pipe(Effect.result);
        if (rows._tag === "Failure") continue;
        for (const [k, s] of summaries) if (s.workspace === ws.slug) summaries.delete(k);
        for (const s of rows.success) {
          const tasks = yield* work.tasks(ws.slug, s.project);
          if (tasks.some((t) => t.id === s.task && t.status !== "done"))
            summaries.set(`${ws.slug}/${s.project}/${s.task}/${s.author}`, {
              ...s,
              workspace: ws.slug,
            });
        }
        trimSummaries();
        yield* published.publish;
      }
    });
  const owned = (p: PeerHandoffPlace) =>
    Effect.gen(function* () {
      const me = yield* state.email;
      if (!me) return yield* Effect.fail(failure("Sign in to Peer first."));
      const { project } = yield* state.project(p.workspace, p.projectId);
      return {
        me,
        threads: (yield* work.threads(p.workspace, p.projectId))
          .filter((t) => t.task === p.taskId && t.email === me)
          .map((thread) => {
            // Work reports name a repository by its project-local id; gh needs its URL.
            const repository = project.repositories.find((repo) => repo.id === thread.repository);
            return repository === undefined ? thread : { ...thread, repository: repository.url };
          }),
      };
    });
  const discover = (
    p: PeerHandoffPlace,
    threads: ReadonlyArray<PeerWorkThread>,
    session: PeerSessionView | undefined,
    allStates = false,
  ) =>
    Effect.gen(function* () {
      const fresh = [...threads];
      const author = yield* state.email;
      const places = new Map<string, { repository: string; branch: string }>();
      for (const t of threads)
        if (t.repository && t.branch && gitHubRepository(t.repository))
          places.set(`${t.repository}/${t.branch}`, { repository: t.repository, branch: t.branch });
      if (session?.branch && session.repositoryId) {
        const own = yield* state.project(p.workspace, p.projectId);
        const repo = own.project.repositories.find((r) => r.id === session.repositoryId);
        if (repo)
          places.set(`${repo.url}/${session.branch}`, {
            repository: repo.url,
            branch: session.branch,
          });
      }
      for (const b of [...places.values()].sort(
        (a, b) => Number(a.branch === session?.branch) - Number(b.branch === session?.branch),
      )) {
        const repo = gitHubRepository(b.repository);
        if (!repo) continue;
        const result = yield* gh
          .run([
            "pr",
            "list",
            "--repo",
            repo.nameWithOwner,
            "--head",
            b.branch,
            "--state",
            allStates ? "all" : "open",
            "--json",
            "url,state,headRefName",
          ])
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.fromJsonString(
                  Schema.Array(
                    Schema.Struct({
                      url: Schema.String,
                      state: Schema.String,
                      headRefName: Schema.String,
                    }),
                  ),
                ),
              ),
            ),
            Effect.mapError(() => new Gh.GhError("invalid GitHub response")),
            Effect.result,
          );
        if (result._tag === "Success")
          fresh.unshift(
            ...result.success
              .filter((pr) => pr.headRefName === b.branch)
              .map((pr) => ({
                id: "branch",
                seenAt: "1970-01-01T00:00:00Z",
                project: p.projectId,
                task: p.taskId,
                title: "",
                email: author ?? "",
                source: "peer" as const,
                environment: String(state.environmentId),
                status: "idle" as const,
                delivery: "open" as const,
                runtimePresent: false,
                repository: b.repository,
                branch: b.branch,
                pullRequests: [
                  {
                    url: pr.url,
                    state:
                      pr.state.toLowerCase() === "merged"
                        ? ("merged" as const)
                        : pr.state.toLowerCase() === "closed"
                          ? ("closed" as const)
                          : ("open" as const),
                    headBranch: pr.headRefName,
                  },
                ],
              })),
          );
      }
      return fresh;
    });
  const publish = (p: PeerHandoffPlace, session: PeerSessionView | undefined, budget = 10000) =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis;
      const { me, threads } = yield* owned(p);
      const o = empty(p);
      const composed = yield* hub
        .compose(
          p,
          session
            ? { environment: String(state.environmentId), session: session.id, run: session.run }
            : {},
        )
        .pipe(Effect.timeout(`${Math.min(4000, budget)} millis`), Effect.result);
      if (composed._tag === "Failure") {
        o.notices.push(
          "Hub unavailable or task/session no longer eligible. Run peer review again.",
        );
        yield* remember(p, o);
        return o;
      }
      const pack = composed.success.package;
      o.stored = true;
      o.number = pack.number;
      o.changed = composed.success.changed;
      o.contextVersion = pack.context?.version ?? null;
      const summary = {
        workspace: p.workspace,
        project: pack.project,
        task: pack.task,
        author: pack.author,
        number: pack.number,
        composedAt: pack.composedAt,
        contextVersion: o.contextVersion,
        pullRequests: pack.pullRequests.length,
        source: pack.source,
      };
      summaries.set(`${key(p)}/${pack.author}`, summary);
      yield* agents.log("handoff.compose", {
        task: p.taskId,
        number: pack.number,
        changed: o.changed,
        ms: (yield* Clock.currentTimeMillis) - start,
      });
      const prefs = yield* readSettings;
      const target = prefs.projectTargets[`${p.workspace}/${p.projectId}`] ?? prefs.target;
      if (target === "none") o.notices.push("Kept in Peer only.");
      else if (!(yield* plugins.isActive("github")))
        o.notices.push(
          "GitHub plugin is off. Connect GitHub CLI in Settings → Peer → Coordination & plugins.",
        );
      else {
        const selected = targetsOf(
          yield* discover(p, threads, session).pipe(
            Effect.timeout(
              `${Math.max(1, budget - ((yield* Clock.currentTimeMillis) - start))} millis`,
            ),
            Effect.orElseSucceed(() => threads),
          ),
          p.taskId,
          me,
        );
        if (selected.foreign) o.notices.push("Repository is not on github.com; kept in Peer only.");
        if (!selected.targets.length)
          o.notices.push("No open pull request yet. Run peer review again after opening one.");
        o.targets = selected.targets.map((t) => ({
          url: t.url,
          kind: "not-finished" as const,
          reason: "Not finished",
        }));
        const remaining = Math.max(1, budget - ((yield* Clock.currentTimeMillis) - start));
        const written = new Set<string>();
        const earlier: string[] = [];
        const write = (url: string, action: Effect.Effect<string, Gh.GhError>) =>
          Effect.suspend(() => {
            if (!written.has(url) && written.size >= 5)
              return Effect.fail(new Gh.GhError("Not finished"));
            written.add(url);
            return action;
          });
        yield* Effect.forEach(
          selected.targets,
          (t) =>
            Effect.gen(function* () {
              const location = pullRequest(t.url, t.repository)!;
              const visibility = yield* gh
                .visibility(location.repository)
                .pipe(Effect.orElseSucceed(() => "UNKNOWN"));
              const pointerOnly = !["PRIVATE", "INTERNAL"].includes(visibility.toUpperCase());
              const block = blockOf(pack, {
                names: (e) => state.nameOf(p.workspace, e),
                pointerOnly,
              });
              let kind: PeerHandoffOutcome["targets"][number]["kind"] = "written",
                reason = target === "description" ? "Description updated" : "Comment updated";
              let copy = false;
              if (target === "description") {
                const pr = yield* gh.read(t.url);
                if (pr.state.toUpperCase() !== "OPEN") {
                  kind = "skipped";
                  reason = "Pull request is not open";
                } else {
                  const next = applyRegion(pr.body, block);
                  if (next.kind === "current") {
                    kind = "current";
                    reason = "Already current";
                  } else if (next.kind === "damaged" || next.kind === "too-long") {
                    kind = "skipped";
                    reason = next.kind;
                  } else yield* write(t.url, gh.write(t.url, next.body));
                }
              } else {
                const login = yield* gh.login();
                const pr = yield* gh.read(t.url);
                if (pr.state.toUpperCase() !== "OPEN") {
                  kind = "skipped";
                  reason = "Pull request is not open";
                } else {
                  copy = hasRegion(pr.body);
                  const own = (yield* gh.comments(t.url)).filter((c) => c.login === login);
                  if (!own.length) {
                    yield* write(t.url, gh.addComment(t.url, block));
                    reason = "Comment added";
                  } else {
                    if (own[0]!.body.replaceAll("\r", "") === block) {
                      kind = "current";
                      reason = "Already current";
                    } else yield* write(t.url, gh.editComment(t.url, own[0]!.id, block));
                    for (const duplicate of own.slice(1))
                      yield* write(t.url, gh.deleteComment(t.url, duplicate.id));
                  }
                }
              }
              o.targets = o.targets.map((v) =>
                v.url === t.url
                  ? {
                      url: t.url,
                      kind,
                      reason:
                        reason +
                        (pointerOnly ? " (pointer only: public or unknown visibility)" : ""),
                    }
                  : v,
              );
              // An earlier copy in the other place: best effort, after the outcome is recorded, so
              // a check that is slow or fails never changes what was written.
              if (target === "description" && (kind === "written" || kind === "current"))
                copy = (yield* ownComments(t.url).pipe(Effect.orElseSucceed(() => []))).length > 0;
              if (copy) earlier.push(t.url);
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  o.targets = o.targets.map((v) =>
                    v.url === t.url
                      ? {
                          url: t.url,
                          kind: error.kind === "Not finished" ? "not-finished" : "failed",
                          reason: error.kind,
                        }
                      : v,
                  );
                }),
              ),
            ),
          { concurrency: 3 },
        ).pipe(Effect.timeout(`${remaining} millis`), Effect.ignore);
        if (earlier.length)
          o.notices.push(
            earlierCopyNotice(earlier, target === "description" ? "comment" : "description"),
          );
      }
      yield* remember(p, o);
      yield* agents.log("handoff.publish", {
        task: p.taskId,
        targets: o.targets.length,
        outcomes: o.targets.reduce<Record<string, number>>((a, t) => {
          a[t.kind] = (a[t.kind] ?? 0) + 1;
          return a;
        }, {}),
        ms: (yield* Clock.currentTimeMillis) - start,
        budgetLeft: Math.max(0, budget - ((yield* Clock.currentTimeMillis) - start)),
      });
      return o;
    });
  return HandoffService.of({
    snapshot,
    refresh,
    read: hub.read,
    reset: Effect.sync(() => {
      summaries.clear();
      deliveries.clear();
    }),
    cleanup: (workspaces) =>
      Effect.sync(() => {
        for (const [k, s] of summaries) if (!workspaces.includes(s.workspace)) summaries.delete(k);
        for (const [k, o] of deliveries)
          if (!workspaces.includes(o.workspace)) deliveries.delete(k);
      }),
    setTarget: (input) =>
      Effect.gen(function* () {
        if (input.target === "description" && (!input.workspace || !input.projectId))
          return yield* Effect.fail(
            failure("Choose a project to opt in to description publishing."),
          );
        if ((input.workspace === undefined) !== (input.projectId === undefined))
          return yield* Effect.fail(failure("Name both workspace and project."));
        if (input.workspace && input.projectId)
          yield* state.project(input.workspace, input.projectId);
        yield* state.lock.withPermits(1)(
          settings.update((current) => {
            const old = Option.getOrElse(current, () => defaults);
            return input.workspace && input.projectId
              ? {
                  ...old,
                  projectTargets: {
                    ...old.projectTargets,
                    [`${input.workspace}/${input.projectId}`]: input.target,
                  },
                }
              : {
                  ...old,
                  target: input.target,
                  ...(input.target === "none" ? { projectTargets: {} } : {}),
                };
          }),
        );
        yield* published.publish;
        return yield* snapshot;
      }),
    handOff: (p) =>
      serial(
        p,
        Effect.gen(function* () {
          const { threads } = yield* owned(p);
          const task = (yield* work.tasks(p.workspace, p.projectId)).find((t) => t.id === p.taskId);
          if (!task || task.status === "done" || !threads.length)
            return yield* Effect.fail(
              failure("Only an unfinished task with one of your threads can be handed off."),
            );
          if (task.status === "open") yield* work.updateTask({ ...p, status: "review" });
          return yield* publish(p, undefined);
        }),
      ),
    afterReview: (session, remainingMs) =>
      session.task && remainingMs > 0
        ? serial(
            { workspace: session.workspace, projectId: session.project, taskId: session.task },
            publish(
              { workspace: session.workspace, projectId: session.project, taskId: session.task },
              session,
              Math.min(10000, remainingMs),
            ),
          ).pipe(
            Effect.map(replyLines),
            Effect.timeout(`${remainingMs} millis`),
            Effect.orElseSucceed(() => ["Handoff package not finished. Run peer review again."]),
          )
        : Effect.succeed([]),
    withdraw: (p) =>
      serial(
        p,
        Effect.gen(function* () {
          const { me, threads } = yield* owned(p);
          const o = empty(p);
          const stored = yield* hub.read(p).pipe(Effect.result);
          if (
            stored._tag === "Success" &&
            !stored.success.some((s) => s.author === me) &&
            ![...summaries.values()].some(
              (s) =>
                s.workspace === p.workspace &&
                s.project === p.projectId &&
                s.task === p.taskId &&
                s.author === me,
            )
          )
            return yield* Effect.fail(failure("No handoff package of yours to withdraw."));
          // Erasure is independent of GitHub cleanup: a stalled gh never holds the Hub package.
          const removal = yield* hub.remove(p).pipe(Effect.result, Effect.forkChild);
          const selected = targetsOf(
            yield* discover(p, threads, undefined, true).pipe(
              Effect.timeout("5 seconds"),
              Effect.orElseSucceed(() => threads),
            ),
            p.taskId,
            me,
            true,
          );
          o.targets = selected.targets.map((t) => ({
            url: t.url,
            kind: "not-finished",
            reason:
              "Not finished; delete <!-- peer:handoff --> through <!-- /peer:handoff --> by hand",
          }));
          yield* Effect.forEach(
            selected.targets,
            (t) =>
              Effect.gen(function* () {
                const pr = yield* gh.read(t.url);
                const next = removeRegion(pr.body);
                // Both kinds of copy go whatever the target is now, and the comments do not wait
                // on a description whose markers were damaged.
                if (next.kind === "removed") yield* gh.write(t.url, next.body);
                const mine = yield* ownComments(t.url);
                for (const c of mine) yield* gh.deleteComment(t.url, c.id);
                if (next.kind === "damaged")
                  return yield* Effect.fail(new Gh.GhError("damaged markers"));
                const gone = [
                  ...(next.kind === "removed" ? ["description block"] : []),
                  ...(mine.length
                    ? [mine.length === 1 ? "comment" : `${mine.length} comments`]
                    : []),
                ];
                o.targets = o.targets.map((v) =>
                  v.url === t.url
                    ? {
                        url: t.url,
                        kind: gone.length ? "removed" : "skipped",
                        reason: gone.length
                          ? `${gone.join(" and ")} removed`
                          : "Nothing of yours is published here",
                      }
                    : v,
                );
              }).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    o.targets = o.targets.map((v) =>
                      v.url === t.url
                        ? {
                            url: t.url,
                            kind: "failed",
                            reason: `${error.kind}; delete <!-- peer:handoff --> through <!-- /peer:handoff --> by hand`,
                          }
                        : v,
                    );
                  }),
                ),
              ),
            { concurrency: 3 },
          ).pipe(Effect.timeout("10 seconds"), Effect.ignore);
          const removed = yield* Fiber.join(removal);
          if (removed._tag === "Failure")
            o.notices.push("Stored package could not be deleted. Run Withdraw again.");
          else {
            for (const [k, s] of summaries)
              if (
                s.workspace === p.workspace &&
                s.project === p.projectId &&
                s.task === p.taskId &&
                s.author === me
              )
                summaries.delete(k);
            o.notices.push("Own handoff package withdrawn; task status unchanged.");
          }
          yield* remember(p, o);
          yield* agents.log("handoff.withdraw", { task: p.taskId, targets: o.targets.length });
          return o;
        }),
      ),
  });
});
export const layer = Layer.effect(HandoffService, make).pipe(Layer.provide(Gh.layer));
