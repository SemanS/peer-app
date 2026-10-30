import { EnvironmentId, type PeerLocalAgent, type PeerRun } from "@t3tools/contracts";
import { TERMINAL_RUN_HINT } from "@t3tools/client-runtime/peer/runs";
import { describe, expect, it } from "vite-plus/test";

import {
  chatsWithoutRun,
  CONTINUED_ELSEWHERE,
  CONTINUED_HERE,
  ELSEWHERE_RUN_HINT,
  runsChip,
  taskRunRows,
} from "./runs.logic";
import type { TaskChatRow } from "./taskChats.logic";

const HERE = EnvironmentId.make("env-here");
const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const ME = "slavo@acme.dev";

function run(overrides: Partial<PeerRun> & Pick<PeerRun, "id">): PeerRun {
  return {
    workspace: "acme",
    project: "orders",
    task: "ord-7",
    email: ME,
    environment: HERE,
    agent: "claude",
    runtime: "peer",
    thread: `peer:thread-${overrides.id}`,
    startedAt: "2026-10-30T10:00:00.000Z",
    state: "running",
    sessions: [{ id: `claude:${overrides.id}`, from: "2026-10-30T10:00:00.000Z" }],
    sessionsBefore: 0,
    ...overrides,
  };
}

const agent = (id: string): PeerLocalAgent => ({
  id,
  paneId: `pane-${id}`,
  title: id,
  status: "working",
});

const ctx = {
  me: ME,
  now: NOW,
  manages: false,
  environmentId: HERE,
  agents: [] as ReadonlyArray<PeerLocalAgent>,
  project: undefined,
  clock: (at: string) => at.slice(11, 16),
};

function chat(key: string): TaskChatRow {
  return {
    key,
    title: key,
    mine: true,
    person: "Slavo",
    agent: "Claude",
    email: ME,
    subtitle: "",
    state: { label: "Claude · idle", tone: "neutral" },
    open: undefined,
    concerns: undefined,
  };
}

describe("taskRunRows", () => {
  it("lists runs newest first with agent, runtime, person, state, sessions and time", () => {
    const rows = taskRunRows(
      [
        run({ id: "run_A", startedAt: "2026-10-30T09:00:00.000Z" }),
        run({
          id: "run_B",
          email: "ana@acme.dev",
          agent: "codex",
          runtime: "terminal",
          state: "ended",
          outcome: "handed-off",
          endedAt: "2026-10-30T11:30:00.000Z",
          sessionsBefore: 2,
        }),
      ],
      ctx,
    );
    expect(rows.map((row) => row.id)).toEqual(["run_B", "run_A"]);
    expect(rows[0]).toMatchObject({
      agent: "Codex",
      runtime: "terminal",
      person: "ana@acme.dev",
      state: "Ended · handed off",
      sessions: "3 sessions",
      when: "10:00–11:30 · 1 h",
      open: undefined,
      hint: TERMINAL_RUN_HINT,
      canEnd: false,
      canContinue: false,
    });
    expect(rows[1]).toMatchObject({
      agent: "Claude",
      person: "You",
      state: "Running",
      tone: "working",
      sessions: "1 session",
      when: "started 09:00 · 3 h so far",
      canEnd: true,
      canContinue: false,
    });
  });

  it("opens a Peer thread only on the computer that runs it", () => {
    const [here, elsewhere] = taskRunRows(
      [
        run({ id: "run_B" }),
        run({ id: "run_A", environment: "env-laptop", startedAt: "2026-10-30T09:00:00.000Z" }),
      ],
      ctx,
    );
    expect(here?.open).toEqual({ kind: "thread", environmentId: HERE, threadId: "thread-run_B" });
    expect(elsewhere).toMatchObject({ open: undefined, hint: ELSEWHERE_RUN_HINT });
  });

  it("opens a herdr run in its local agent's pane, and offers nothing once herdr lost it", () => {
    const herdr = run({
      id: "run_H",
      runtime: "herdr",
      thread: undefined,
      sessions: [{ id: "claude:s1", from: "2026-10-30T10:00:00.000Z" }],
    });
    const [listed] = taskRunRows([herdr], { ...ctx, agents: [agent("herdr:claude:s1")] });
    expect(listed?.open).toEqual({
      kind: "herdr",
      agentId: "herdr:claude:s1",
      paneId: "pane-herdr:claude:s1",
    });
    const [gone] = taskRunRows([herdr], ctx);
    expect(gone).toMatchObject({ open: undefined, hint: undefined });
  });

  it("offers Continue only on the person's own detached run", () => {
    const rows = taskRunRows(
      [
        run({ id: "run_C", state: "detached" }),
        run({ id: "run_B", state: "detached", email: "ana@acme.dev" }),
        run({ id: "run_A", state: "detached", runtime: "mcp", agent: "cursor" }),
      ],
      ctx,
    );
    expect(rows.map((row) => [row.id, row.canContinue, row.canEnd])).toEqual([
      ["run_C", true, true],
      ["run_B", false, false],
      ["run_A", false, true],
    ]);
  });

  it("offers End run on a colleague's run to a lead, and Continue elsewhere only where it can move", () => {
    const rows = taskRunRows(
      [
        run({ id: "run_C", state: "detached", email: "ana@acme.dev" }),
        run({ id: "run_B", state: "detached", environment: "env-laptop", runtime: "terminal" }),
        run({ id: "run_A", state: "detached", environment: "env-laptop" }),
      ],
      { ...ctx, manages: true },
    );
    expect(rows.map((row) => [row.id, row.canContinue, row.canEnd])).toEqual([
      ["run_C", false, true],
      ["run_B", true, true],
      ["run_A", false, true],
    ]);
  });

  it("says where a handed-over run continued, and stops calling it another computer's", () => {
    const environments = (last: string) => [
      { id: "env-laptop", from: "2026-10-30T10:00:00.000Z" },
      { id: last, from: "2026-10-30T11:00:00.000Z" },
    ];
    const [taken, moved] = taskRunRows(
      [
        run({ id: "run_B", environments: environments(HERE) }),
        run({
          id: "run_A",
          environment: "env-desk",
          environments: environments("env-desk"),
          startedAt: "2026-10-30T09:00:00.000Z",
        }),
      ],
      ctx,
    );
    expect(taken).toMatchObject({ handover: CONTINUED_HERE, hint: undefined });
    expect(taken?.open).toBeDefined();
    expect(moved).toMatchObject({ handover: CONTINUED_ELSEWHERE, hint: ELSEWHERE_RUN_HINT });
  });
});

describe("chatsWithoutRun", () => {
  it("keeps chats no run covers, local and a colleague's alike", () => {
    const runs = [
      run({ id: "run_P" }),
      run({
        id: "run_H",
        runtime: "herdr",
        thread: undefined,
        environment: "env-ana",
        sessions: [{ id: "codex:s9", from: "2026-10-30T10:00:00.000Z" }],
      }),
    ];
    const kept = chatsWithoutRun(
      [chat("thread-run_P"), chat("env-ana:herdr:codex:s9"), chat("thread-old")],
      runs,
    );
    expect(kept.map((row) => row.key)).toEqual(["thread-old"]);
  });
});

describe("runsChip", () => {
  it("counts runs only while one is running or detached", () => {
    expect(runsChip(undefined)).toBeUndefined();
    expect(runsChip({ running: 0, detached: 0, ended: 3 })).toBeUndefined();
    expect(runsChip({ running: 1, detached: 0, ended: 0 })).toBe("1 run");
    expect(runsChip({ running: 0, detached: 1, ended: 2 })).toBe("3 runs");
  });
});
