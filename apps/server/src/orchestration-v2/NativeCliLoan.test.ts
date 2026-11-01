import { describe, expect, it } from "@effect/vitest";
import {
  type CommandId,
  type NativeCliTurn,
  type OrchestrationV2CliLoan,
  type OrchestrationV2ServerCommand,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProjectId,
  type TerminalEvent,
  ThreadId,
} from "@t3tools/contracts";
import type { AcpSessionHistory } from "@t3tools/provider-acp/server/AcpSessionHistory";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as TerminalManager from "../terminal/Manager.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as NativeCliHistory from "./NativeCliHistory.ts";
import * as NativeCliLoan from "./NativeCliLoan.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

const threadId = ThreadId.make("thread-1");
const providerThreadId = ProviderThreadId.make("provider-thread-1");
const providerSessionId = ProviderSessionId.make("provider-session-1");

const turn = (nativeMessageId: string): NativeCliTurn => ({
  nativeMessageId,
  text: nativeMessageId,
  entries: [],
});

const session = (...ids: ReadonlyArray<string>): AcpSessionHistory => ({
  turns: ids.map(turn),
  compacted: false,
});

const openLoan = (afterNativeMessageId: string | null): OrchestrationV2CliLoan => ({
  terminalId: "cli-loan-terminal",
  afterNativeMessageId,
  startedAt: DateTime.makeUnsafe(0),
});

const terminalEvent = (
  type: "exited" | "error" | "closed" | "restarted" | "started" | "activity",
  terminalId = "cli-loan-terminal",
): TerminalEvent => {
  const base = { threadId, terminalId };
  const snapshot = {
    ...base,
    cwd: "/repo",
    worktreePath: null,
    status: "running",
    pid: 10,
    history: "",
    exitCode: null,
    exitSignal: null,
    label: "term",
    updatedAt: "2026-11-01T10:00:00.000Z",
  } as const;
  switch (type) {
    case "exited":
      return { ...base, type, exitCode: 0, exitSignal: null };
    case "error":
      return { ...base, type, message: "spawn failed" };
    case "closed":
      return { ...base, type };
    case "activity":
      return { ...base, type, hasRunningSubprocess: false, label: "term" };
    case "started":
    case "restarted":
      return { ...base, type, snapshot };
  }
};

interface HarnessOptions {
  readonly driver?: string;
  readonly runs?: ReadonlyArray<{ readonly id: string; readonly status: string }>;
  readonly cliLoan?: OrchestrationV2CliLoan | null;
  readonly headRef?: unknown;
  readonly nativeId?: string;
  readonly boundSession?: boolean;
  readonly detachStatus?: EffectOutbox.OrchestrationEffectStatusV2;
  readonly history?: Effect.Effect<AcpSessionHistory, NativeCliHistory.NativeCliHistoryError>;
  readonly refuseFinishWithTurns?: boolean;
  readonly refuseDetachAsLive?: boolean;
  readonly prepareContinue?: Effect.Effect<void, NativeCliHistory.NativeCliHistoryError>;
  readonly deleted?: boolean;
  readonly openLoanThreads?: ReadonlyArray<ThreadId>;
  readonly holdStoppedProcess?: boolean;
  readonly archived?: boolean;
  readonly rollingBack?: boolean;
  readonly backgroundTasks?: ReadonlyArray<{ readonly taskId: string; readonly kind: string }>;
  readonly refuseLoanAsRollingBack?: boolean;
  readonly refuseDetachForBackgroundWork?: boolean;
}

