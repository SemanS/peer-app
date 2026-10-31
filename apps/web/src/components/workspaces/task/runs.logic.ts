/**
 * The Runs section of a task's page and the run count on a task's row. A run is one attempt of one
 * agent on the task; its row says who runs which agent where, in what state, and what the person
 * can do with it here. Pure: the page passes the runs, the clock and what runs on this computer.
 */
import { harnessName, personName } from "@t3tools/client-runtime/peer/work";
import { runRows, type RunRow } from "@t3tools/client-runtime/peer/runs";
import {
  ThreadId,
  type EnvironmentId,
  type PeerLocalAgent,
  type PeerProjectState,
  type PeerRun,
  type PeerRunCounts,
  type PeerRunOutcome,
  type PeerRunRuntime,
  type PeerRunState,
} from "@t3tools/contracts";

import type { SignalTone } from "../signals";
import type { WorkOpen } from "../workTree.logic";
import type { TaskChatRow } from "./taskChats.logic";

/** Said where Open would be when the run's agent lives on another of the person's computers. */
export const ELSEWHERE_RUN_HINT = "Runs on another computer; open it there";
/** A run this computer took over from another of the person's computers (a handover). */
export const CONTINUED_HERE = "Continued here from another computer";
/** A run another computer of the person took over from wherever it ran before. */
export const CONTINUED_ELSEWHERE = "Continued on another computer";

const RUNTIME_LABEL: Readonly<Record<PeerRunRuntime, string>> = {
  terminal: "terminal",
  herdr: "herdr",
  peer: "Peer chat",
  mcp: "editor",
};

const OUTCOME_LABEL: Readonly<Record<PeerRunOutcome, string>> = {
  "handed-off": "handed off",
  done: "done",
  stopped: "stopped",
  "task-closed": "task closed",
};

const STATE_TONE: Readonly<Record<PeerRunState, SignalTone>> = {
  running: "working",
  detached: "neutral",
  ended: "neutral",
};

export interface TaskRunRow {
  readonly id: string;
  /** "Claude", "Codex", or the editor's own name for an MCP run. */
  readonly agent: string;
  readonly runtime: string;
  /** "You" for the person's own, else the member's name. */
  readonly person: string;
  readonly mine: boolean;
  /** "Running", "Detached", "Ended · handed off". */
  readonly state: string;
  readonly tone: SignalTone;
  readonly sessions: string;
  /** "started 14:02 · 3 h so far", "14:02–15:10 · 1 h". */
  readonly when: string;
  readonly open: WorkOpen | undefined;
  /** Why there is no Open, for a run whose agent has no view here. */
  readonly hint: string | undefined;
  /** Where a handed-over run continued: here, or on another computer. */
  readonly handover: string | undefined;
  readonly canContinue: boolean;
  readonly canEnd: boolean;
}

