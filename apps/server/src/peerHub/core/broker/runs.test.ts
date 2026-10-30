// @effect-diagnostics nodeBuiltinImport:off - a session's working context file on disk.
import * as NodeFSP from "node:fs/promises";

import { describe, expect, it } from "@effect/vitest";

import { RunBook, stateOf } from "../work/runs.ts";
import type { PeerBrokerHost } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

/** Runs kept in memory for a broker test. */
const memoryRuns = () =>
  new RunBook(
    {},
    {
      environment: "test",
      email: () => "ana@acme.test",
      now: () => Date.parse("2026-10-30T10:00:00Z"),
      save: async () => undefined,
    },
  );

/** A broker whose host keeps `runs`, and puts a session on `task` when its branch names it. */
async function fixture(runs: RunBook, task?: string) {
  return brokerFixture((): Partial<PeerBrokerHost> => ({
    runs,
    taskOf: () => task,
    taskName: (_w, _p, id) => `KRK · ${id}`,
  }));
}

const start = (session: string, root: string) => ({
  session_id: session,
  cwd: root,
  hook_event_name: "SessionStart",
  source: "startup",
});

const prompt = (session: string, root: string) => ({
  session_id: session,
  cwd: root,
  hook_event_name: "UserPromptSubmit",
  prompt: "go on",
});

/** A hook as the socket answers it: the broker's answer with what its run tells the session once. */
const hookOf = (
  broker: Awaited<ReturnType<typeof fixture>>["broker"],
  body: Record<string, unknown>,
  headers: Record<string, string>,
) =>
  broker
    .hookInTime(body, { "x-peer-agent": "claude", ...headers })
    .then((out) => broker.withRunNotice(body, { "x-peer-agent": "claude", ...headers }, out));

const contextOf = (out: Record<string, unknown> | null) =>
  String(
    (out?.hookSpecificOutput as { readonly additionalContext?: unknown } | undefined)
      ?.additionalContext ?? "",
  );

