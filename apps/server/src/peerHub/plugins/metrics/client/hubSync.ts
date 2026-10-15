import { PeerHubError, PeerMetricsRow, type PeerMetricsTeam } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";
import type { LocalStore } from "./localStore.ts";
import { dayAt, dayOf } from "./localStore.ts";
import type { Collector } from "../rollup.ts";
export const HubMetricsStatus = Schema.Struct({
  enabled: Schema.Boolean,
  epoch: Schema.Number,
  retentionDays: Schema.Number,
  at: Schema.optional(Schema.String),
  by: Schema.optional(Schema.String),
});
const Rows = Schema.Struct({
  project: Schema.String,
  from: Schema.String,
  to: Schema.String,
  by: Schema.String,
  rows: Schema.Array(PeerMetricsRow),
});
const Ack = Schema.Struct({});
const unknown = (reason = "Peer Hub has not been reached yet."): PeerMetricsTeam => ({
  state: "unknown",
  reason,
});
const isHubError = Schema.is(PeerHubError);
export function createHubSync(
  client: Pick<PeerHubClient.PeerHubClient["Service"], "me" | "request">,
  store: LocalStore,
  collector: Collector,
  now: () => number,
  environment: string,
  emailOf: () => string | null,
  failed: () => void,
) {
  const locks = new Map<string, Semaphore.Semaphore>(),
    states = new Map<
      string,
      {
        team: PeerMetricsTeam;
        at: number;
        retryAt: number;
        delay: number;
        refused: number;
        timeoutAt?: number;
      }
    >();
  const key = (email: string, workspace: string) => `${email}/${workspace}`;
  const runtime = (email: string, workspace: string) => {
    const k = key(email, workspace);
    if (!states.has(k))
      states.set(k, { team: unknown(), at: -Infinity, retryAt: 0, delay: 60000, refused: 0 });
    return states.get(k)!;
  };
  const serial = <A, E>(workspace: string, effect: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      let lock = locks.get(workspace);
      if (!lock) {
        lock = yield* Semaphore.make(1);
        locks.set(workspace, lock);
      }
      return yield* lock.withPermits(1)(effect);
    });
  const fail = (email: string, workspace: string, error: unknown) => {
    const s = runtime(email, workspace),
      code = isHubError(error) ? error.code : undefined;
    s.refused = code === "invalid_request" || code === "metrics_disabled" ? s.refused + 1 : 0;
    if (code === "unsupported_version" || s.refused >= 3) s.retryAt = now() + 3600000;
    else {
      s.retryAt = now() + s.delay;
      s.delay = Math.min(3600000, s.delay * 2);
    }
    if (
      !code &&
      (/timeout/i.test(String(error)) ||
        (isHubError(error) && /timeout|timed out/i.test(error.detail)))
    )
      s.timeoutAt = now();
    failed();
  };
  const refresh = (workspace: string, force = false) =>
    Effect.gen(function* () {
      const email = emailOf();
      if (!email) return unknown("Sign in to read team metrics.");
      const s = runtime(email, workspace),
        consent = store.consent(email, workspace);
      if (!force && s.team.state !== "unknown" && now() - s.at < 600000) return s.team;
      const me = yield* client.me.pipe(Effect.result);
      s.at = now();
      if (Result.isFailure(me)) {
        s.team = unknown("Peer Hub could not be reached. Local metrics are still available.");
        fail(email, workspace, me.failure);
        return s.team;
      }
      if ((me.success.features?.metrics ?? 0) < 1) {
        s.team = { state: "unsupported", reason: "This Peer Hub does not support team metrics." };
        return s.team;
      }
      const response = yield* client
        .request(HubMetricsStatus, { workspace, path: "/metrics", timeoutMs: 20000 })
        .pipe(Effect.timeout("20 seconds"), Effect.result);
      if (Result.isFailure(response)) {
        s.team = unknown("Peer Hub could not be reached. Local metrics are still available.");
        fail(email, workspace, response.failure);
        return s.team;
      }
      const value = response.success;
      if (consent.epoch !== undefined && consent.epoch !== value.epoch) {
        consent.markers = {};
        consent.sharedSince = dayOf(now());
      }
      consent.epoch = value.epoch;
      s.team = {
        state: value.enabled ? "on" : "off",
        epoch: value.epoch,
        reason: value.enabled
          ? "Team metrics are enabled. Device sums need at least three computers."
          : "An owner or admin has not enabled team metrics.",
      };
      return s.team;
    });
  const erase = (workspace: string, email = emailOf(), stop = true) => {
    if (!email) return Effect.void;
    const c = store.consent(email, workspace),
      s = runtime(email, workspace);
    if (stop) c.sharing = false;
    c.markers = {};
    c.eraseOwed = true;
    if (s.timeoutAt !== undefined && now() - s.timeoutAt < 60000) c.repeatEraseAt = now() + 60000;
    return serial(
      workspace,
      Effect.gen(function* () {
        if (emailOf() !== email) return;
        if (s.team.state === "unsupported") {
          delete c.eraseOwed;
          delete c.repeatEraseAt;
          return;
        }
        const response = yield* client
          .request(Ack, {
            workspace,
            path: `/metrics?environment=${encodeURIComponent(environment)}`,
            method: "DELETE",
            timeoutMs: 5000,
            unsupported: { value: null },
          })
          .pipe(Effect.result);
        if (Result.isSuccess(response)) {
          if (c.repeatEraseAt === undefined || now() >= c.repeatEraseAt) {
            delete c.eraseOwed;
            delete c.repeatEraseAt;
          }
        } else failed();
      }),
    ).pipe(
      Effect.timeout("5 seconds"),
      Effect.catch(() => Effect.sync(failed)),
    );
  };
  const pass = (workspace: string) =>
    serial(
      workspace,
      Effect.gen(function* () {
        const email = emailOf();
        if (!email) return;
        const c = store.consent(email, workspace),
          s = runtime(email, workspace);
        if (c.eraseOwed || !c.sharing || now() < s.retryAt) return;
        const team = yield* refresh(workspace);
        if (team.state !== "on") return;
        let uploads = 0;
        for (const entry of collector.entries(workspace)) {
          if (uploads >= 5 || !c.sharing || emailOf() !== email || c.eraseOwed) break;
          if (
            entry.day < (c.sharedSince ?? dayOf(now())) ||
            entry.day < dayAt(dayOf(now()), -34) ||
            entry.day > dayOf(now())
          )
            continue;
          const markerKey = `${entry.project}/${entry.day}`,
            marker = c.markers[markerKey];
          if (
            marker &&
            (entry.day < dayOf(now()) || marker.rev >= entry.rev || now() - marker.at < 600000)
          )
            continue;
          const rev = Math.max(entry.rev, marker?.rev ?? 0);
          uploads++;
          const response = yield* client
            .request(Ack, {
              workspace,
              path: `/metrics/${encodeURIComponent(entry.project)}/days/${entry.day}`,
              method: "PUT",
              body: { v: 1, environment, epoch: c.epoch, rev, ...entry.row },
              timeoutMs: 20000,
            })
            .pipe(Effect.timeout("20 seconds"), Effect.result);
          if (Result.isSuccess(response)) {
            c.markers[markerKey] = { rev, at: now() };
            c.lastUpload = now();
            s.delay = 60000;
            s.refused = 0;
            s.retryAt = 0;
          } else if (isHubError(response.failure) && response.failure.code === "stale_rollup")
            c.markers[markerKey] = { rev, at: now() };
          else if (isHubError(response.failure) && response.failure.code === "stale_epoch") {
            c.markers = {};
            c.sharedSince = dayOf(now());
            s.at = -Infinity;
            yield* refresh(workspace, true);
            break;
          } else {
            fail(email, workspace, response.failure);
            break;
          }
        }
      }),
    );
  return {
    team(workspace: string) {
      const email = emailOf();
      return email ? runtime(email, workspace).team : unknown("Sign in to read team metrics.");
    },
    /** The Hub's word on team metrics, kept for ten minutes unless asked again (`force`). */
    status: (workspace: string, force = false) => serial(workspace, refresh(workspace, force)),
    erase,
    setTeam: (workspace: string, enabled: boolean) =>
      serial(
        workspace,
        Effect.gen(function* () {
          const team = yield* refresh(workspace);
          if (team.state === "unsupported") return yield* new PeerHubError({ detail: team.reason });
          yield* client.request(HubMetricsStatus, {
            workspace,
            path: "/metrics",
            method: "PUT",
            body: { enabled },
            timeoutMs: 20000,
          });
          return yield* refresh(workspace, true);
        }),
      ),
    rows: (workspace: string, project: string, from: string, to: string, by: "day" | "total") =>
      serial(
        workspace,
        client
          .request(Rows, {
            workspace,
            path: `/metrics/${encodeURIComponent(project)}?from=${from}&to=${to}&by=${by}`,
            timeoutMs: 20000,
          })
          .pipe(Effect.map((v) => v.rows)),
      ),
    cycle: Effect.gen(function* () {
      const email = emailOf();
      if (!email) return;
      for (const [workspace, c] of Object.entries(store.person(email).workspaces)) {
        if (c.eraseOwed && (c.repeatEraseAt === undefined || now() >= c.repeatEraseAt))
          yield* erase(workspace, email, false);
        if (c.sharing && !c.eraseOwed) yield* pass(workspace);
      }
    }),
  };
}
