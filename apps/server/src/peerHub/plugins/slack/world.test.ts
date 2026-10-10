import { describe, expect, it } from "@effect/vitest";
import type { PeerLocalAgent, PeerTask } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import type { ReportedThread } from "../../core/plugin.ts";
import { makeWorld, type SlackThreads } from "./world.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const NOON = Date.parse("2026-10-10T12:00:00Z");

/** A thread's shell as the projection gives it: this one is working. */
const shell = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  projectId: "t3-pay",
  title: "Fix the login",
  providerInstanceId: "claudeAgent",
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "t1" },
  archivedAt: null,
  settledAt: null,
  status: "running",
  activeRunId: "run-1",
  activityRunStatus: "running",
  latestRunId: "run-1",
  latestRunCompletedAt: null,
  latestUserMessageAt: at("2026-10-10T11:00:00Z"),
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  pendingBackgroundTasks: [],
  ...over,
});
const asking = (id = "req-1", kind = "command") =>
  shell({
    status: "waiting",
    activityRunStatus: "waiting",
    pendingRuntimeRequest: { id, kind, createdAt: at("2026-10-10T11:58:00Z") },
  });
/** Its run completed at `iso`, after the person's last message. */
const finished = (iso: string, over: Record<string, unknown> = {}) =>
  shell({
    status: "completed",
    activeRunId: null,
    activityRunStatus: null,
    latestRunCompletedAt: at(iso),
    ...over,
  });

const row = (id: string, over: Partial<ReportedThread> = {}): ReportedThread => ({
  id,
  project: "pay",
  title: "x",
  status: "working",
  source: "peer",
  ...over,
});
const task: PeerTask = {
  id: "krk-1",
  key: "KRK-1",
  title: "Split payments",
  status: "open",
  createdBy: "a",
  createdAt: "x",
  updatedAt: "x",
};
const agent = (over: Partial<PeerLocalAgent> = {}): PeerLocalAgent => ({
  id: "herdr:claude:s1",
  paneId: "pane-1",
  agent: "claude",
  title: "Refactor billing",
  status: "done",
  session: "s1",
  turn: 4,
  ...over,
});

const rig = () => {
  const reads = { snapshot: 0, requests: 0, messages: 0, lastMessage: 0 };
  const now = {
    shells: [] as ReadonlyArray<unknown>,
    reachable: true,
    bound: true,
    request: {
      runtimeRequests: [
        { id: "req-1", status: "pending", responseCapability: { type: "live" } },
      ] as unknown[],
      turnItems: [
        { type: "approval_request", requestId: "req-1", prompt: "Run the migration?" },
      ] as unknown[],
    },
    said: "Done. Next?" as string | undefined,
    reported: [row("peer:t1", { task: "krk-1" })],
    agents: [] as ReadonlyArray<PeerLocalAgent>,
  };
  const threads = {
    getShellSnapshot: () => {
      reads.snapshot += 1;
      return now.reachable
        ? Effect.succeed({ threads: now.shells } as never)
        : Effect.fail("down" as never);
    },
    getThreadRecords: (_id: string, fields: ReadonlyArray<string>) =>
      Effect.sync(() => {
        if (fields.includes("messages")) {
          reads.messages += 1;
          return { messages: now.said === undefined ? [] : [{ streaming: false, text: now.said }] };
        }
        reads.requests += 1;
        return now.request;
      }),
  } as unknown as SlackThreads;
  const world = makeWorld({
    work: {
      localThreads: Effect.sync(() => new Map([["acme", now.reported]])),
      tasks: (_workspace: string, project: string) =>
        Effect.succeed(project === "pay" ? [task] : []),
    } as never,
    agents: {
      runtimeAgents: Effect.sync(() => now.agents),
      lastMessage: () =>
        Effect.sync(() => {
          reads.lastMessage += 1;
          return now.said;
        }),
    } as never,
    threads: () => (now.bound ? threads : undefined),
    computer: "Ana's Mac",
  });
  const look = (workspaces = ["acme"], tracked: ReadonlyArray<string> = []) =>
    world(new Set(workspaces), new Set(tracked));
  return { now, reads, look };
};