describe("runs in the broker", () => {
  it("a_token_attaches_the_session", async () => {
    const runs = memoryRuns();
    const f = await fixture(runs);
    try {
      const { run, token } = await runs.create({
        workspace: "acme",
        project: "app",
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
      });
      await hookOf(f.broker, start("one", f.root), {
        "x-peer-run": run.id,
        "x-peer-run-token": token!,
      });
      const session = f.broker.sessions.get("claude:one")!;
      // No assignment and no branch names the task: the run alone puts the session on it.
      expect(session.run).toBe(run.id);
      expect(session.task).toBe("krk-1");
      expect(stateOf(runs.get(run.id)!)).toBe("running");
      expect(runs.get(run.id)!.sessions.map((s) => s.id)).toEqual(["claude:one"]);
      expect(f.broker.reportFor("acme")[0]).toMatchObject({ run: run.id, task: "krk-1" });
      expect(await f.broker.runCli("run", [], { "x-peer-session": "one" })).toContain(
        `Run ${run.id} on KRK · krk-1`,
      );
    } finally {
      await f.dispose();
    }
  });

  it("an_mcp_session_with_its_run_token_joins_the_run", async () => {
    const runs = memoryRuns();
    // The folder's branch would put it on another task: the run comes first (design D3, step 1).
    const f = await fixture(runs, "krk-9");
    try {
      const { run, token } = await runs.create({
        workspace: "acme",
        project: "app",
        task: "krk-1",
        agent: "cursor",
        runtime: "terminal",
      });
      const view = await f.broker.bindTools({
        server: "editor-7",
        cwd: f.root,
        client: "Cursor",
        run: run.id,
        runToken: token!,
      });
      const session = f.broker.sessions.get(view.id)!;
      expect([session.adapter, session.run, session.task]).toEqual(["mcp", run.id, "krk-1"]);
      expect(runs.get(run.id)!.sessions.map((s) => s.id)).toEqual(["cursor:editor-7"]);
      // A wrong token leaves the session to the folder, as a hook session's.
      const other = await f.broker.bindTools({
        server: "editor-8",
        cwd: f.root,
        client: "Cursor",
        run: run.id,
        runToken: "f".repeat(32),
      });
      const fallback = f.broker.sessions.get(other.id)!;
      expect(fallback.run).not.toBe(run.id);
      expect(fallback.task).toBe("krk-9");
    } finally {
      await f.dispose();
    }
  });

  it("a_wrong_token_falls_back_and_tells_once", async () => {
    const runs = memoryRuns();
    const f = await fixture(runs, "krk-9");
    try {
      const { run } = await runs.create({
        workspace: "acme",
        project: "app",
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
      });
      const headers = { "x-peer-run": run.id, "x-peer-run-token": "f".repeat(32) };
      const first = await hookOf(f.broker, start("one", f.root), headers);
      expect(contextOf(first)).toContain(
        `Peer: PEER_RUN names run ${run.id}, but its token does not match; this session runs without it.`,
      );
      const session = f.broker.sessions.get("claude:one")!;
      expect(session.task).toBe("krk-9");
      expect(session.run).not.toBe(run.id);
      expect(runs.get(run.id)!.sessions).toEqual([]);
      const second = await hookOf(f.broker, prompt("one", f.root), headers);
      expect(contextOf(second)).not.toContain("PEER_RUN names");
    } finally {
      await f.dispose();
    }
  });

  it("an_adopted_session_gets_a_run", async () => {
    const runs = memoryRuns();
    const f = await fixture(runs, "krk-2");
    try {
      await hookOf(f.broker, start("one", f.root), {});
      const session = f.broker.sessions.get("claude:one")!;
      const run = runs.get(session.run!)!;
      expect(run).toMatchObject({ task: "krk-2", agent: "claude", runtime: "terminal" });
      expect(stateOf(run)).toBe("running");
      // Its end detaches the run; a session with no task gets none.
      await hookOf(f.broker, { ...start("one", f.root), hook_event_name: "SessionEnd" }, {});
      expect(stateOf(runs.get(run.id)!)).toBe("detached");
    } finally {
      await f.dispose();
    }
  });

  it("a_new_session_continues_a_detached_run_and_restores_its_context", async () => {
    const runs = memoryRuns();
    const f = await fixture(runs);
    try {
      const { run, token } = await runs.create({
        workspace: "acme",
        project: "app",
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
      });
      const headers = { "x-peer-run": run.id, "x-peer-run-token": token! };
      await hookOf(f.broker, start("one", f.root), headers);
      const one = f.broker.sessions.get("claude:one")!;
      expect(one.ownContextPath.endsWith(`${run.id}.md`)).toBe(true);
      one.heard.add("finding-1");
      await f.broker.saveMemories();
      await NodeFSP.writeFile(one.ownContextPath, "# Working context\n\nSplit by currency.\n");
      await hookOf(f.broker, { ...start("one", f.root), hook_event_name: "SessionEnd" }, headers);
      expect(stateOf(runs.get(run.id)!)).toBe("detached");

      await hookOf(f.broker, start("two", f.root), headers);
      const two = f.broker.sessions.get("claude:two")!;
      expect(two.run).toBe(run.id);
      expect(two.ownContextPath).toBe(one.ownContextPath);
      // What the run's last session heard is not told again.
      expect(two.heard.has("finding-1")).toBe(true);
      const now = runs.get(run.id)!;
      expect(stateOf(now)).toBe("running");
      expect(now.sessions.map((s) => s.id)).toEqual(["claude:one", "claude:two"]);
    } finally {
      await f.dispose();
    }
  });

  it("an_ended_run_starts_a_new_one", async () => {
    const runs = memoryRuns();
    const f = await fixture(runs);
    try {
      const { run, token } = await runs.create({
        workspace: "acme",
        project: "app",
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
      });
      await runs.end(run.id, "handed-off");
      const out = await hookOf(f.broker, start("one", f.root), {
        "x-peer-run": run.id,
        "x-peer-run-token": token!,
      });
      expect(contextOf(out)).toContain(
        `Peer: run ${run.id} ended (handed-off); this session starts a new run on the same task.`,
      );
      const session = f.broker.sessions.get("claude:one")!;
      expect(session.run).not.toBe(run.id);
      expect(runs.get(session.run!)).toMatchObject({ task: "krk-1", runtime: "terminal" });
      expect(stateOf(runs.get(run.id)!)).toBe("ended");
    } finally {
      await f.dispose();
    }
  });

  it("ending a run releases its session's claims", async () => {
    const runs = memoryRuns();
    const f = await fixture(runs, "krk-3");
    try {
      await f.broker.start();
      await hookOf(f.broker, start("one", f.root), {});
      const session = f.broker.sessions.get("claude:one")!;
      session.claims = ["pay.ts"];
      await runs.end(session.run!, "stopped");
      expect(session.claims).toEqual([]);
    } finally {
      await f.dispose();
    }
  });
});