const makeHarness = (options: HarnessOptions = {}) =>
  Effect.gen(function* () {
    const state = {
      runs: [...(options.runs ?? [])],
      cliLoan: options.cliLoan ?? null,
      dispatched: [] as Array<OrchestrationV2ServerCommand>,
      reads: 0,
      prepared: 0,
      commandInputs: [] as Array<unknown>,
      terminalRunning: false,
      listener: null as ((event: TerminalEvent) => Effect.Effect<void>) | null,
    };
    const gates = {
      detachSettled: yield* Deferred.make<void>(),
      detachAwaited: yield* Deferred.make<void>(),
      readStarted: yield* Deferred.make<void>(),
      finishDispatched: yield* Deferred.make<void>(),
      stoppedProcessAwaited: yield* Deferred.make<void>(),
      stoppedProcessGone: yield* Deferred.make<void>(),
      recordsRead: yield* Deferred.make<void>(),
    };
    let holdDetach = false;

    const orchestrator = {
      getThreadRecords: () =>
        Effect.sync(() => {
          Deferred.doneUnsafe(gates.recordsRead, Effect.void);
          return {
            thread: {
              id: threadId,
              projectId: ProjectId.make("project-1"),
              activeProviderThreadId: providerThreadId,
              worktreePath: "/repo/worktree",
              lineage: { relationshipToParent: null },
              deletedAt: options.deleted === true ? DateTime.makeUnsafe(0) : null,
              archivedAt: options.archived === true ? DateTime.makeUnsafe(0) : null,
              modelSelection: { instanceId: "claudeAgent", model: "claude-haiku" },
            },
            runs: [...state.runs],
            turnItems: [],
            providerSessions: options.boundSession === false ? [] : [{ id: providerSessionId }],
            providerThreads: [
              {
                id: providerThreadId,
                driver: ProviderDriverKind.make(options.driver ?? "claudeAgent"),
                providerInstanceId: ProviderInstanceId.make("claudeAgent"),
                providerSessionId,
                nativeThreadRef: { nativeId: options.nativeId ?? "native-1" },
                nativeConversationHeadRef: options.headRef ?? null,
                cliLoan: state.cliLoan,
                pendingBackgroundTasks: options.backgroundTasks ?? [],
              },
            ],
          };
        }),
      dispatch: (command: OrchestrationV2ServerCommand) =>
        Effect.gen(function* () {
          if (
            options.refuseFinishWithTurns === true &&
            command.type === "thread.cli-loan.finish" &&
            command.turns.length > 0
          ) {
            return yield* Effect.fail({ _tag: "Refused" });
          }
          if (options.refuseDetachAsLive === true && command.type === "provider-session.detach") {
            return yield* Effect.fail({ _tag: "OrchestratorThreadHasLiveRunError" });
          }
          if (
            (options.refuseLoanAsRollingBack === true &&
              command.type === "thread.cli-loan.start") ||
            (options.refuseDetachForBackgroundWork === true &&
              command.type === "provider-session.detach")
          ) {
            return yield* new Orchestrator.OrchestratorThreadNotReadyForCliError({
              commandId: command.commandId,
              commandType: command.type,
              threadId,
              reason: command.type === "thread.cli-loan.start" ? "rolling_back" : "background_work",
            });
          }
          state.dispatched.push(command);
          if (command.type === "thread.cli-loan.start") state.cliLoan = command.loan;
          if (command.type === "thread.cli-loan.finish") {
            state.cliLoan = null;
            yield* Deferred.succeed(gates.finishDispatched, undefined);
          }
          return {};
        }),
    };

    const outbox = {
      listByCommandId: (commandId: CommandId) =>
        Effect.sync(() => [
          { id: `effect:${commandId}`, status: options.detachStatus ?? "succeeded" },
        ]),
      hasUnsettled: () => Effect.succeed(options.rollingBack === true),
      awaitSettled: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(gates.detachAwaited, undefined);
          if (holdDetach) yield* Deferred.await(gates.detachSettled);
        }),
    };

    const layer = NativeCliLoan.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Orchestrator.OrchestratorV2, orchestrator as never),
          Layer.succeed(EffectOutbox.EffectOutboxV2, outbox as never),
          Layer.succeed(ProjectionStore.ProjectionStoreV2, {
            getThreadIdsWithOpenCliLoan: () => Effect.succeed(options.openLoanThreads ?? []),
          } as never),
          Layer.succeed(ProjectStore.ProjectStoreV2, {
            get: () => Effect.succeed(Option.some({ workspaceRoot: "/repo" })),
          } as never),
          Layer.succeed(TerminalManager.TerminalManager, {
            isProcessRunning: () => Effect.sync(() => state.terminalRunning),
            awaitStoppedProcess: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(gates.stoppedProcessAwaited, undefined);
                if (options.holdStoppedProcess === true) {
                  yield* Deferred.await(gates.stoppedProcessGone);
                }
              }),
            subscribe: (listener: (event: TerminalEvent) => Effect.Effect<void>) =>
              Effect.sync(() => {
                state.listener = listener;
                return () => undefined;
              }),
          } as never),
          Layer.succeed(NativeCliHistory.NativeCliHistory, {
            commands: (input: unknown) =>
              Effect.sync(() => {
                state.commandInputs.push(input);
                return {
                  continueCommand: "exec claude --resume 'native-1'",
                  forkCommand: "claude --resume 'native-1' --fork-session",
                };
              }),
            prepareContinue: () =>
              Effect.suspend(() => {
                state.prepared += 1;
                return options.prepareContinue ?? Effect.void;
              }),
            read: () =>
              Effect.gen(function* () {
                state.reads += 1;
                yield* Deferred.succeed(gates.readStarted, undefined);
                return yield* options.history ?? Effect.succeed(session("user-1"));
              }),
          } as never),
          Layer.succeed(Crypto.Crypto, {
            randomUUIDv4: () => Effect.succeed(`uuid-${state.dispatched.length}`),
          } as never),
        ),
      ),
    );
    const context = yield* Layer.build(layer);
    const loans = yield* NativeCliLoan.NativeCliLoan.pipe(Effect.provide(context));
    yield* loans.watchTerminals();
    const observe = (event: TerminalEvent) => state.listener!(event);
    return {
      state,
      gates,
      loans,
      observe,
      holdDetach: () => {
        holdDetach = true;
      },
      commands: (type: OrchestrationV2ServerCommand["type"]) =>
        state.dispatched.filter((command) => command.type === type),
    };
  });

