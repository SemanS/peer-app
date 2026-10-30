/**
 * Reports this computer's usage to the workspaces whose sharing is on: at most one rollup per
 * project and UTC day, sent when its content changed. Which sessions may go is `attribution.ts`'s
 * rule and what goes is `rows.ts`'s; here is only when, and what the Hub's answers mean.
 *
 * What was sent is kept in memory: a restart sends the same rows again, which the Hub takes as a
 * newer `rev` of the same report.
 *
 * @module peerHub/plugins/usage/reporter
 */
import { type PeerHubError, PeerUsageReportRow, UsageDay } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { ReadSessionTotals, UsageSessionTotal } from "../../../usage/usageSessionTotals.ts";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { toldDigest } from "../../core/plugin.ts";
import type * as PeerState from "../../core/state/PeerState.ts";
import { realpathOrSelf } from "../../core/state/PeerState.ts";
import { attribute, needsRemote, runPlaces } from "./attribution.ts";
import type { PeerUsageService } from "./service.ts";
import { reportRows, type UsageRowInput } from "./rows.ts";

const FIRST_PASS = "1 minute";
const PASS_INTERVAL = "30 minutes";
const DAY_MS = 24 * 60 * 60 * 1000;
/** The Hub takes 35 days back; counting today, this stays inside that across midnight. */
const WINDOW_DAYS = 35;
const REMOTE_CONCURRENCY = 4;

const encodeRows = Schema.encodeSync(Schema.fromJsonString(Schema.Array(PeerUsageReportRow)));
const dayOf = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms)).slice(0, 10);

export interface ReporterInput {
  readonly state: Pick<PeerState.PeerState["Service"], "current" | "hubHome" | "environmentId">;
  readonly features: PeerHubClient.PeerHubClient["Service"]["features"];
  readonly usage: Pick<PeerUsageService["Service"], "sharing" | "report" | "sharingTurnedOn">;
  readonly read: ReadSessionTotals;
  readonly remoteOf: (cwd: string) => Promise<string | null>;
  readonly now: () => number;
}

/** One rollup's place: a project id may hold any character a URL escapes, a day cannot. */
const rollupKey = (project: string, day: string) => `${day}/${project}`;
const rollupPlace = (key: string) => ({ day: key.slice(0, 10), project: key.slice(11) });

