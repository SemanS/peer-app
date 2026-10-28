/**
 * Acceptance: a lead's acceptance of a task's delivered work and its withdrawal, each through the
 * Hub (`client/hub.ts`), and what this computer last read of every task's acceptance on the
 * person's projects. The status carries the current acceptances without their notes; a task's page
 * reads the whole of it, history included. An `acceptance.changed` ping names the workspace to read
 * again; the read is queued, so the event stream never waits on the Hub.
 *
 * @module peerHub/plugins/acceptance/Acceptance
 */
import type {
  PeerAcceptanceInput,
  PeerAcceptancePlace,
  PeerAcceptanceSummary,
  PeerHubError,
  PeerTaskAcceptance,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { hubCalls } from "./client/hub.ts";

/** How many current acceptances the status carries, newest first. */
const SHOWN = 200;

export class Acceptance extends Context.Service<
  Acceptance,
  {
    /** A task's acceptance and its history, read from the Hub. */
    readonly view: (place: PeerAcceptancePlace) => Effect.Effect<PeerTaskAcceptance, PeerHubError>;
    /** A lead accepts a task in review or done; the Hub finishes one in review as their move. */
    readonly accept: (
      input: PeerAcceptanceInput,
    ) => Effect.Effect<PeerTaskAcceptance, PeerHubError>;
    readonly withdraw: (
      input: PeerAcceptanceInput,
    ) => Effect.Effect<PeerTaskAcceptance, PeerHubError>;
    /** What this computer knows of a task's acceptance, without asking the Hub. */
    readonly known: (place: PeerAcceptancePlace) => PeerTaskAcceptance | undefined;
    /** Reads a workspace again soon; a burst reads it once. */
    readonly readSoon: (workspace: string) => Effect.Effect<void>;
    /** Reads every workspace again: after a resync, pings may have been missed. */
    readonly readAll: Effect.Effect<void>;
    /** Reads queued workspaces until interrupted. */
    readonly follow: Effect.Effect<void>;
    readonly status: Effect.Effect<{ readonly accepted: ReadonlyArray<PeerAcceptanceSummary> }>;
    /** Forgets one workspace's acceptances, or every one's. */
    readonly forget: (workspace?: string) => Effect.Effect<void>;
    /** Forgets the acceptances of every workspace but these. */
    readonly keep: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("t3/peerHub/plugins/acceptance/Acceptance") {}

const taskKey = (p: { readonly project: string; readonly task: string }) =>
  `${p.project}/${p.task}`;
const none = (p: PeerAcceptancePlace): PeerTaskAcceptance => ({
  workspace: p.workspace,
  project: p.project,
  task: p.task,
  current: null,
  beforeReopening: false,
  history: [],
});

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const hub = hubCalls(yield* PeerHubClient.PeerHubClient);
  /** Workspace → `project/task` → what the Hub last said of it. */
  const known = new Map<string, Map<string, PeerTaskAcceptance>>();
  const queued = yield* Queue.unbounded<string>();

  /** Reads a workspace's acceptances; false from a Hub that serves none. */
  const read = (workspace: string) =>
    Effect.gen(function* () {
      const rows = yield* hub.list(workspace);
      if (rows === null) return false;
      known.set(workspace, new Map(rows.map((row) => [taskKey(row), row])));
      yield* status.publish;
      return true;
    });
  const of = (p: PeerAcceptancePlace) => known.get(p.workspace)?.get(taskKey(p)) ?? none(p);
  /** The person must be on the project before the Hub hears of it. */
  const member = (p: PeerAcceptancePlace) => state.project(p.workspace, p.project);
  const readAll = Effect.gen(function* () {
    for (const { slug } of yield* state.workspaces) yield* read(slug).pipe(Effect.ignore);
  });
  /**
   * Sends a decision, then reads the workspace again for the history. The Hub has decided once the
   * write answers, so a failed read after it reports the decision anyway, from the write's answer,
   * and reads again later.
   */
  const write =
    (
      send: (
        input: PeerAcceptanceInput,
      ) => Effect.Effect<PeerTaskAcceptance["current"], PeerHubError>,
    ) =>
    (input: PeerAcceptanceInput) =>
      member(input).pipe(
        Effect.andThen(send(input)),
        Effect.flatMap((current) =>
          read(input.workspace).pipe(
            Effect.map(() => of(input)),
            Effect.catch(() =>
              Effect.gen(function* () {
                const told = { ...of(input), current, beforeReopening: false };
                const tasks = known.get(input.workspace) ?? new Map();
                tasks.set(taskKey(input), told);
                known.set(input.workspace, tasks);
                yield* status.publish;
                yield* Queue.offer(queued, input.workspace);
                return told;
              }),
            ),
          ),
        ),
      );

  return Acceptance.of({
    view: (p) =>
      member(p).pipe(
        Effect.andThen(read(p.workspace)),
        Effect.map(() => of(p)),
      ),
    accept: write(hub.accept),
    withdraw: write(hub.withdraw),
    known: (p) => known.get(p.workspace)?.get(taskKey(p)),
    readSoon: (workspace) => Queue.offer(queued, workspace).pipe(Effect.asVoid),
    readAll,
    follow: Effect.gen(function* () {
      yield* readAll;
      while (true) {
        const burst = new Set([yield* Queue.take(queued), ...(yield* Queue.clear(queued))]);
        for (const workspace of burst) yield* read(workspace).pipe(Effect.ignore);
      }
    }),
    status: Effect.sync(() => ({
      accepted: [...known.values()]
        .flatMap((tasks) => [...tasks.values()])
        .flatMap(({ workspace, project, task, current, beforeReopening }) =>
          current === null
            ? []
            : [
                {
                  workspace,
                  project,
                  task,
                  by: current.by,
                  at: current.at,
                  statusThen: current.statusThen,
                  beforeReopening: beforeReopening === true,
                },
              ],
        )
        .toSorted((a, b) => b.at.localeCompare(a.at))
        .slice(0, SHOWN),
    })),
    forget: (workspace) =>
      Effect.gen(function* () {
        if (workspace === undefined) known.clear();
        else known.delete(workspace);
        yield* Queue.clear(queued);
        yield* status.publish;
      }),
    keep: (workspaces) =>
      Effect.gen(function* () {
        let dropped = false;
        for (const workspace of known.keys())
          if (!workspaces.includes(workspace)) {
            known.delete(workspace);
            dropped = true;
          }
        if (dropped) yield* status.publish;
      }),
  });
});

export const layer = Layer.effect(Acceptance, make);
