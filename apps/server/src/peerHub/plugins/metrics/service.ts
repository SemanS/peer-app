import {
  PeerHubError,
  PeerMetricsStatus,
  type PeerMetricsConfigureInput,
  type PeerMetricsDays,
  PeerMetricsDaysInput,
  type PeerMetricsSummary,
  type PeerMetricsSummaryInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { PeerLifecycleEvent } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerLog from "../../core/log/PeerLog.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { createLocalStore, dayAt, dayOf } from "./client/localStore.ts";
import { createHubSync } from "./client/hubSync.ts";
import { createCollector } from "./rollup.ts";
import { createObservers } from "./observers.ts";
import { sum } from "./vocabulary.ts";
export class MetricsService extends Context.Service<
  MetricsService,
  {
    readonly status: Effect.Effect<PeerMetricsStatus>;
    readonly summary: (
      input: PeerMetricsSummaryInput,
    ) => Effect.Effect<PeerMetricsSummary, PeerHubError>;
    readonly days: (input: PeerMetricsDaysInput) => Effect.Effect<PeerMetricsDays, PeerHubError>;
    readonly configure: (
      input: PeerMetricsConfigureInput,
    ) => Effect.Effect<PeerMetricsStatus, PeerHubError>;
    readonly lifecycle: (event: PeerLifecycleEvent) => Effect.Effect<void>;
    readonly workspaceCleanup: (
      event: Exclude<PeerLifecycleEvent, { kind: "signed-in" }>,
    ) => Effect.Effect<void>;
    readonly turnOff: Effect.Effect<void>;
    readonly run: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peerHub/plugins/metrics/service/MetricsService") {}
const encodeStatus = Schema.encodeEffect(Schema.fromJsonString(PeerMetricsStatus));
const validDays = Schema.is(PeerMetricsDaysInput);
export const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState,
    work = yield* PeerWork.PeerWork,
    log = yield* PeerLog.PeerLog,
    client = yield* PeerHubClient.PeerHubClient,
    published = yield* PeerStatus.PeerStatus,
    clock = yield* Clock.Clock;
  const now = () => clock.currentTimeMillisUnsafe(),
    email = () => state.current().persisted.email;
  const failed = (where: "fold" | "flush" | "upload") =>
    log.record("metrics.failed", { where, count: 1 });
  const store = createLocalStore(`${state.hubHome}/.metrics`, now),
    collector = createCollector(store, now, failed),
    observe = createObservers(collector),
    sync = createHubSync(client, store, collector, now, String(state.environmentId), email, () =>
      failed("upload"),
    );
  let loading: Promise<void> | undefined, signature: string | undefined;
  const ready = Effect.tryPromise({
    try: () => (loading ??= store.load().then(() => collector.load())),
    catch: () => new PeerHubError({ detail: "Local metrics could not be read." }),
  });
  const save = Effect.promise(store.saveState).pipe(
    Effect.catchCause(() => Effect.sync(() => failed("flush"))),
  );
  const status = Effect.sync((): PeerMetricsStatus => ({
    debug: log.debugState(),
    scrubbed: true,
    workspaces: state.current().persisted.workspaces.map((w) => {
      const c = email() ? store.consent(email()!, w.slug) : null;
      return {
        workspace: w.slug,
        sharing: c?.sharing ?? false,
        team: sync.team(w.slug),
        eraseOwed: c?.eraseOwed ?? false,
        ...(c?.sharedSince ? { sharedSince: c.sharedSince } : {}),
        ...(c?.lastUpload !== undefined ? { lastUpload: c.lastUpload } : {}),
      };
    }),
  }));
  const publish = Effect.gen(function* () {
    const value = yield* status,
      next = yield* encodeStatus(value).pipe(Effect.orDie);
    if (next !== signature) {
      signature = next;
      yield* published.publish.pipe(Effect.ignoreCause);
    }
  });
  const stop = Effect.gen(function* () {
    yield* ready.pipe(Effect.ignore);
    const me = email();
    log.setDebugUntil(null);
    if (me) {
      const person = store.person(me);
      delete person.debugUntil;
      yield* Effect.forEach(
        Object.keys(person.workspaces).filter(
          (w) => person.workspaces[w]?.sharing || person.workspaces[w]?.eraseOwed,
        ),
        (w) => sync.erase(w, me),
        { concurrency: "unbounded", discard: true },
      );
      person.cursors = {};
      person.checked = [];
      person.conflicting = [];
      delete person.seededPr;
    }
    yield* save;
    yield* publish;
  });
  const scope = (workspace: string) =>
    state.current().persisted.workspaces.some((w) => w.slug === workspace)
      ? Effect.void
      : Effect.fail(
          new PeerHubError({
            detail: "This workspace is not available on this environment.",
            refused: true,
          }),
        );
  return MetricsService.of({
    status,
    summary: (input) =>
      Effect.gen(function* () {
        yield* ready;
        yield* scope(input.workspace);
        const dayEnding = dayOf(now()),
          from = dayAt(dayEnding, 1 - input.window),
          previousTo = dayAt(from, -1),
          previousFrom = dayAt(from, -input.window);
        let current = collector.sum(input.workspace, input.project, from, dayEnding),
          previous = collector.sum(input.workspace, input.project, previousFrom, previousTo),
          resultScope = input.scope;
        let team = yield* sync.status(input.workspace);
        if (input.scope === "team" && team.state === "on") {
          const result = yield* Effect.gen(function* () {
            return [
              yield* sync.rows(input.workspace, input.project, from, dayEnding, "total"),
              yield* sync.rows(input.workspace, input.project, previousFrom, previousTo, "total"),
            ] as const;
          }).pipe(Effect.result);
          if (result._tag === "Success") {
            current = {
              ...sum(result.success[0]),
              computers: result.success[0][0]?.computers ?? 0,
            };
            previous = {
              ...sum(result.success[1]),
              computers: result.success[1][0]?.computers ?? 0,
            };
          } else {
            resultScope = "environment";
            team = {
              state: "unknown",
              reason: "Team metrics could not be reached. Showing this environment's metrics.",
            };
          }
        } else if (input.scope === "team") resultScope = "environment";
        yield* save;
        yield* publish;
        return {
          ...input,
          scope: resultScope,
          current,
          previous,
          dayEnding,
          computedAt: DateTime.formatIso(DateTime.makeUnsafe(now())),
          team,
        };
      }),
    days: (input) =>
      Effect.gen(function* () {
        yield* ready;
        yield* scope(input.workspace);
        const valid = validDays(input);
        if (!valid)
          return yield* new PeerHubError({
            detail: "Choose a range of 1 to 366 UTC days.",
            refused: true,
          });
        let rows: PeerMetricsDays["rows"] = collector.range(
            input.workspace,
            input.project,
            input.from,
            input.to,
          ),
          resultScope = input.scope;
        let team = yield* sync.status(input.workspace);
        if (input.scope === "team" && team.state === "on") {
          const result = yield* sync
            .rows(input.workspace, input.project, input.from, input.to, "day")
            .pipe(Effect.result);
          if (result._tag === "Success") rows = [...result.success];
          else {
            resultScope = "environment";
            team = {
              state: "unknown",
              reason: "Team metrics could not be reached. Exporting this environment only.",
            };
          }
        } else if (input.scope === "team") resultScope = "environment";
        yield* save;
        yield* publish;
        return {
          ...input,
          scope: resultScope,
          rows,
          computedAt: DateTime.formatIso(DateTime.makeUnsafe(now())),
          team,
        };
      }),
    configure: (input) =>
      Effect.gen(function* () {
        yield* ready;
        if (input.team !== undefined || input.sharing !== undefined) {
          if (!input.workspace)
            return yield* new PeerHubError({ detail: "Choose a workspace.", refused: true });
          yield* scope(input.workspace);
          const me = email();
          if (!me) return yield* new PeerHubError({ detail: "Sign in first.", refused: true });
          if (input.team !== undefined) {
            const role = state
              .current()
              .persisted.workspaces.find((w) => w.slug === input.workspace)?.role;
            if (role !== "owner" && role !== "admin")
              return yield* new PeerHubError({
                detail: "Only a workspace owner or admin can change team metrics.",
                refused: true,
              });
            yield* sync.setTeam(input.workspace, input.team);
          }
          if (input.sharing !== undefined) {
            const c = store.consent(me, input.workspace);
            if (!input.sharing) yield* sync.erase(input.workspace, me);
            else {
              if (c.eraseOwed) yield* sync.erase(input.workspace, me, false);
              if (!c.sharing) c.sharedSince = dayOf(now());
              c.sharing = true;
            }
          }
        }
        if (input.debug) {
          const until = input.debug === "on" ? now() + 86400000 : null;
          log.setDebugUntil(until);
          const me = email();
          if (me) {
            if (until) store.person(me).debugUntil = until;
            else delete store.person(me).debugUntil;
          }
          if (input.debug === "delete") log.deleteDebug();
        }
        if (input.eraseLocal) {
          yield* Effect.tryPromise({
            try: store.eraseAll,
            catch: () => new PeerHubError({ detail: "Local metrics could not be erased." }),
          });
          collector.clear();
        }
        yield* save;
        yield* publish;
        return yield* status;
      }),
    lifecycle: (event) =>
      event.kind === "signing-out"
        ? stop
        : event.kind === "left-workspace"
          ? Effect.gen(function* () {
              yield* ready.pipe(Effect.ignore);
              const me = email();
              if (me) delete store.person(me).workspaces[event.workspace];
              yield* save;
              yield* publish;
            })
          : event.kind === "signed-in"
            ? ready.pipe(
                Effect.ignore,
                Effect.andThen(sync.cycle),
                Effect.andThen(save),
                Effect.andThen(publish),
              )
            : Effect.void,
    workspaceCleanup: (event) =>
      event.kind === "left-workspace" || event.kind === "synced"
        ? Effect.gen(function* () {
            yield* ready.pipe(Effect.ignore);
            const me = email();
            if (!me) return;
            const workspaces = store.person(me).workspaces;
            for (const workspace of Object.keys(workspaces))
              if (
                event.kind === "left-workspace"
                  ? workspace === event.workspace
                  : !event.workspaces.some((w) => w.slug === workspace)
              )
                delete workspaces[workspace];
            yield* save;
          })
        : Effect.void,
    turnOff: stop,
    run: Effect.gen(function* () {
      yield* ready.pipe(Effect.orDie);
      const me = email(),
        until = me ? store.person(me).debugUntil : undefined;
      log.setDebugUntil(until && until > now() ? until : null, { keep: true });
      yield* Effect.addFinalizer(() => Effect.promise(collector.flush));
      const unsubscribe = log.subscribe(collector.record);
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      let prunedDay = dayOf(now());
      yield* Effect.all(
        [
          Effect.gen(function* () {
            const person = email();
            if (person) yield* observe(yield* work.latestPass, store.person(person));
            yield* sync.cycle;
            yield* save;
            yield* publish;
            yield* Effect.sleep("30 seconds");
          }).pipe(Effect.forever),
          Effect.gen(function* () {
            yield* Effect.promise(collector.flush);
            const day = dayOf(now());
            if (day !== prunedDay) {
              yield* Effect.promise(store.prune);
              prunedDay = day;
            }
            yield* Effect.sleep("60 seconds");
          }).pipe(Effect.forever),
        ],
        { concurrency: "unbounded", discard: true },
      );
    }),
  });
});
export const layer = Layer.effect(MetricsService, make);