const reasonOf = <A>(effect: Effect.Effect<A, { readonly reason: string }>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("NativeCliLoan.start", () => {
  it.effect("reads the session only after the detach has settled", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      harness.holdDetach();
      const started = yield* harness.loans.start({ threadId }).pipe(Effect.forkChild);

      yield* Deferred.await(harness.gates.detachAwaited);
      expect(harness.commands("provider-session.detach")).toHaveLength(1);
      expect(harness.state.reads).toBe(0);
      expect(harness.state.cliLoan).toBeNull();

      yield* Deferred.succeed(harness.gates.detachSettled, undefined);
      const launch = yield* Fiber.join(started);

      expect(harness.state.reads).toBe(1);
      expect(launch).toMatchObject({
        cwd: "/repo/worktree",
        command: "exec claude --resume 'native-1'",
        providerInstanceId: "claudeAgent",
      });
      expect(launch).not.toHaveProperty("env");
      expect(harness.state.cliLoan).toMatchObject({
        terminalId: launch.terminalId,
        afterNativeMessageId: "user-1",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("opens no loan when the detach did not succeed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ detachStatus: "failed" });
      expect(yield* reasonOf(harness.loans.start({ threadId }))).toBe("detach_failed");
      expect(harness.state.reads).toBe(0);
      expect(harness.state.cliLoan).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("opens no loan when the read fails, though the process was closed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        history: Effect.fail(
          new NativeCliHistory.NativeCliReadError({ agentId: "claude-acp", cause: "boom" }),
        ),
      });
      expect(yield* reasonOf(harness.loans.start({ threadId }))).toBe("read_failed");
      expect(harness.commands("provider-session.detach")).toHaveLength(1);
      expect(harness.state.cliLoan).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("skips the detach when the thread has no provider session bound", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ boundSession: false });
      yield* harness.loans.start({ threadId });
      expect(harness.commands("provider-session.detach")).toHaveLength(0);
      expect(harness.state.cliLoan).not.toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("refuses before closing or reading anything", () =>
    Effect.gen(function* () {
      const cases = [
        [{ runs: [{ id: "run-1", status: "running" }] }, "run_active"],
        [{ cliLoan: openLoan("user-1") }, "out_in_cli"],
        [{ headRef: { nativeId: "head" } }, "rolled_back"],
        [{ nativeId: "pending:1" }, "unavailable"],
      ] as const;
      for (const [options, reason] of cases) {
        const harness = yield* makeHarness(options);
        expect(yield* reasonOf(harness.loans.start({ threadId }))).toBe(reason);
        expect(harness.state.dispatched).toEqual([]);
        expect(harness.state.reads).toBe(0);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("refuses for a person before closing anything", () =>
    Effect.gen(function* () {
      const finished = [{ id: "run-1", status: "completed" }];
      const cases = [
        [{ archived: true }, "unavailable", "This thread is archived. Unarchive it first."],
        [
          { rollingBack: true },
          "run_active",
          "This thread is still rolling back. Try again in a moment.",
        ],
        [
          { runs: finished, backgroundTasks: [{ taskId: "task-1", kind: "subagent" }] },
          "run_active",
          "Background work is still running in this thread. Wait for it to finish first.",
        ],
      ] as const;
      for (const [options, reason, message] of cases) {
        const harness = yield* makeHarness(options);
        const refused = yield* harness.loans.start({ threadId }).pipe(Effect.flip);
        expect([refused.reason, refused.message]).toEqual([reason, message]);
        expect(harness.state.dispatched).toEqual([]);
        expect(harness.state.reads).toBe(0);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("lends a thread whose only background work is a plain command", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        runs: [{ id: "run-1", status: "completed" }],
        backgroundTasks: [{ taskId: "task-1", kind: "command" }],
      });
      yield* harness.loans.start({ threadId });
      expect(harness.state.cliLoan).not.toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("words a refusal the dispatches make after the first checks passed", () =>
    Effect.gen(function* () {
      const rollback = yield* makeHarness({ refuseLoanAsRollingBack: true });
      const rolling = yield* rollback.loans.start({ threadId }).pipe(Effect.flip);
      expect([rolling.reason, rolling.message]).toEqual([
        "run_active",
        "This thread is still rolling back. Try again in a moment.",
      ]);
      expect(rollback.state.cliLoan).toBeNull();

      const background = yield* makeHarness({ refuseDetachForBackgroundWork: true });
      const busy = yield* background.loans.start({ threadId }).pipe(Effect.flip);
      expect([busy.reason, busy.message]).toEqual([
        "run_active",
        "Background work is still running in this thread. Wait for it to finish first.",
      ]);
      expect(background.state.reads).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.effect("lends a Codex session that was rolled back, which rewinds at rollback itself", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ driver: "codex", headRef: { nativeId: "head" } });
      yield* harness.loans.start({ threadId });
      expect(harness.state.cliLoan).not.toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("lets one of two concurrent starts win", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const exits = yield* Effect.all(
        [
          Effect.exit(harness.loans.start({ threadId })),
          Effect.exit(harness.loans.start({ threadId })),
        ],
        { concurrency: "unbounded" },
      );
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
      expect(harness.commands("thread.cli-loan.start")).toHaveLength(1);
      expect(harness.state.reads).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("installs the adapter before it closes anything", () =>
    Effect.gen(function* () {
      const failing = yield* makeHarness({
        prepareContinue: Effect.fail(
          new NativeCliHistory.NativeCliUnavailableError({
            reason: "unsupported_platform",
            providerInstanceId: "claudeAgent",
          }),
        ),
      });
      expect(yield* reasonOf(failing.loans.start({ threadId }))).toBe("unavailable");
      expect(failing.state.dispatched).toEqual([]);

      const harness = yield* makeHarness();
      harness.holdDetach();
      const started = yield* harness.loans.start({ threadId }).pipe(Effect.forkChild);
      yield* Deferred.await(harness.gates.detachAwaited);
      expect(harness.state.prepared).toBe(1);
      yield* Deferred.succeed(harness.gates.detachSettled, undefined);
      yield* Fiber.join(started);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses as still running when a run starts just before the detach", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ refuseDetachAsLive: true });
      expect(yield* reasonOf(harness.loans.start({ threadId }))).toBe("run_active");
      expect(harness.state.reads).toBe(0);
      expect(harness.state.cliLoan).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("passes the thread's model to the command it answers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.loans.start({ threadId });
      expect(harness.state.commandInputs).toMatchObject([
        { modelSelection: { model: "claude-haiku" } },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses with Codex's reason when another client holds the session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        history: Effect.fail(
          new NativeCliHistory.NativeCliSessionInUseError({ agentId: "codex-acp", cause: "held" }),
        ),
      });
      const failure = yield* harness.loans.start({ threadId }).pipe(Effect.flip);
      expect(failure.reason).toBe("session_in_use");
      expect(failure.message).toContain("in use by another Codex client");
      expect(harness.state.cliLoan).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("gives the loan back when a run moved during the read, at the same count", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        runs: [{ id: "run-1", status: "queued" }],
        history: Effect.suspend(() => {
          harness.state.runs[0] = { id: "run-1", status: "completed" };
          return Effect.succeed(session("user-1"));
        }),
      });
      expect(yield* reasonOf(harness.loans.start({ threadId }))).toBe("changed");
      expect(harness.state.cliLoan).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("gives the loan back when a turn started during the read", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        history: Effect.suspend(() => {
          harness.state.runs.push({ id: "run-new", status: "completed" });
          return Effect.succeed(session("user-1"));
        }),
      });
      expect(yield* reasonOf(harness.loans.start({ threadId }))).toBe("changed");
      expect(harness.state.cliLoan).toBeNull();
      expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
        { turns: [], gap: "none" },
      ]);
    }).pipe(Effect.scoped),
  );
});

describe("NativeCliLoan.finish", () => {
  it.effect("imports the turns after the loan's position", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: openLoan("user-1"),
        history: Effect.succeed(session("user-1", "user-2")),
      });
      yield* harness.loans.finish({ threadId });
      expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
        { providerThreadId, gap: "none", turns: [{ nativeMessageId: "user-2" }] },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("reports a session that no longer holds the position as diverged", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: openLoan("gone"),
        history: Effect.succeed(session("user-2")),
      });
      yield* harness.loans.finish({ threadId });
      expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
        { turns: [], gap: "diverged" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("brings the thread back with gap unread when the read fails or dies", () =>
    Effect.gen(function* () {
      const failures = [
        Effect.fail(
          new NativeCliHistory.NativeCliReadError({ agentId: "claude-acp", cause: "boom" }),
        ),
        Effect.die("adapter crashed"),
      ];
      for (const history of failures) {
        const harness = yield* makeHarness({ cliLoan: openLoan("user-1"), history });
        yield* harness.loans.finish({ threadId });
        expect(harness.state.cliLoan).toBeNull();
        expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
          { turns: [], gap: "unread" },
        ]);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("brings the thread back without its turns when they cannot land", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: openLoan("user-1"),
        history: Effect.succeed(session("user-1", "user-2")),
        refuseFinishWithTurns: true,
      });
      yield* harness.loans.finish({ threadId });
      expect(harness.state.cliLoan).toBeNull();
      expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
        { turns: [], gap: "unread" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("does nothing on a thread with no open loan", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.loans.finish({ threadId });
      expect(harness.state.dispatched).toEqual([]);
      expect(harness.state.reads).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.effect("imports once when two finishes race", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cliLoan: openLoan("user-1") });
      yield* Effect.all([harness.loans.finish({ threadId }), harness.loans.finish({ threadId })], {
        concurrency: "unbounded",
        discard: true,
      });
      expect(harness.commands("thread.cli-loan.finish")).toHaveLength(1);
      expect(harness.state.reads).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("asks the terminal itself whether the CLI still runs", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cliLoan: openLoan("user-1") });
      harness.state.terminalRunning = true;
      const refused = yield* harness.loans.finish({ threadId }).pipe(Effect.flip);
      expect(refused.reason).toBe("terminal_busy");
      expect(refused.message).toContain("close its terminal");
      expect(harness.state.reads).toBe(0);
      expect(harness.state.cliLoan).not.toBeNull();

      harness.state.terminalRunning = false;
      yield* harness.loans.finish({ threadId });
      expect(harness.state.cliLoan).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("ends the loan as unread when the session is still in use at the bound", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: openLoan("user-1"),
        history: Effect.fail(
          new NativeCliHistory.NativeCliSessionInUseError({ agentId: "codex-acp", cause: "held" }),
        ),
      });
      yield* harness.loans.finish({ threadId });
      expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
        { turns: [], gap: "unread" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("does nothing on a deleted thread, whose terminal the delete closed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cliLoan: openLoan("user-1"), deleted: true });
      yield* harness.loans.finish({ threadId });
      expect(harness.state.reads).toBe(0);
      expect(harness.state.dispatched).toEqual([]);
    }).pipe(Effect.scoped),
  );
});

describe("NativeCliLoan after a restart", () => {
  const loanFromBeforeTheRestart = {
    ...openLoan("user-1"),
    startedAt: DateTime.makeUnsafe(-1_000),
  };

  it.effect("ends an open loan on startup, though a plain shell now holds its terminal", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: loanFromBeforeTheRestart,
        openLoanThreads: [threadId],
        history: Effect.succeed(session("user-1", "user-2")),
      });
      harness.state.terminalRunning = true;
      yield* Deferred.await(harness.gates.finishDispatched);
      expect(harness.state.cliLoan).toBeNull();
      expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
        { gap: "none", turns: [{ nativeMessageId: "user-2" }] },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("brings the thread back with a gap when the startup read fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: loanFromBeforeTheRestart,
        openLoanThreads: [threadId],
        history: Effect.fail(
          new NativeCliHistory.NativeCliReadError({ agentId: "claude-acp", cause: "boom" }),
        ),
      });
      yield* Deferred.await(harness.gates.finishDispatched);
      expect(harness.commands("thread.cli-loan.finish")).toMatchObject([
        { turns: [], gap: "unread" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a loan that began after this server came up", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: openLoan("user-1"),
        openLoanThreads: [threadId],
      });
      harness.state.terminalRunning = true;
      // The sweep reads inside the thread's lock, so this finish runs after it left that lock, and
      // can only be refused for a running CLI if the sweep left the loan open.
      yield* Deferred.await(harness.gates.recordsRead);
      expect(yield* reasonOf(harness.loans.finish({ threadId }))).toBe("terminal_busy");
      expect(harness.state.reads).toBe(0);
      expect(harness.state.cliLoan).not.toBeNull();
    }).pipe(Effect.scoped),
  );
});

describe("NativeCliLoan terminal watch", () => {
  it.effect("ends the loan on each way the terminal's process can end, with no client", () =>
    Effect.gen(function* () {
      for (const type of ["exited", "error", "closed", "restarted"] as const) {
        const harness = yield* makeHarness({ cliLoan: openLoan("user-1") });
        yield* harness.observe(terminalEvent(type));
        yield* Deferred.await(harness.gates.finishDispatched);
        expect(harness.state.cliLoan).toBeNull();
      }
    }).pipe(Effect.scoped),
  );

  it.effect("reads the session only once the terminal's process is gone", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cliLoan: openLoan("user-1"),
        holdStoppedProcess: true,
      });
      yield* harness.observe(terminalEvent("closed"));
      yield* Deferred.await(harness.gates.stoppedProcessAwaited);
      expect(harness.state.reads).toBe(0);
      expect(harness.state.cliLoan).not.toBeNull();

      yield* Deferred.succeed(harness.gates.stoppedProcessGone, undefined);
      yield* Deferred.await(harness.gates.finishDispatched);
      expect(harness.state.reads).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("only logs when the terminal of a deleted thread closes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cliLoan: openLoan("user-1"), deleted: true });
      yield* harness.observe(terminalEvent("closed"));
      yield* Deferred.await(harness.gates.recordsRead);
      yield* Effect.yieldNow;
      expect(harness.state.reads).toBe(0);
      expect(harness.state.dispatched).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the loan through the terminal's start and what its shell does", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cliLoan: openLoan("user-1") });
      yield* harness.observe(terminalEvent("started"));
      yield* harness.observe(terminalEvent("activity"));
      expect(harness.state.reads).toBe(0);
      expect(harness.state.cliLoan).not.toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("ignores other terminals, and a loan terminal that is not this loan's", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cliLoan: openLoan("user-1") });
      yield* harness.observe(terminalEvent("exited", "term-1"));
      expect(harness.state.reads).toBe(0);

      const finished = yield* makeHarness();
      yield* finished.observe(terminalEvent("exited", "cli-loan-other"));
      expect(finished.state.dispatched).toEqual([]);
    }).pipe(Effect.scoped),
  );
});

