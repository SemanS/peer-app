import {
  PeerHubError,
  type PeerImpactStatus,
  type PeerImpactView,
  type PeerImpactFootprint,
  type PeerImpactPlace,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import * as Data from "effect/Data";
import { PeerState, projectKey } from "../../core/state/PeerState.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { usage, type PeerSessionView } from "../../core/plugin.ts";
import { impactText } from "./text.ts";
import { createCodeGraph, healthKey, type Health } from "./client/codegraph.ts";
import { createDiff } from "./client/diff.ts";
import { runProcess } from "./client/process.ts";
import { indexCreated, createIndexer, type Created } from "./client/worktree.ts";
import { newFootprintState, type FootprintState } from "./footprint.ts";
import { parseProvides } from "./provides.ts";
import { createSchedule, createBudget, BudgetExceeded } from "./scheduler.ts";
import { impactHub } from "./client/hub.ts";
import { checkSession } from "./client/check.ts";
const empty = (): PeerImpactView => ({ records: [], provided: [] }),
  iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown)),
  json = (value: unknown) => (value === undefined ? "" : encodeJson(value));
class CheckError extends Data.TaggedError("ImpactCheckError")<{ readonly budget: boolean }> {}
export const forcedOff = process.env.PEER_IMPACT === "off";
export function makeImpact(
  state: PeerState["Service"],
  agents: PeerAgents["Service"],
  hub: ReturnType<typeof impactHub>,
  options: {
    graph?: ReturnType<typeof createCodeGraph>;
    diff?: ReturnType<typeof createDiff>;
    forcedOff?: boolean;
    index?: typeof indexCreated;
  } = {},
) {
  return Effect.gen(function* () {
    const blocked = options.forcedOff ?? false;
    const lock = yield* Semaphore.make(1),
      settings = state.pluginData("impact", Schema.Struct({ autoIndex: Schema.Boolean })),
      schedule = createSchedule(),
      indexer = createIndexer(options.index);
    let epoch = 0,
      active = false,
      autoIndex = false,
      revision = 0,
      hubSupport: PeerImpactStatus["hubSupport"] = "unknown",
      lastContact: string | undefined,
      unsupportedUntil = 0,
      budget: ReturnType<typeof createBudget> | undefined;
    const runner: typeof runProcess = (bin, args, root, opts) => {
        budget?.take(bin === "git" ? "git" : "codegraph");
        return runProcess(bin, args, root, opts);
      },
      graph = options.graph ?? createCodeGraph({ run: runner }),
      diff = options.diff ?? createDiff({ run: runner });
    const views = new Map<string, PeerImpactView>(),
      roots = new Map<string, Health>(),
      rootWorkspaces = new Map<string, string>(),
      footprints = new Map<string, PeerImpactFootprint>(),
      states = new Map<string, FootprintState>(),
      signatures = new Map<string, string>(),
      identities = new Map<string, string>(),
      retry = new Map<string, number>(),
      owners = new Map<string, string>(),
      pending = new Map<string, { value: PeerImpactFootprint[]; key: string; due: number }>(),
      accepted = new Map<string, string>(),
      reads = new Set<string>(),
      created: Created[] = [];
    const identity = (s: PeerSessionView) =>
        json([s.id, s.runtimeGeneration, s.root, s.workspace, s.project, s.repositoryId, s.task]),
      localMaps = [footprints, states, signatures, retry, identities, owners];
    const currentSessions = agents.sessions.pipe(
      Effect.map((all) =>
        all
          .filter((session) =>
            state
              .current()
              .persisted.workspaces.some(
                (w) =>
                  w.slug === session.workspace &&
                  w.manifest?.projects.some((p) => p.id === session.project),
              ),
          )
          .slice(0, 50),
      ),
    );
    const cleanup = (sessions: ReadonlyArray<PeerSessionView>) => {
      const ids = new Set(sessions.map((s) => s.id)),
        here = new Set(sessions.map((s) => s.root));
      schedule.forget(ids);
      for (const map of localMaps) for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
      for (const session of sessions) {
        const key = identity(session);
        if (identities.get(session.id) !== key) {
          for (const map of localMaps) map.delete(session.id);
          identities.set(session.id, key);
        }
      }
      for (const [root] of rootWorkspaces)
        if (!here.has(root)) {
          revision += Number(roots.delete(root));
          rootWorkspaces.delete(root);
        }
      graph.forget(here);
    };
    const status = Effect.sync((): PeerImpactStatus => {
      const counts = new Map<string, PeerImpactStatus["counts"][number]>();
      for (const [workspace, view] of views)
        for (const record of view.records)
          if (record.live && record.state === "open")
            for (const side of record.sides)
              if (side.task) {
                const key = `${workspace}/${record.project}/${side.task}`,
                  row = counts.get(key) ?? {
                    workspace,
                    project: record.project,
                    task: side.task,
                    count: 0,
                  };
                counts.set(key, { ...row, count: row.count + 1 });
              }
      return {
        enabled: active,
        forcedOff: blocked,
        autoIndex,
        hubSupport,
        ...(lastContact === undefined ? {} : { lastContact }),
        roots: [...roots.values()].map(({ pending: _pending, lastIndexed: _at, ...root }) => root),
        counts: [...counts.values()],
        revision,
      };
    });
    const remember = (workspace: string, value: PeerImpactView | null, now: number) => {
      if (value === null) {
        hubSupport = "unsupported";
        unsupportedUntil = now + 600_000;
        views.delete(workspace);
        revision++;
        return;
      }
      hubSupport = "supported";
      lastContact = iso(now);
      if (json(views.get(workspace)) !== json(value)) {
        views.set(workspace, value);
        revision++;
      }
    };
    const refresh = (workspace: string) =>
      Effect.gen(function* () {
        const fence = epoch,
          now = yield* Clock.currentTimeMillis;
        if (
          !active ||
          now < unsupportedUntil ||
          !state.current().persisted.workspaces.some((w) => w.slug === workspace)
        )
          return false;
        const answer = yield* hub.view(workspace).pipe(Effect.result);
        if (answer._tag === "Failure" || fence !== epoch) return false;
        remember(workspace, answer.success, now);
        return answer.success !== null;
      });
    const list = (place: PeerImpactPlace) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if (!active)
            return yield* new PeerHubError({
              detail: "Impact overlaps are off on this environment.",
              refused: true,
            });
          if (!(yield* state.workspaces).some((w) => w.slug === place.workspace))
            return yield* new PeerHubError({
              detail: "That workspace is not available here.",
              refused: true,
            });
          if (!(yield* refresh(place.workspace)))
            return yield* new PeerHubError({
              detail:
                hubSupport === "unsupported"
                  ? "This Peer Hub does not support impact overlaps."
                  : "Could not read impact overlaps from Peer Hub.",
            });
          const view = views.get(place.workspace) ?? empty();
          return {
            records: view.records.filter(
              (r) =>
                (!place.project || r.project === place.project) &&
                (!place.task || r.sides.some((s) => s.task === place.task)),
            ),
            provided: view.provided.filter(
              (p) =>
                (!place.project || p.project === place.project) &&
                (!place.task || p.side.task === place.task),
            ),
          };
        }),
      );
    const queueReports = (now: number, sessions: ReadonlyArray<PeerSessionView>) => {
      for (const workspace of new Set([
        ...owners.values(),
        ...pending.keys(),
        ...accepted.keys(),
      ])) {
        const value = sessions
            .filter((s) => s.workspace === workspace)
            .flatMap((s) => (footprints.has(s.id) ? [footprints.get(s.id)!] : []))
            .slice(0, 50),
          key = json(value);
        if (key === accepted.get(workspace)) {
          pending.delete(workspace);
          continue;
        }
        if (pending.get(workspace)?.key !== key)
          pending.set(workspace, { value, key, due: now + 5000 });
      }
    };
    const flush = (now: number) =>
      Effect.gen(function* () {
        if (now < unsupportedUntil) return;
        for (const [workspace, report] of pending) {
          if (report.due > now) continue;
          const fence = epoch;
          if (!active || !state.current().persisted.workspaces.some((w) => w.slug === workspace)) {
            pending.delete(workspace);
            continue;
          }
          const answer = yield* hub
            .report(workspace, state.environmentId, report.value)
            .pipe(Effect.result);
          if (fence !== epoch) return;
          yield* agents.log("impact.report", {
            sessions: report.value.length,
            changed: report.value.reduce((n, p) => n + p.changed.length, 0),
            uses: report.value.reduce((n, p) => n + p.uses.length, 0),
            success: answer._tag === "Success" && answer.success !== null,
          });
          if (answer._tag === "Failure") {
            report.due = now + 10_000;
            return;
          }
          remember(workspace, answer.success, now);
          if (answer.success === null) return;
          accepted.set(workspace, report.key);
          if (pending.get(workspace) === report) pending.delete(workspace);
          return;
        }
      });
    const forget = (workspace?: string) =>
      Effect.sync(() => {
        epoch++;
        if (!workspace) {
          hubSupport = "unknown";
          unsupportedUntil = 0;
          lastContact = undefined;
        }
        indexer.abort(workspace);
        for (const [root, ws] of rootWorkspaces)
          if (!workspace || ws === workspace) {
            roots.delete(root);
            rootWorkspaces.delete(root);
          }
        graph.forget(new Set(rootWorkspaces.keys()));
        for (const map of [views, accepted, pending])
          for (const ws of map.keys()) if (!workspace || ws === workspace) map.delete(ws);
        for (const ws of reads) if (!workspace || ws === workspace) reads.delete(ws);
        for (let i = created.length - 1; i >= 0; i--)
          if (!workspace || created[i]!.workspace === workspace) created.splice(i, 1);
        for (const [id, ws] of owners)
          if (!workspace || ws === workspace) {
            owners.delete(id);
            for (const map of localMaps) map.delete(id);
          }
        revision++;
      });
    const clear = Effect.gen(function* () {
      active = false;
      const workspaces = new Set([...owners.values(), ...accepted.keys(), ...pending.keys()]);
      yield* forget();
      schedule.clear();
      for (const workspace of workspaces)
        yield* hub.report(workspace, state.environmentId, []).pipe(Effect.ignore);
      yield* agents.log("impact.off", {});
    });
    const boot = Effect.gen(function* () {
      active = !blocked;
      autoIndex = Option.getOrElse(yield* settings.read, () => ({ autoIndex: false })).autoIndex;
      for (const w of state.current().persisted.workspaces) reads.add(w.slug);
      revision++;
    });
    const tick = lock.withPermits(1)(
      Effect.gen(function* () {
        if (!active) return;
        const tickEpoch = epoch,
          now = yield* Clock.currentTimeMillis;
        let s = state.current();
        if (s.persisted.coordination?.enabled === false) {
          yield* clear;
          return;
        }
        if (hubSupport === "unsupported" && now >= unsupportedUntil) {
          hubSupport = "unknown";
          for (const w of s.persisted.workspaces) reads.add(w.slug);
        }
        for (const workspace of reads) {
          reads.delete(workspace);
          yield* refresh(workspace);
          break;
        }
        if (tickEpoch !== epoch || !active) return;
        s = state.current();
        const sessions = yield* currentSessions,
          eligible = new Set<string>();
        cleanup(sessions);
        const liveViews = yield* agents.hubViews;
        for (const session of sessions) {
          owners.set(session.id, session.workspace);
          const others = (
            liveViews.find((v) => v.workspace === session.workspace)?.view.sessions ?? []
          )
            .filter(
              (v) =>
                v.id !== session.id &&
                v.project === session.project &&
                Date.parse(v.seenAt) > now - 180_000,
            )
            .map((v) => v.id)
            .sort();
          if (others.length && hubSupport === "supported" && now >= unsupportedUntil)
            eligible.add(session.id);
          const signature = json([
            session.root,
            session.project,
            session.task,
            session.files,
            session.sharedContext?.version ?? null,
            others,
          ]);
          if (signatures.get(session.id) !== signature) {
            signatures.set(session.id, signature);
            schedule.trigger(session.id, now);
          }
          if (now >= (retry.get(session.id) ?? Infinity)) {
            schedule.trigger(session.id, now);
            retry.set(session.id, now + 60_000);
          }
        }
        const id = schedule.next(now, (id) => eligible.has(id)),
          session = sessions.find((v) => v.id === id);
        if (session) {
          budget = createBudget();
          const check = Effect.tryPromise({
            try: async (signal) => {
              const repository = s.persisted.workspaces
                  .find((w) => w.slug === session.workspace)
                  ?.manifest?.projects.find((p) => p.id === session.project)
                  ?.repositories.find((r) => r.id === session.repositoryId),
                local = states.get(session.id) ?? newFootprintState();
              states.set(session.id, local);
              rootWorkspaces.set(session.root, session.workspace);
              return await checkSession(
                {
                  id: session.id,
                  project: session.project,
                  root: session.root,
                  files: session.files,
                  branch: repository?.branch ?? "",
                  provided: parseProvides(session.sharedContext?.text ?? ""),
                  state: local,
                  now,
                },
                graph,
                diff,
                signal,
              );
            },
            catch: (error) => new CheckError({ budget: error instanceof BudgetExceeded }),
          });
          const result = yield* check.pipe(Effect.timeoutOption(5000), Effect.result);
          budget = undefined;
          if (tickEpoch !== epoch || !active) return;
          const live = (yield* currentSessions).find((v) => v.id === session.id),
            deferred = result._tag === "Failure" || Option.isNone(result.success);
          if (
            live &&
            identity(live) === identity(session) &&
            result._tag === "Success" &&
            Option.isSome(result.success)
          ) {
            const { health, footprint } = result.success.value,
              before = roots.get(session.root);
            roots.set(session.root, { ...health, checkedAt: iso(now) });
            if (healthKey(before) !== healthKey(health)) revision++;
            if (health.state !== "ready") retry.set(session.id, now + 60000);
            footprints.set(session.id, footprint);
          }
          if (deferred) {
            schedule.carry(session.id, now);
            if (result._tag === "Failure" && !result.failure.budget)
              yield* agents.log("impact.codegraph.failed", {
                session: session.id,
                failures: graph.failures(session.root),
              });
          }
          yield* agents.log("impact.check", {
            session: session.id,
            state: roots.get(session.root)?.state,
            changed: footprints.get(session.id)?.changed.length ?? 0,
            uses: footprints.get(session.id)?.uses.length ?? 0,
            deferred,
          });
        }
        if (tickEpoch !== epoch || !active) return;
        const latest = yield* currentSessions;
        cleanup(latest);
        queueReports(now, latest);
        yield* flush(now);
        if (autoIndex && created.length) {
          const event = created.shift()!,
            parent = `${state.workspaceRoot}/.worktrees/${event.workspace}/${event.project}/${event.repository}`,
            valid = () => {
              const live = state.current(),
                assignment = live.persisted.assignments?.[event.thread];
              return (
                active &&
                live.persisted.coordination?.enabled !== false &&
                autoIndex &&
                assignment?.workspace === event.workspace &&
                assignment.project === event.project &&
                assignment.task === event.task &&
                !!live.persisted.workspaces
                  .find((w) => w.slug === event.workspace)
                  ?.manifest?.projects.find((p) => p.id === event.project)
                  ?.repositories.some((r) => r.id === event.repository) &&
                live.work
                  .get(projectKey(event.workspace, event.project))
                  ?.tasks.some((t) => t.id === event.task && t.status !== "done") === true
              );
            };
          yield* indexer.run(event, parent, valid);
        }
      }),
    );
    const act = (
      input: { workspace: string; project: string; id: string },
      action: "dismiss" | "reopen",
      session?: PeerSessionView,
    ) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if (!active)
            return yield* new PeerHubError({ detail: "Impact overlaps are off.", refused: true });
          const fence = epoch;
          yield* state.project(input.workspace, input.project);
          yield* hub.act(
            input.workspace,
            input.project,
            input.id,
            action,
            session ? { session: session.id, environment: state.environmentId } : undefined,
          );
          if (fence !== epoch || !(yield* refresh(input.workspace)))
            return yield* new PeerHubError({
              detail: "Impact action was sent, but the current view could not be confirmed.",
            });
          return views.get(input.workspace) ?? empty();
        }),
      );
    const invalid = (detail: string) =>
      Effect.fail(usage(detail, "use peer impact [dismiss|reopen <id>]."));
    const command = (session: PeerSessionView, args: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        if (
          args.length &&
          (args.length !== 2 ||
            !["dismiss", "reopen"].includes(args[0]!) ||
            !/^[a-f0-9]{6,12}$/.test(args[1]!))
        )
          return yield* invalid("Invalid impact command.");
        const view = yield* list({ workspace: session.workspace, project: session.project });
        if (!args.length)
          return impactText(
            {
              ...view,
              records: view.records.filter((r) => r.sides.some((s) => s.session === session.id)),
            },
            roots.get(session.root),
            lastContact,
          );
        const matches = view.records.filter(
          (r) => r.id.startsWith(args[1]!) && r.sides.some((s) => s.session === session.id),
        );
        if (matches.length !== 1)
          return yield* invalid("No unique impact overlap for this session.");
        yield* act(
          { workspace: session.workspace, project: session.project, id: matches[0]!.id },
          args[0] as "dismiss" | "reopen",
          session,
        );
        return `Impact ${matches[0]!.id.slice(0, 6)} ${args[0] === "dismiss" ? "dismissed" : "reopened"}.`;
      });
    return {
      status,
      boot,
      tick,
      clear,
      run: (publish: Effect.Effect<unknown>) =>
        Effect.gen(function* () {
          yield* boot;
          while (true) {
            if (!active && !blocked && state.current().persisted.coordination?.enabled !== false)
              yield* boot;
            const before = revision;
            yield* tick;
            if (before !== revision) yield* publish;
            yield* Effect.sleep(1000);
          }
        }),
      observe: (session: PeerSessionView) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (active) schedule.trigger(session.id, now);
        }),
      readSoon: (workspace: string) =>
        Effect.sync(() => {
          if (active) reads.add(workspace);
        }),
      view: (workspace: string) => views.get(workspace) ?? empty(),
      root: (root: string) => roots.get(root),
      lastContact: () => lastContact,
      list,
      act,
      command,
      configure: (input: { autoIndex: boolean }) =>
        Effect.gen(function* () {
          yield* settings.update(() => input).pipe(state.lock.withPermits(1));
          autoIndex = input.autoIndex;
          if (!autoIndex) {
            created.length = 0;
            indexer.abort();
          }
          revision++;
          return yield* status;
        }),
      created: (event: Created) =>
        Effect.sync(() => {
          if (active && autoIndex && created.length < 50) created.push(Object.freeze({ ...event }));
        }),
      forget,
    };
  });
}
export class Impact extends Context.Service<
  Impact,
  Effect.Success<ReturnType<typeof makeImpact>>
>()("t3/peerHub/plugins/impact/Impact") {}
export const layer = Layer.effect(
  Impact,
  Effect.gen(function* () {
    return yield* makeImpact(yield* PeerState, yield* PeerAgents, impactHub(yield* PeerHubClient), {
      forcedOff,
    });
  }),
);
