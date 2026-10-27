/**
 * Test reports: filing, reading and removing a person's report on a task, and giving an unverified
 * item an owner, each through the Hub (`hub.ts`); and what this computer last read of every task's
 * reports, without their text, for the status. A `tests.changed` ping names the task to read again;
 * the read is queued, so the event stream never waits on the Hub.
 *
 * @module peerHub/plugins/test-reports/TestReports
 */
import {
  PeerHubError,
  type PeerTestReport,
  type PeerTestReportSummary,
  type PeerTestsFileInput,
  type PeerTestsSetOwnerInput,
  type PeerTestsSetOwnerResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { hubCalls, type Filing, type Place } from "./hub.ts";
import { summaryOf } from "./render.ts";

/** How many summaries the status carries, newest first. */
const SHOWN = 100;

export class TestReports extends Context.Service<
  TestReports,
  {
    /** Files the caller's report; the stored report, and whether this changed it. */
    readonly file: (
      place: Place,
      filing: Omit<Filing, "environment">,
    ) => Effect.Effect<
      { readonly report: PeerTestReport; readonly changed: boolean },
      PeerHubError
    >;
    /** A person's filing from the task page, with no session. */
    readonly fileAsPerson: (
      input: PeerTestsFileInput,
    ) => Effect.Effect<
      { readonly report: PeerTestReport; readonly changed: boolean },
      PeerHubError
    >;
    readonly list: (place: Place) => Effect.Effect<ReadonlyArray<PeerTestReport>, PeerHubError>;
    readonly remove: (place: Place) => Effect.Effect<{ readonly removed: boolean }, PeerHubError>;
    readonly setOwner: (
      input: PeerTestsSetOwnerInput,
    ) => Effect.Effect<PeerTestsSetOwnerResult, PeerHubError>;
    /** Reads a task's reports soon; a burst reads it once. */
    readonly readSoon: (place: Place) => Effect.Effect<void>;
    /** Reads every task it knows a report of again: after a resync, pings may have been missed. */
    readonly rereadKnown: Effect.Effect<void>;
    /** Reads queued tasks until interrupted. */
    readonly follow: Effect.Effect<void>;
    readonly status: Effect.Effect<{ readonly summaries: ReadonlyArray<PeerTestReportSummary> }>;
    /** Forgets one workspace's summaries, or every one's. */
    readonly forget: (workspace?: string) => Effect.Effect<void>;
    /** Forgets the summaries of every workspace but these. */
    readonly keep: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("t3/peerHub/plugins/test-reports/TestReports") {}

const placeKey = (p: Place) => `${p.workspace}/${p.project}/${p.task}`;
/** Workspace slugs hold no `/`. */
const workspaceOf = (key: string) => key.slice(0, key.indexOf("/"));

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const hub = hubCalls(yield* PeerHubClient.PeerHubClient);
  /** Place key → author → summary. */
  const known = new Map<string, Map<string, PeerTestReportSummary>>();
  const queued = yield* Queue.unbounded<Place>();

  const put = (p: Place, reports: ReadonlyArray<PeerTestReport>) =>
    Effect.gen(function* () {
      if (reports.length === 0) known.delete(placeKey(p));
      else
        known.set(
          placeKey(p),
          new Map(reports.map((report) => [report.author, summaryOf(p.workspace, report)])),
        );
      yield* status.publish;
    });
  const putOne = (p: Place, report: PeerTestReport) =>
    Effect.gen(function* () {
      const row = known.get(placeKey(p)) ?? new Map<string, PeerTestReportSummary>();
      row.set(report.author, summaryOf(p.workspace, report));
      known.set(placeKey(p), row);
      yield* status.publish;
    });
  /** The person must be on the project before the Hub hears of it. */
  const member = (p: Place) => state.project(p.workspace, p.project);
  const list = (p: Place) =>
    member(p).pipe(
      Effect.andThen(hub.list(p)),
      Effect.tap((reports) => put(p, reports)),
    );
  const file = (p: Place, filing: Omit<Filing, "environment">) =>
    member(p).pipe(
      Effect.andThen(hub.file(p, { ...filing, environment: String(state.environmentId) })),
      Effect.tap((answer) => putOne(p, answer.report)),
    );
  const read = (p: Place) => list(p).pipe(Effect.ignore);
  const forget = (workspace?: string) =>
    Effect.gen(function* () {
      for (const key of known.keys())
        if (workspace === undefined || workspaceOf(key) === workspace) known.delete(key);
      yield* Queue.clear(queued);
      yield* status.publish;
    });

  return TestReports.of({
    file,
    fileAsPerson: (input) =>
      file(input, {
        result: input.result,
        summary: input.summary,
        items: input.items.map((item) => ({
          kind: item.kind,
          text: item.text,
          ...(item.owner === undefined ? {} : { owner: item.owner }),
        })),
      }),
    list,
    remove: (p) =>
      Effect.gen(function* () {
        yield* member(p);
        const removed = yield* hub.remove(p);
        const me = yield* state.email;
        const row = known.get(placeKey(p));
        if (me !== null && row?.delete(me) === true) {
          if (row.size === 0) known.delete(placeKey(p));
          yield* status.publish;
        }
        return { removed };
      }),
    setOwner: (input) =>
      Effect.gen(function* () {
        yield* member(input);
        const answer = yield* hub.setOwner(input, input.author, input.index, {
          number: input.number,
          owner: input.owner,
        });
        if ("stale" in answer) {
          if (answer.stale.report !== undefined) yield* putOne(input, answer.stale.report);
          return {
            kind: "stale" as const,
            number: answer.stale.number,
            ...(answer.stale.report === undefined ? {} : { report: answer.stale.report }),
          };
        }
        yield* putOne(input, answer.report);
        return { kind: "saved" as const, report: answer.report };
      }),
    readSoon: (p) => Queue.offer(queued, p).pipe(Effect.asVoid),
    rereadKnown: Effect.gen(function* () {
      for (const row of known.values()) {
        const any = [...row.values()][0];
        if (any !== undefined)
          yield* Queue.offer(queued, {
            workspace: any.workspace,
            project: any.project,
            task: any.task,
          });
      }
    }),
    follow: Effect.gen(function* () {
      while (true) {
        const first = yield* Queue.take(queued);
        const burst = new Map([[placeKey(first), first]]);
        for (const next of yield* Queue.clear(queued)) burst.set(placeKey(next), next);
        for (const p of burst.values()) yield* read(p);
      }
    }),
    status: Effect.sync(() => ({
      summaries: [...known.values()]
        .flatMap((row) => [...row.values()])
        .toSorted((a, b) => b.at.localeCompare(a.at))
        .slice(0, SHOWN),
    })),
    forget,
    keep: (workspaces) =>
      Effect.gen(function* () {
        let dropped = false;
        for (const key of known.keys())
          if (!workspaces.includes(workspaceOf(key))) {
            known.delete(key);
            dropped = true;
          }
        if (dropped) yield* status.publish;
      }),
  });
});

export const layer = Layer.effect(TestReports, make);
