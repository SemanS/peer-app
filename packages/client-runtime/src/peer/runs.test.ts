import type { PeerRun } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  EDITOR_RUN_HINT,
  TERMINAL_RUN_HINT,
  canContinue,
  canEnd,
  runCounts,
  runOpen,
  runRows,
} from "./runs.ts";

const run = (over: Partial<PeerRun> & Pick<PeerRun, "id">): PeerRun => ({
  workspace: "acme",
  project: "app",
  task: "t1",
  email: "ana@acme.dev",
  environment: "env-ana",
  agent: "claude",
  runtime: "terminal",
  startedAt: "2026-10-30T09:00:00.000Z",
  state: "running",
  sessions: [{ id: "claude:s1", from: "2026-10-30T09:00:00.000Z" }],
  sessionsBefore: 0,
  ...over,
});

const now = Date.parse("2026-10-30T10:00:00.000Z");

describe("runRows", () => {
  it("lists the newest run first, ties broken by the time-ordered id", () => {
    const rows = runRows(
      [
        run({ id: "run_01A", startedAt: "2026-10-30T08:00:00.000Z" }),
        run({ id: "run_01C", startedAt: "2026-10-30T09:30:00.000Z" }),
        run({ id: "run_01B", startedAt: "2026-10-30T09:30:00.000Z" }),
      ],
      { me: "ana@acme.dev", now },
    );
    expect(rows.map((row) => row.id)).toEqual(["run_01C", "run_01B", "run_01A"]);
  });

  it("counts the sessions the Hub dropped from the list", () => {
    const [row] = runRows(
      [
        run({
          id: "run_1",
          sessions: [
            { id: "claude:s21", from: "2026-10-30T09:00:00.000Z", to: "2026-10-30T09:10:00.000Z" },
            { id: "claude:s22", from: "2026-10-30T09:10:00.000Z" },
          ],
          sessionsBefore: 20,
        }),
      ],
      { me: null, now },
    );
    expect(row?.sessionsCount).toBe(22);
    expect(row?.mine).toBe(false);
  });

  it("measures a live run to now and an ended one to its end", () => {
    const rows = runRows(
      [
        run({ id: "run_live" }),
        run({ id: "run_done", state: "ended", endedAt: "2026-10-30T09:15:00.000Z" }),
      ],
      { me: "ana@acme.dev", now },
    );
    expect(rows.find((row) => row.id === "run_live")?.durationMs).toBe(60 * 60 * 1000);
    expect(rows.find((row) => row.id === "run_done")?.durationMs).toBe(15 * 60 * 1000);
  });
});

describe("runOpen", () => {
  it("opens a peer run's chat and a herdr run's newest agent", () => {
    expect(runOpen(run({ id: "r", runtime: "peer", thread: "peer:th-9" }))).toEqual({
      kind: "peer",
      threadId: "th-9",
    });
    expect(
      runOpen(
        run({
          id: "r",
          runtime: "herdr",
          sessions: [
            { id: "claude:old", from: "2026-10-30T09:00:00.000Z", to: "2026-10-30T09:05:00.000Z" },
            { id: "claude:new", from: "2026-10-30T09:05:00.000Z" },
          ],
        }),
      ),
    ).toEqual({ kind: "herdr", agentId: "herdr:claude:new" });
  });

  it("says why a terminal or editor run has no view here", () => {
    expect(runOpen(run({ id: "r", runtime: "terminal" }))).toEqual({
      kind: "none",
      hint: TERMINAL_RUN_HINT,
    });
    expect(TERMINAL_RUN_HINT).toBe("Started from a terminal; no view here");
    expect(runOpen(run({ id: "r", runtime: "mcp" }))).toEqual({
      kind: "none",
      hint: EDITOR_RUN_HINT,
    });
  });

  it("offers nothing to open before a peer run's thread or a herdr run's session is known", () => {
    expect(runOpen(run({ id: "r", runtime: "peer" })).kind).toBe("none");
    expect(runOpen(run({ id: "r", runtime: "herdr", sessions: [] })).kind).toBe("none");
  });
});

describe("availability", () => {
  const me = "ana@acme.dev";

  it("continues only the person's own detached runs that Peer can start a session in", () => {
    expect(canContinue(run({ id: "r", state: "detached" }), me)).toBe(true);
    expect(canContinue(run({ id: "r", state: "detached" }), "ANA@acme.dev")).toBe(true);
    expect(canContinue(run({ id: "r", state: "detached", runtime: "herdr" }), me)).toBe(true);
    expect(canContinue(run({ id: "r", state: "detached", runtime: "peer" }), me)).toBe(true);
    expect(canContinue(run({ id: "r", state: "detached", runtime: "mcp" }), me)).toBe(false);
    expect(canContinue(run({ id: "r", state: "running" }), me)).toBe(false);
    expect(canContinue(run({ id: "r", state: "ended" }), me)).toBe(false);
    expect(canContinue(run({ id: "r", state: "detached" }), "ben@acme.dev")).toBe(false);
    expect(canContinue(run({ id: "r", state: "detached" }), null)).toBe(false);
  });

  it("offers End run to the run's person while it has not ended", () => {
    expect(canEnd(run({ id: "r", state: "running" }), me)).toBe(true);
    expect(canEnd(run({ id: "r", state: "detached", runtime: "mcp" }), me)).toBe(true);
    expect(canEnd(run({ id: "r", state: "ended" }), me)).toBe(false);
    expect(canEnd(run({ id: "r", state: "running" }), "ben@acme.dev")).toBe(false);
    expect(canEnd(run({ id: "r", state: "running" }), undefined)).toBe(false);
  });

  it("carries the same answers on the rows", () => {
    const [row] = runRows([run({ id: "r", state: "detached" })], { me, now });
    expect(row).toMatchObject({ mine: true, canContinue: true, canEnd: true });
  });
});

describe("runCounts", () => {
  it("counts runs by state", () => {
    expect(runCounts([])).toEqual({ running: 0, detached: 0, ended: 0 });
    expect(
      runCounts([
        run({ id: "a" }),
        run({ id: "b", state: "detached" }),
        run({ id: "c", state: "ended" }),
        run({ id: "d", state: "ended" }),
      ]),
    ).toEqual({ running: 1, detached: 1, ended: 2 });
  });
});