describe("the waits of this computer's agents", () => {
  it.effect("puts a thread's approval where the work report puts the thread", () =>
    Effect.gen(function* () {
      const { now, look } = rig();
      now.shells = [asking()];
      const world = yield* look();
      expect(world?.waits).toHaveLength(1);
      expect(world?.waits[0]).toMatchObject({
        waitKey: "peer:t1:req:req-1",
        kind: "approval",
        workspace: "acme",
        project: "pay",
        task: { id: "krk-1", key: "KRK-1", title: "Split payments" },
        text: "Run the migration?",
        decisions: ["accept", "decline"],
        subject: { key: "peer:t1", computer: "Ana's Mac" },
      });
      const source = world?.sources.get("peer:t1:req:req-1");
      expect(source && "thread" in source ? source.thread.request : undefined).toMatchObject({
        kind: "approval",
        requestId: "req-1",
      });
    }),
  );

  it.effect("carries a question's options and the answers it takes", () =>
    Effect.gen(function* () {
      const { now, look } = rig();
      now.shells = [asking("req-1", "user_input")];
      now.request = {
        runtimeRequests: [
          { id: "req-1", status: "pending", responseCapability: { type: "message" } },
        ],
        turnItems: [
          {
            type: "user_input_request",
            requestId: "req-1",
            questions: [
              {
                id: "q1",
                header: "Mode",
                question: "Which mode?",
                allowCustomAnswer: false,
                options: [
                  { label: "Fast", description: "d", value: "fast" },
                  { label: "Safe", description: "d" },
                ],
              },
            ],
          },
        ],
      };
      const world = yield* look();
      expect(world?.waits[0]).toMatchObject({
        kind: "question",
        text: "Which mode?",
        options: ["Fast", "Safe"],
      });
      const source = world?.sources.get("peer:t1:req:req-1");
      const request = source && "thread" in source ? source.thread.request : undefined;
      expect(
        request?.kind === "user_input" ? request.questions[0]?.allowCustomAnswer : "none",
      ).toBe(false);
    }),
  );

  it.effect("leaves out a request nobody can answer", () =>
    Effect.gen(function* () {
      const { now, look } = rig();
      now.shells = [asking()];
      for (const runtimeRequests of [
        [{ id: "req-1", status: "pending", responseCapability: { type: "not_resumable" } }],
        [{ id: "req-1", status: "resolved", responseCapability: { type: "live" } }],
        [],
      ]) {
        now.request = { ...now.request, runtimeRequests };
        expect((yield* look())?.waits).toEqual([]);
      }
      // Nor does a request of a kind Slack cannot carry have a wait.
      now.request = { runtimeRequests: now.request.runtimeRequests, turnItems: [] };
      expect((yield* look())?.waits).toEqual([]);
    }),
  );

  it.effect("reads a finished turn's last words once, and not again once it is over", () =>
    Effect.gen(function* () {
      const { now, reads, look } = rig();
      yield* TestClock.setTime(NOON);
      now.shells = [finished("2026-10-10T11:50:00Z")];
      const first = yield* look();
      expect(first?.waits[0]).toMatchObject({
        waitKey: "peer:t1:run:run-1",
        kind: "finished",
        text: "Done. Next?",
        title: "KRK-1 Split payments",
      });
      yield* look();
      yield* look();
      expect(reads.messages).toBe(1);
      // The person wrote again: the turn is over, and its words are forgotten.
      now.shells = [shell({ latestUserMessageAt: at("2026-10-10T11:59:00Z") })];
      expect((yield* look())?.waits).toEqual([]);
      now.shells = [finished("2026-10-10T11:50:00Z")];
      yield* look();
      expect(reads.messages).toBe(2);
    }),
  );

  it.effect("takes a turn that ended long ago for history, unless it is tracked", () =>
    Effect.gen(function* () {
      const { now, reads, look } = rig();
      yield* TestClock.setTime(NOON);
      now.shells = [finished("2026-10-10T11:29:00Z")];
      expect((yield* look())?.waits).toEqual([]);
      expect(reads.messages).toBe(0);
      expect((yield* look(["acme"], ["peer:t1:run:run-1"]))?.waits).toHaveLength(1);
    }),
  );

  it.effect(
    "asks only about threads of the workspaces given that are not settled or archived",
    () =>
      Effect.gen(function* () {
        const { now, look } = rig();
        now.reported = [row("peer:t1"), row("peer:t2"), row("peer:t3"), row("peer:t4")];
        now.shells = [
          asking(),
          { ...asking(), id: "t2", settledAt: at("2026-10-10T11:00:00Z") },
          { ...asking(), id: "t3", archivedAt: at("2026-10-10T11:00:00Z") },
          { ...asking(), id: "t9" },
        ];
        expect((yield* look())?.waits.map((wait) => wait.subject.key)).toEqual(["peer:t1"]);
        expect((yield* look(["elsewhere"]))?.waits).toEqual([]);
      }),
  );

  it.effect("makes a finished herdr agent a wait with its last words, read once", () =>
    Effect.gen(function* () {
      const { now, reads, look } = rig();
      now.reported = [
        row("herdr:claude:s1", { source: "herdr", previousId: "herdr:term-1", task: "krk-1" }),
      ];
      now.agents = [agent()];
      for (let i = 0; i < 3; i++) {
        const wait = (yield* look())?.waits[0];
        expect(wait).toMatchObject({
          waitKey: "herdr:claude:s1:done:4",
          kind: "finished",
          text: "Done. Next?",
          task: { id: "krk-1" },
          subject: { key: "herdr:claude:s1", previous: "herdr:term-1", agent: "Claude Code" },
        });
      }
      expect(reads.lastMessage).toBe(1);
    }),
  );

  it.effect(
    "posts a blocked herdr agent as a notice, and a finished one only when it can be answered",
    () =>
      Effect.gen(function* () {
        const { now, reads, look } = rig();
        now.reported = [
          row("herdr:claude:s1", { source: "herdr" }),
          row("herdr:term-2", { source: "herdr" }),
        ];
        now.agents = [
          agent({ status: "blocked" }),
          // Finished, but its session and turn are not known: nothing could be typed into it safely.
          { id: "herdr:term-2", paneId: "pane-2", agent: "claude", title: "Other", status: "done" },
          agent({ id: "herdr:term-3", paneId: "pane-3", status: "working" }),
        ];
        const waits = (yield* look())?.waits ?? [];
        expect(waits.map((wait) => [wait.kind, wait.text])).toEqual([["blocked", undefined]]);
        expect(reads.lastMessage).toBe(0);
      }),
  );

  it.effect("says why a decision point is no longer there", () =>
    Effect.gen(function* () {
      const { now, look } = rig();
      now.shells = [shell()];
      now.agents = [agent({ status: "working" })];
      const world = yield* look();
      expect(world?.why("peer:t1:req:req-0")).toBe("handled");
      expect(world?.why("peer:t1:run:run-0")).toBe("moved-on");
      expect(world?.why("peer:gone:req:req-1")).toBe("ended");
      expect(world?.why("herdr:claude:s1:done:3")).toBe("moved-on");
      expect(world?.why("herdr:codex:s9:done:1")).toBe("ended");
    }),
  );

  it.effect("concludes nothing while T3's threads cannot be read", () =>
    Effect.gen(function* () {
      const { now, look } = rig();
      now.bound = false;
      expect(yield* look()).toBeUndefined();
      now.bound = true;
      now.reachable = false;
      expect(yield* look()).toBeUndefined();
    }),
  );
});