interface RunContext {
  readonly me: string | null | undefined;
  readonly now: number;
  /** The person leads the project or administers the workspace: they may end colleagues' runs. */
  readonly manages: boolean;
  /** This computer's environment, whose Peer threads and herdr agents open here. */
  readonly environmentId: EnvironmentId;
  readonly agents: ReadonlyArray<PeerLocalAgent>;
  readonly project: PeerProjectState | undefined;
  /** The person's own time format; the page passes it, tests a fixed one. */
  readonly clock: (at: string) => string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function durationLabel(ms: number): string {
  if (ms < MINUTE_MS) return "under a minute";
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return `${Math.floor(ms / DAY_MS)} d`;
}

function whenLabel(row: RunRow, clock: (at: string) => string): string {
  const lasted = row.durationMs === undefined ? undefined : durationLabel(row.durationMs);
  if (row.endedAt === undefined) {
    return [
      `started ${clock(row.startedAt)}`,
      lasted === undefined ? undefined : `${lasted} so far`,
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }
  return [`${clock(row.startedAt)}–${clock(row.endedAt)}`, lasted]
    .filter((part) => part !== undefined)
    .join(" · ");
}

function stateLabel(row: RunRow): string {
  const word = row.state.charAt(0).toUpperCase() + row.state.slice(1);
  return row.state === "ended" && row.outcome !== undefined
    ? `${word} · ${OUTCOME_LABEL[row.outcome]}`
    : word;
}

/**
 * Where a row's Open goes from this computer. A Peer thread opens only on the computer that runs
 * it, and a herdr run only while this computer's herdr lists its agent: herdr names agents by
 * session, so a run whose newest session is no longer a pane here has nothing to open.
 */
function openHere(run: PeerRun, row: RunRow, ctx: RunContext): Pick<TaskRunRow, "open" | "hint"> {
  const here = run.environment === ctx.environmentId;
  switch (row.open.kind) {
    case "none":
      return { open: undefined, hint: row.open.hint };
    case "peer":
      return here
        ? {
            open: {
              kind: "thread",
              environmentId: ctx.environmentId,
              threadId: ThreadId.make(row.open.threadId),
            },
            hint: undefined,
          }
        : { open: undefined, hint: row.mine ? ELSEWHERE_RUN_HINT : undefined };
    case "herdr": {
      const agentId = row.open.agentId;
      const agent = here ? ctx.agents.find((candidate) => candidate.id === agentId) : undefined;
      if (agent !== undefined) {
        return {
          open: { kind: "herdr", agentId: agent.id, paneId: agent.paneId },
          hint: undefined,
        };
      }
      return { open: undefined, hint: row.mine && !here ? ELSEWHERE_RUN_HINT : undefined };
    }
  }
}

/** A task's runs as its page lists them, newest first. */
export function taskRunRows(
  runs: ReadonlyArray<PeerRun>,
  ctx: RunContext,
): ReadonlyArray<TaskRunRow> {
  const byId = new Map(runs.map((run) => [run.id, run] as const));
  return runRows(runs, { me: ctx.me, now: ctx.now, manages: ctx.manages }).flatMap(
    (row): ReadonlyArray<TaskRunRow> => {
      const run = byId.get(row.id);
      if (run === undefined) return [];
      const here = run.environment === ctx.environmentId;
      return [
        {
          id: row.id,
          agent: harnessName(row.agent) ?? row.agent,
          runtime: RUNTIME_LABEL[row.runtime],
          person: row.mine
            ? "You"
            : ctx.project === undefined
              ? row.email
              : personName(ctx.project, row.email),
          mine: row.mine,
          state: stateLabel(row),
          tone: STATE_TONE[row.state],
          sessions: `${row.sessionsCount} ${row.sessionsCount === 1 ? "session" : "sessions"}`,
          when: whenLabel(row, ctx.clock),
          ...openHere(run, row, ctx),
          handover:
            row.continuedOn === undefined
              ? undefined
              : row.continuedOn === ctx.environmentId
                ? CONTINUED_HERE
                : CONTINUED_ELSEWHERE,
          // Another computer's run continues here once the Hub hands it over; a Peer chat cannot move.
          canContinue: row.canContinue && (here || row.runtime !== "peer"),
          canEnd: row.canEnd,
        },
      ];
    },
  );
}

/**
 * The thread keys the work tree gives a run's chats: a Peer thread by its id, a herdr agent by
 * `herdr:<session>`, each prefixed with its computer when it is a colleague's or another of yours.
 */
export function runThreadKeys(run: PeerRun): ReadonlyArray<string> {
  const ids = [
    ...(run.thread?.startsWith("peer:") === true ? [run.thread.slice("peer:".length)] : []),
    ...run.sessions.flatMap((session) => [session.id, `herdr:${session.id}`]),
  ];
  return ids.flatMap((id) => [id, `${run.environment}:${id}`]);
}

/**
 * The task's chats that no run covers yet (a thread from before runs, or one an older Peer
 * reports), so nothing that was on the page disappears from it.
 */
export function chatsWithoutRun(
  chats: ReadonlyArray<TaskChatRow>,
  runs: ReadonlyArray<PeerRun>,
): ReadonlyArray<TaskChatRow> {
  const covered = new Set(runs.flatMap(runThreadKeys));
  return chats.filter((chat) => !covered.has(chat.key));
}

/** The quiet chip on a task's row: its runs while any is running or detached, else nothing. */
export function runsChip(counts: PeerRunCounts | undefined): string | undefined {
  if (counts === undefined || counts.running + counts.detached === 0) return undefined;
  const total = counts.running + counts.detached + counts.ended;
  return `${total} ${total === 1 ? "run" : "runs"}`;
}

/**
 * What the work view says about a task's runs and chats, so the page reads its runs again when it
 * changes rather than on a timer.
 */
export function runsRevision(
  counts: PeerRunCounts | undefined,
  threads: ReadonlyArray<{ readonly key: string; readonly status: string }>,
): string {
  const runs = counts === undefined ? "-" : `${counts.running}/${counts.detached}/${counts.ended}`;
  return [runs, ...threads.map((thread) => `${thread.key}=${thread.status}`)].join("|");
}