describe("NativeCliLoan.fork", () => {
  it.effect("answers a fork without touching the thread's session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cliLoan: openLoan("user-1") });
      const launch = yield* harness.loans.fork({ threadId });
      expect(launch.command).toBe("claude --resume 'native-1' --fork-session");
      expect(launch.terminalId.startsWith("cli-fork-")).toBe(true);
      expect(launch.providerInstanceId).toBe("claudeAgent");
      expect(harness.state.dispatched).toEqual([]);
      expect(harness.state.reads).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.effect("forks an archived thread and one with background work, since it closes nothing", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        archived: true,
        runs: [{ id: "run-1", status: "completed" }],
        backgroundTasks: [{ taskId: "task-1", kind: "subagent" }],
      });
      yield* harness.loans.fork({ threadId });
      expect(harness.state.dispatched).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a Claude thread just rolled back, whose fork would revive those turns", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ headRef: { nativeId: "head" } });
      const refused = yield* harness.loans.fork({ threadId }).pipe(Effect.flip);
      expect(refused.reason).toBe("rolled_back");
      expect(refused.message).toBe(
        "This thread was just rolled back. Send one message before forking it.",
      );
      expect(harness.state.commandInputs).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("forks a Codex thread that was rolled back, which rewinds at rollback itself", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ driver: "codex", headRef: { nativeId: "head" } });
      yield* harness.loans.fork({ threadId });
      expect(harness.state.commandInputs).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
});
