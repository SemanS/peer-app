/**
 * The Runs section of a task page, on web and on the phone alike: one row per run of an agent on
 * the task, newest first, with what a person can do with it. The Hub still decides every action;
 * these only keep a button from being offered where it would be refused anyway.
 */
import {
  WS_METHODS,
  type PeerRun,
  type PeerRunCounts,
  type PeerRunRuntime,
  type PeerRunState,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Agent runs (`peerHub.runs`, `endRun`, `continueRun`), for the task page on web and the phone. */
export function createPeerRunsAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    // Always fresh: a run's state changes on another computer between two looks at the page.
    peerRunsList: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:runs",
      tag: WS_METHODS.peerHubRuns,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerRunsEnd: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:end-run",
      tag: WS_METHODS.peerHubEndRun,
    }),
    peerRunsContinue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:continue-run",
      tag: WS_METHODS.peerHubContinueRun,
    }),
  };
}

export const TERMINAL_RUN_HINT = "Started from a terminal; no view here";
export const EDITOR_RUN_HINT = "Started from an editor; no view here";
export const NO_RUNS_TEXT = "No run is on this task yet";

/** Where a row's Open goes: the app's own thread, a herdr agent's view, or nowhere with a reason. */
export type RunOpen =
  | { readonly kind: "peer"; readonly threadId: string }
  /** `herdr:<agent>:<session>`, the id herdr agents carry; the pane comes from the local agents. */
  | { readonly kind: "herdr"; readonly agentId: string }
  | { readonly kind: "none"; readonly hint: string };

export interface RunRow {
  readonly id: string;
  readonly agent: string;
  readonly runtime: PeerRunRuntime;
  readonly email: string;
  readonly mine: boolean;
  readonly state: PeerRunState;
  readonly outcome: PeerRun["outcome"];
  /** Every session the run had, the ones the Hub no longer lists included. */
  readonly sessionsCount: number;
  readonly startedAt: string;
  readonly endedAt: string | undefined;
  /** From its start to its end, or to now while it has not ended; undefined for an unreadable date. */
  readonly durationMs: number | undefined;
  readonly open: RunOpen;
  readonly canContinue: boolean;
  readonly canEnd: boolean;
  /**
   * Another computer of its person took the run over (a handover): the environment it continued
   * on, which the page compares with its own.
   */
  readonly continuedOn: string | undefined;
}

interface Viewer {
  /** The signed-in person's address; null before sign-in. */
  readonly me: string | null | undefined;
  readonly now: number;
  /** The person leads the project or administers the workspace, as the work view says. */
  readonly manages?: boolean;
}

const samePerson = (a: string, b: string | null | undefined) =>
  b !== null && b !== undefined && a.toLowerCase() === b.toLowerCase();

// MCP runs live in an editor Peer cannot start a session in, so they cannot be continued here.
const CONTINUABLE: ReadonlySet<PeerRunRuntime> = new Set(["terminal", "herdr", "peer"]);

/** Only its own person continues a run, and only once its sessions have all ended. */
export const canContinue = (run: PeerRun, me: string | null | undefined) =>
  samePerson(run.email, me) && run.state === "detached" && CONTINUABLE.has(run.runtime);

/** Offered to the run's person, and to a lead or admin; the Hub decides finally. */
export const canEnd = (run: PeerRun, me: string | null | undefined, manages = false) =>
  (samePerson(run.email, me) || manages) && run.state !== "ended";

/** The environment a handed-over run continued on: its last, when it is not the minting one. */
export const continuedOn = (run: Pick<PeerRun, "environments">) => {
  const carried = run.environments ?? [];
  return carried.length > 1 ? carried.at(-1)?.id : undefined;
};

const PEER_THREAD = "peer:";

export function runOpen(run: PeerRun): RunOpen {
  switch (run.runtime) {
    case "peer":
      return run.thread?.startsWith(PEER_THREAD) === true
        ? { kind: "peer", threadId: run.thread.slice(PEER_THREAD.length) }
        : { kind: "none", hint: "Its chat is not known yet" };
    case "herdr": {
      // The newest session is the one herdr runs now (or ran last); its key names the agent.
      const newest = run.sessions.at(-1);
      return newest === undefined
        ? { kind: "none", hint: "Its agent has not started yet" }
        : { kind: "herdr", agentId: `herdr:${newest.id}` };
    }
    case "terminal":
      return { kind: "none", hint: TERMINAL_RUN_HINT };
    case "mcp":
      return { kind: "none", hint: EDITOR_RUN_HINT };
  }
}

const durationOf = (run: PeerRun, now: number) => {
  const from = Date.parse(run.startedAt);
  const to = run.endedAt === undefined ? now : Date.parse(run.endedAt);
  return Number.isNaN(from) || Number.isNaN(to) ? undefined : Math.max(0, to - from);
};

// ISO 8601 timestamps of one Hub compare as strings; run ids are time-ordered, so they break ties.
const newestFirst = (a: PeerRun, b: PeerRun) =>
  a.startedAt === b.startedAt ? b.id.localeCompare(a.id) : b.startedAt.localeCompare(a.startedAt);

export function runRows(runs: ReadonlyArray<PeerRun>, viewer: Viewer): ReadonlyArray<RunRow> {
  return [...runs].sort(newestFirst).map((run) => ({
    id: run.id,
    agent: run.agent,
    runtime: run.runtime,
    email: run.email,
    mine: samePerson(run.email, viewer.me),
    state: run.state,
    outcome: run.outcome,
    sessionsCount: run.sessions.length + run.sessionsBefore,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: durationOf(run, viewer.now),
    open: runOpen(run),
    canContinue: canContinue(run, viewer.me),
    canEnd: canEnd(run, viewer.me, viewer.manages),
    continuedOn: continuedOn(run),
  }));
}

export function runCounts(runs: ReadonlyArray<Pick<PeerRun, "state">>): PeerRunCounts {
  const counts = { running: 0, detached: 0, ended: 0 };
  for (const run of runs) counts[run.state] += 1;
  return counts;
}
