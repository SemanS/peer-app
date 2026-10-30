/**
 * A task's runs as the phone lists them: the rows web's task page shows, read-only but for End
 * run. Pure, with the clock passed in.
 */
import { runRows } from "@t3tools/client-runtime/peer/runs";
import { harnessName, personName } from "@t3tools/client-runtime/peer/work";
import type { PeerProjectState, PeerRun, PeerRunRuntime } from "@t3tools/contracts";

/** Said on the person's own detached run, which the phone cannot start an agent for. */
export const CONTINUE_ELSEWHERE = "Continue it from Peer on your computer or peer core.";

const RUNTIME_LABEL: Readonly<Record<PeerRunRuntime, string>> = {
  terminal: "terminal",
  herdr: "herdr",
  peer: "Peer chat",
  mcp: "editor",
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const clock24 = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const clock = (at: string) => {
  const time = Date.parse(at);
  return Number.isFinite(time) ? clock24.format(new Date(time)) : "";
};

const duration = (ms: number) =>
  ms < MINUTE_MS
    ? "under a minute"
    : ms < HOUR_MS
      ? `${Math.floor(ms / MINUTE_MS)} min`
      : ms < DAY_MS
        ? `${Math.floor(ms / HOUR_MS)} h`
        : `${Math.floor(ms / DAY_MS)} d`;

export function mobileRunRows(
  runs: ReadonlyArray<PeerRun>,
  ctx: {
    readonly me: string | null | undefined;
    readonly now: number;
    readonly project: PeerProjectState | undefined;
  },
) {
  return runRows(runs, ctx).map((row) => {
    const lasted = row.durationMs === undefined ? undefined : duration(row.durationMs);
    const when =
      row.endedAt === undefined
        ? [`started ${clock(row.startedAt)}`, lasted && `${lasted} so far`]
        : [`${clock(row.startedAt)}–${clock(row.endedAt)}`, lasted];
    const person = row.mine
      ? "You"
      : ctx.project === undefined
        ? row.email
        : personName(ctx.project, row.email);
    const word = row.state.charAt(0).toUpperCase() + row.state.slice(1);
    return {
      id: row.id,
      title: `${harnessName(row.agent) ?? row.agent} · ${RUNTIME_LABEL[row.runtime]}`,
      detail: [
        person,
        `${row.sessionsCount} ${row.sessionsCount === 1 ? "session" : "sessions"}`,
        ...when.filter((part) => part !== undefined),
      ].join(" · "),
      state: row.outcome === undefined ? word : `${word} · ${row.outcome.replace("-", " ")}`,
      running: row.state === "running",
      // The phone opens no run's view; it says where a run continues and why it has no view.
      hint: row.canContinue
        ? CONTINUE_ELSEWHERE
        : row.open.kind === "none"
          ? row.open.hint
          : undefined,
      canEnd: row.canEnd,
      agent: harnessName(row.agent) ?? row.agent,
    };
  });
}