export function createReporter({ state, features, usage, read, remoteOf, now }: ReporterInput) {
  const environment = String(state.environmentId);
  /** Workspace → rollup → digest of the rows the Hub took. */
  const sent = new Map<string, Map<string, string>>();
  /** Workspace → when sharing went on, as the Hub says: any change means its rows are gone. */
  const sharedAt = new Map<string, string | null>();
  /** `origin` per directory. Cleared daily, so a repository that moved projects is seen again. */
  const remotes = new Map<string, string | null>();
  let remotesDay = "";
  let person: string | null = null;
  let lastRev = 0;

  const forget = (workspace: string) => {
    sent.delete(workspace);
    sharedAt.delete(workspace);
  };

  const failed = (where: string, workspace: string, error: PeerHubError) =>
    Effect.logWarning("Peer usage: a report did not reach the Hub", {
      where,
      workspace,
      status: error.status,
    });

  /** The workspaces to report to now, or null when this Hub has no usage feature after all. */
  const sharingWorkspaces = (slugs: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const sharing: Array<string> = [];
      for (const workspace of slugs) {
        const answer = yield* usage.sharing({ workspace }).pipe(Effect.result);
        if (Result.isFailure(answer)) {
          yield* failed("sharing", workspace, answer.failure);
          continue;
        }
        const choice = answer.success;
        if ("unsupported" in choice) return null;
        if (!choice.sharing) {
          forget(workspace);
          continue;
        }
        if (sharedAt.get(workspace) !== choice.at) sent.delete(workspace);
        sharedAt.set(workspace, choice.at);
        sharing.push(workspace);
      }
      return sharing;
    });

  const readRemotes = (cwds: ReadonlySet<string>, today: string) =>
    Effect.gen(function* () {
      if (remotesDay !== today) {
        remotes.clear();
        remotesDay = today;
      }
      yield* Effect.forEach(
        [...cwds].filter((cwd) => !remotes.has(cwd)),
        (cwd) =>
          Effect.promise(() => remoteOf(cwd)).pipe(
            Effect.map((remote) => void remotes.set(cwd, remote)),
          ),
        { concurrency: REMOTE_CONCURRENCY, discard: true },
      );
    });

  /** Each sharing workspace's sessions, by rollup. Any session not returned stays here. */
  const placeSessions = (
    sessions: ReadonlyArray<UsageSessionTotal>,
    sharing: ReadonlySet<string>,
    email: string,
    today: string,
  ) =>
    Effect.gen(function* () {
      const { persisted } = state.current();
      const context = {
        runs: runPlaces(Object.values(persisted.runs ?? {}), email),
        hubHomes: [...new Set([state.hubHome, realpathOrSelf(state.hubHome)])],
        manifests: persisted.workspaces.map((workspace) => workspace.manifest),
        remoteOf: (cwd: string) => remotes.get(cwd) ?? null,
      };
      yield* readRemotes(
        new Set(
          sessions.flatMap((session) =>
            session.cwd !== undefined && needsRemote(session, context) ? [session.cwd] : [],
          ),
        ),
        today,
      );
      const rollups = new Map<string, Map<string, Array<UsageRowInput>>>();
      for (const session of sessions) {
        const place = attribute(session, context);
        if (place === null || !sharing.has(place.workspace)) continue;
        const workspace = rollups.get(place.workspace) ?? new Map();
        const key = rollupKey(place.project, session.day);
        workspace.set(key, [
          ...(workspace.get(key) ?? []),
          { ...session, capacity: place.capacity },
        ]);
        rollups.set(place.workspace, workspace);
      }
      return rollups;
    });

  /** Sends what changed; false when the Hub turned out to have no usage feature. */
  const sendWorkspace = (
    workspace: string,
    rollups: ReadonlyMap<string, ReadonlyArray<UsageRowInput>>,
    firstDay: string,
  ) =>
    Effect.gen(function* () {
      const known = sent.get(workspace) ?? new Map<string, string>();
      sent.set(workspace, known);
      for (const key of known.keys()) if (rollupPlace(key).day < firstDay) known.delete(key);
      const skipped = new Set<string>();
      // A rollup kept in `known` with no sessions now went away here: empty rows take it back.
      for (const key of [...new Set([...rollups.keys(), ...known.keys()])].toSorted()) {
        const { project, day } = rollupPlace(key);
        if (skipped.has(project)) continue;
        const rows = reportRows(rollups.get(key) ?? [], environment);
        const digest = toldDigest(encodeRows(rows));
        if (known.get(key) === digest) continue;
        lastRev = Math.max(now(), lastRev + 1);
        const outcome = yield* usage
          .report({ workspace, project, day, environment, rev: lastRev, rows })
          .pipe(Effect.result);
        if (Result.isFailure(outcome)) {
          yield* failed("report", workspace, outcome.failure);
          // Off the project is about that project; anything else will be true of the next call.
          if (outcome.failure.status !== 404) return true;
          skipped.add(project);
          continue;
        }
        switch (outcome.success) {
          case "stored":
            if (rows.length === 0) known.delete(key);
            else known.set(key, digest);
            break;
          case "stale":
            // Not remembered, so the next pass sends it with a higher `rev`.
            break;
          case "not-shared":
            forget(workspace);
            return true;
          case "unsupported":
            return false;
        }
      }
      return true;
    });

  const pass = Effect.gen(function* () {
    const { persisted } = state.current();
    if (persisted.email !== person) {
      sent.clear();
      sharedAt.clear();
      person = persisted.email;
    }
    const email = person;
    if (email === null || ((yield* features)["usage"] ?? 0) < 1) return;
    const sharing = yield* sharingWorkspaces(persisted.workspaces.map(({ slug }) => slug));
    // Asked only now: a person who shares nothing pays for no scan.
    if (sharing === null || sharing.length === 0) return;
    const today = now();
    const firstDay = dayOf(today - (WINDOW_DAYS - 1) * DAY_MS);
    const sessions = yield* read({
      sinceDay: UsageDay.make(firstDay),
      untilDay: UsageDay.make(dayOf(today)),
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Peer usage: the local usage could not be read", {
          reason: error.reason,
        }),
      ),
      Effect.option,
    );
    if (Option.isNone(sessions)) return;
    const rollups = yield* placeSessions(sessions.value, new Set(sharing), email, dayOf(today));
    for (const workspace of sharing) {
      const supported = yield* sendWorkspace(
        workspace,
        rollups.get(workspace) ?? new Map(),
        firstDay,
      );
      if (!supported) return;
    }
  });

  /**
   * One loop, so a pass never overlaps another. A wake that arrives during a pass waits in the
   * service's queue. The wake's own forgetting covers a turn-on here; another computer's shows as
   * a new `at` on the next pass.
   */
  const run = Effect.gen(function* () {
    let delay: "1 minute" | "30 minutes" = FIRST_PASS;
    while (true) {
      const woken = yield* Effect.raceFirst(
        usage.sharingTurnedOn.pipe(Effect.map(Option.some)),
        Effect.sleep(delay).pipe(Effect.as(Option.none<string>())),
      );
      if (Option.isSome(woken)) forget(woken.value);
      yield* pass.pipe(Effect.ignoreCause({ log: true }));
      delay = PASS_INTERVAL;
    }
  });

  return { pass, run };
}
