import {
  CommandId,
  isProviderNativeSubagentThread,
  type NativeCliGap,
  type NativeCliInput,
  NativeCliOperationError,
  type NativeCliOperationErrorReason,
  type NativeCliTerminalLaunch,
  type NativeCliTurn,
  type OrchestrationV2AppThread,
  type OrchestrationV2CliLoan,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type ProviderSessionId,
  type TerminalEvent,
  type ThreadId,
} from "@t3tools/contracts";
import { turnsAfter } from "@t3tools/provider-acp/server/AcpSessionHistory";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { forkParked } from "../serverActivation.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as NativeCliHistory from "./NativeCliHistory.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

const LOAN_TERMINAL_PREFIX = "cli-loan-";
const FORK_TERMINAL_PREFIX = "cli-fork-";

/**
 * The detach waits behind the thread's earlier effects and their retries. Past this something is
 * wrong, and the person is told rather than left on a spinner.
 */
const DETACH_TIMEOUT = "60 seconds";

const THREAD_STILL_RUNNING = "This thread is still running. Wait for it to finish first.";

/** Each read spawns the adapter and the CLI, and a restart can find many threads out at once. */
const RESTART_READ_CONCURRENCY = 4;

/** A run that moved at all means the thread is no longer where the loan's position was read. */
const runsChanged = (
  before: ReadonlyArray<OrchestrationV2Run>,
  after: ReadonlyArray<OrchestrationV2Run>,
): boolean => {
  const statusBefore = new Map(before.map((run) => [run.id, run.status]));
  return (
    after.length !== before.length || after.some((run) => statusBefore.get(run.id) !== run.status)
  );
};

export class NativeCliLoan extends Context.Service<
  NativeCliLoan,
  {
    /** Closes the thread's provider process, then lends its session to a terminal the client opens. */
    readonly start: (
      input: NativeCliInput,
    ) => Effect.Effect<NativeCliTerminalLaunch, NativeCliOperationError>;
    /** Refused while the CLI still runs. Otherwise the thread always comes back. */
    readonly finish: (input: NativeCliInput) => Effect.Effect<void, NativeCliOperationError>;
    /** A fork shares nothing with the thread after it starts, so it needs no loan. */
    readonly fork: (
      input: NativeCliInput,
    ) => Effect.Effect<NativeCliTerminalLaunch, NativeCliOperationError>;
    /**
     * Follows every terminal on this server, whether or not a client is connected. Also ends the
     * loans this server found open: no terminal process outlives the server that held its PTY.
     */
    readonly watchTerminals: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration-v2/NativeCliLoan") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const history = yield* NativeCliHistory.NativeCliHistory;
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const terminals = yield* TerminalManager.TerminalManager;
  const crypto = yield* Crypto.Crypto;
  const layerScope = yield* Effect.scope;
  // Per thread, so one thread's adapter install holds up no other thread.
  const loans = yield* KeyedLock.make<ThreadId>();

  const refuse = (
    threadId: ThreadId,
    reason: NativeCliOperationErrorReason,
    message: string,
    cause?: unknown,
  ) =>
    new NativeCliOperationError({
      threadId,
      reason,
      message,
      ...(cause === undefined ? {} : { cause }),
    });

  const unknownThread = (threadId: ThreadId) => (cause: unknown) =>
    refuse(threadId, "unavailable", "This thread is not available.", cause);

  const fromHistoryError =
    (threadId: ThreadId) =>
    (error: NativeCliHistory.NativeCliHistoryError): NativeCliOperationError => {
      switch (error._tag) {
        case "NativeCliAdapterError":
          return refuse(threadId, "adapter_failed", error.message, error);
        case "NativeCliReadError":
          return refuse(threadId, "read_failed", error.message, error);
        case "NativeCliSessionInUseError":
          return refuse(threadId, "session_in_use", error.message, error);
        case "NativeCliSettingsError":
        case "NativeCliUnavailableError":
          return refuse(threadId, "unavailable", error.message, error);
      }
    };

  const nextUuid = crypto.randomUUIDv4().pipe(Effect.orDie);

  const nextCommandId = (operation: string) =>
    nextUuid.pipe(Effect.map((uuid) => CommandId.make(`command:cli-loan:${operation}:${uuid}`)));

  // Written from the thread's records and not `RuntimePolicy`: its capacity rules decide who may
  // start a Peer turn, and they must not keep a finish from reading what already happened.
  const threadCwd = Effect.fn("NativeCliLoan.threadCwd")(function* (
    thread: OrchestrationV2AppThread,
  ) {
    if (thread.worktreePath !== null) return thread.worktreePath;
    const project = yield* projects
      .get(thread.projectId)
      .pipe(Effect.mapError(unknownThread(thread.id)));
    if (Option.isNone(project)) {
      return yield* refuse(thread.id, "unavailable", "This thread's project no longer exists.");
    }
    return project.value.workspaceRoot;
  });

  const activeProviderThread = Effect.fn("NativeCliLoan.activeProviderThread")(function* (
    records: {
      readonly thread: OrchestrationV2AppThread;
      readonly providerThreads: ReadonlyArray<OrchestrationV2ProviderThread>;
    },
    threadId: ThreadId,
  ) {
    const providerThread = records.providerThreads.find(
      (candidate) => candidate.id === records.thread.activeProviderThreadId,
    );
    const nativeId = providerThread?.nativeThreadRef?.nativeId;
    if (
      providerThread === undefined ||
      nativeId == null ||
      nativeId.startsWith("pending:") ||
      records.thread.deletedAt !== null ||
      isProviderNativeSubagentThread(records.thread)
    ) {
      return yield* refuse(threadId, "unavailable", "This thread has no agent session yet.");
    }
    return {
      providerThread,
      ref: {
        driver: providerThread.driver,
        providerInstanceId: providerThread.providerInstanceId,
        nativeId,
      },
    };
  });

  /**
   * A dispatch only records the intent. The process ends in the effect it enqueues, so the session
   * is free once that effect settled, and only if it succeeded.
   */
  const closeProviderSession = Effect.fn("NativeCliLoan.closeProviderSession")(function* (
    threadId: ThreadId,
    providerSessionId: ProviderSessionId,
  ) {
    const failed = (cause?: unknown) =>
      refuse(threadId, "detach_failed", "Peer could not close the agent's session.", cause);
    const commandId = yield* nextCommandId("detach");
    yield* orchestrator
      .dispatch({
        type: "provider-session.detach",
        commandId,
        threadId,
        providerSessionId,
        reason: "The session moved to the agent's own CLI.",
        onlyWhenIdle: true,
      })
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "OrchestratorThreadHasLiveRunError"
            ? refuse(threadId, "run_active", THREAD_STILL_RUNNING, cause)
            : cause._tag === "OrchestratorThreadNotReadyForCliError"
              ? refuse(threadId, "run_active", cause.message, cause)
              : failed(cause),
        ),
      );
    const enqueued = yield* outbox.listByCommandId(commandId).pipe(Effect.mapError(failed));
    const settledInTime = yield* Effect.forEach(
      enqueued,
      (effect) => outbox.awaitSettled(effect.id),
      { discard: true },
    ).pipe(Effect.mapError(failed), Effect.timeoutOption(DETACH_TIMEOUT));
    if (Option.isNone(settledInTime)) return yield* failed();
    const settled = yield* outbox.listByCommandId(commandId).pipe(Effect.mapError(failed));
    if (settled.some((effect) => effect.status !== "succeeded")) return yield* failed();
  });

  const dispatchFinish = Effect.fn("NativeCliLoan.dispatchFinish")(function* (input: {
    readonly threadId: ThreadId;
    readonly providerThread: OrchestrationV2ProviderThread;
    readonly turns: ReadonlyArray<NativeCliTurn>;
    readonly gap: NativeCliGap;
  }) {
    return yield* orchestrator.dispatch({
      type: "thread.cli-loan.finish",
      commandId: yield* nextCommandId("finish"),
      threadId: input.threadId,
      providerThreadId: input.providerThread.id,
      turns: input.turns,
      gap: input.gap,
      finishedAt: yield* DateTime.now,
    });
  });

  const readLoanResult = Effect.fn("NativeCliLoan.readLoanResult")(function* (
    thread: OrchestrationV2AppThread,
    providerThread: OrchestrationV2ProviderThread,
    loan: OrchestrationV2CliLoan,
  ) {
    const nativeId = providerThread.nativeThreadRef?.nativeId;
    if (nativeId == null) return { turns: [], gap: "unread" as const };
    const cwd = yield* threadCwd(thread);
    const session = yield* history.read({
      driver: providerThread.driver,
      providerInstanceId: providerThread.providerInstanceId,
      nativeId,
      cwd,
    });
    return turnsAfter(session, loan.afterNativeMessageId);
  });

  /** Runs under the thread's lock. A thread must come back whatever went wrong with the read. */
  const endLoan = Effect.fn("NativeCliLoan.endLoan")(function* (
    thread: OrchestrationV2AppThread,
    providerThread: OrchestrationV2ProviderThread,
    loan: OrchestrationV2CliLoan,
  ) {
    const threadId = thread.id;
    // Closing the terminal only starts the kill, and the CLI can still write until it is gone. A
    // queued turn starts the moment the loan ends, so it must not end before the CLI has.
    yield* terminals.awaitStoppedProcess({ threadId, terminalId: loan.terminalId });
    const result = yield* readLoanResult(thread, providerThread, loan).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Could not read a session back from its CLI", {
              threadId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as({ turns: [], gap: "unread" as const })),
      ),
    );
    yield* dispatchFinish({ threadId, providerThread, ...result }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Could not import a CLI session's turns", {
              threadId,
              cause: Cause.pretty(cause),
            }).pipe(
              Effect.andThen(
                // Turns that cannot land must not cost the thread: bring it back without them.
                dispatchFinish({ threadId, providerThread, turns: [], gap: "unread" }),
              ),
            ),
      ),
      Effect.mapError((cause) =>
        refuse(threadId, "changed", "Peer could not bring this thread back. Try again.", cause),
      ),
    );
  });

  const readLoan = Effect.fn("NativeCliLoan.readLoan")(function* (threadId: ThreadId) {
    const records = yield* orchestrator
      .getThreadRecords(threadId, ["providerThreads"])
      .pipe(Effect.mapError(unknownThread(threadId)));
    const providerThread = records.providerThreads.find((candidate) => candidate.cliLoan != null);
    // Deleting a thread closes its terminal and leaves nothing to bring back.
    return providerThread?.cliLoan == null || records.thread.deletedAt !== null
      ? Option.none()
      : Option.some({ thread: records.thread, providerThread, loan: providerThread.cliLoan });
  });

  const start: NativeCliLoan["Service"]["start"] = ({ threadId }) =>
    loans.withLock(
      threadId,
      Effect.gen(function* () {
        const records = yield* orchestrator
          .getThreadRecords(
            threadId,
            ["runs", "providerThreads", "providerSessions", "turnItems"],
            {
              turnItemTypes: Orchestrator.BACKGROUND_WORK_TURN_ITEM_TYPES,
              messageRoles: [],
            },
          )
          .pipe(Effect.mapError(unknownThread(threadId)));
        // These all come before anything is closed or installed, so a refusal costs nothing.
        if (records.thread.archivedAt !== null) {
          return yield* refuse(
            threadId,
            "unavailable",
            "This thread is archived. Unarchive it first.",
          );
        }
        if (records.providerThreads.some((candidate) => candidate.cliLoan != null)) {
          return yield* refuse(
            threadId,
            "out_in_cli",
            "This thread is out in the CLI. Return it to Peer first.",
          );
        }
        const { providerThread, ref } = yield* activeProviderThread(records, threadId);
        if (
          records.runs.some(
            (run) =>
              run.status === "preparing" ||
              run.status === "starting" ||
              run.status === "running" ||
              run.status === "waiting",
          )
        ) {
          return yield* refuse(threadId, "run_active", THREAD_STILL_RUNNING);
        }
        if (Orchestrator.hasBackgroundWorkInProcess(records)) {
          return yield* refuse(threadId, "run_active", Orchestrator.THREAD_BACKGROUND_WORK_MESSAGE);
        }
        const rollingBack = yield* outbox
          .hasUnsettled({ threadId, effectType: "provider-thread.rollback" })
          .pipe(Effect.mapError(unknownThread(threadId)));
        if (rollingBack) {
          return yield* refuse(threadId, "run_active", Orchestrator.THREAD_ROLLING_BACK_MESSAGE);
        }
        if (ref.driver === "claudeAgent" && providerThread.nativeConversationHeadRef !== null) {
          return yield* refuse(
            threadId,
            "rolled_back",
            "This thread was just rolled back. Send one message before leaving.",
          );
        }
        const commands = yield* history
          .commands({ ...ref, modelSelection: records.thread.modelSelection })
          .pipe(Effect.mapError(fromHistoryError(threadId)));
        const cwd = yield* threadCwd(records.thread);
        yield* history
          .prepareContinue({ ...ref, cwd })
          .pipe(Effect.mapError(fromHistoryError(threadId)));

        const liveSession = records.providerSessions.find(
          (session) => session.id === providerThread.providerSessionId,
        );
        if (liveSession !== undefined) yield* closeProviderSession(threadId, liveSession.id);

        // A failure here leaves no loan: the thread only lost a process, and its next turn
        // resumes from disk.
        const session = yield* history
          .read({ ...ref, cwd })
          .pipe(Effect.mapError(fromHistoryError(threadId)));

        const terminalId = `${LOAN_TERMINAL_PREFIX}${yield* nextUuid}`;
        yield* orchestrator
          .dispatch({
            type: "thread.cli-loan.start",
            commandId: yield* nextCommandId("start"),
            threadId,
            providerThreadId: providerThread.id,
            loan: {
              terminalId,
              afterNativeMessageId: session.turns.at(-1)?.nativeMessageId ?? null,
              startedAt: yield* DateTime.now,
            },
          })
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "OrchestratorThreadNotReadyForCliError"
                ? refuse(threadId, "run_active", cause.message, cause)
                : refuse(threadId, "changed", "This thread changed. Try again.", cause),
            ),
          );

        // Codex can make the read wait a minute, and a message sent meanwhile opens a process and
        // moves the session past that position. The dispatch above refuses a run or process it can
        // still see; only with the loan open can nothing else start, so one that came and went
        // shows here.
        const after = yield* orchestrator
          .getThreadRecords(threadId, ["runs"])
          .pipe(Effect.mapError(unknownThread(threadId)));
        if (runsChanged(records.runs, after.runs)) {
          yield* dispatchFinish({ threadId, providerThread, turns: [], gap: "none" }).pipe(
            Effect.mapError(unknownThread(threadId)),
          );
          return yield* refuse(
            threadId,
            "changed",
            "A new turn started in this thread. Try again when it finishes.",
          );
        }
        return {
          terminalId,
          cwd,
          command: commands.continueCommand,
          providerInstanceId: ref.providerInstanceId,
        };
      }),
    );

  const finish: NativeCliLoan["Service"]["finish"] = ({ threadId }) =>
    loans.withLock(
      threadId,
      Effect.gen(function* () {
        const open = yield* readLoan(threadId);
        // The terminal's exit may have got here first.
        if (Option.isNone(open)) return;
        const { thread, providerThread, loan } = open.value;
        const running = yield* terminals.isProcessRunning({
          threadId,
          terminalId: loan.terminalId,
        });
        if (running) {
          return yield* refuse(
            threadId,
            "terminal_busy",
            "The CLI is still running in its terminal. Quit the CLI or close its terminal first.",
          );
        }
        yield* endLoan(thread, providerThread, loan);
      }),
    );

  const fork: NativeCliLoan["Service"]["fork"] = Effect.fn("NativeCliLoan.fork")(function* ({
    threadId,
  }) {
    const records = yield* orchestrator
      .getThreadRecords(threadId, ["providerThreads"])
      .pipe(Effect.mapError(unknownThread(threadId)));
    const { providerThread, ref } = yield* activeProviderThread(records, threadId);
    // Claude rewinds only on the next resume, so a fork now would bring back the removed turns.
    if (ref.driver === "claudeAgent" && providerThread.nativeConversationHeadRef !== null) {
      return yield* refuse(
        threadId,
        "rolled_back",
        "This thread was just rolled back. Send one message before forking it.",
      );
    }
    const commands = yield* history
      .commands({ ...ref, modelSelection: records.thread.modelSelection })
      .pipe(Effect.mapError(fromHistoryError(threadId)));
    const cwd = yield* threadCwd(records.thread);
    return {
      terminalId: `${FORK_TERMINAL_PREFIX}${yield* nextUuid}`,
      cwd,
      command: commands.forkCommand,
      providerInstanceId: ref.providerInstanceId,
    };
  });

  const endOpenLoan = Effect.fn("NativeCliLoan.endOpenLoan")(
    function* (threadId: ThreadId, isThisLoan: (loan: OrchestrationV2CliLoan) => boolean) {
      yield* loans.withLock(
        threadId,
        Effect.gen(function* () {
          const open = yield* readLoan(threadId);
          if (Option.isNone(open) || !isThisLoan(open.value.loan)) return;
          const { thread, providerThread, loan } = open.value;
          yield* endLoan(thread, providerThread, loan);
        }),
      );
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("Could not end a CLI loan", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
  );

  /**
   * A client attaching after a restart opens a plain shell under the loan's terminal id, so the
   * terminal cannot say whether the CLI is gone. Only the server's own start can. The time keeps a
   * loan begun after this server came up out of it.
   */
  const endLoansOfPreviousServer = Effect.gen(function* () {
    const startedBefore = yield* DateTime.now;
    const threadIds = yield* projections.getThreadIdsWithOpenCliLoan();
    yield* Effect.forEach(
      threadIds,
      (threadId) =>
        endOpenLoan(threadId, (loan) => DateTime.isLessThan(loan.startedAt, startedBefore)),
      { concurrency: RESTART_READ_CONCURRENCY, discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logWarning("Could not list the CLI loans a restart ended", {
            cause: Cause.pretty(cause),
          }),
    ),
  );

  /**
   * The continue command replaces the shell, so these four are every way the CLI can end. They are
   * facts about the terminal's process; what a shell does while it starts never looks like them. A
   * restart stops the process without an exit event, and only the raw stream tells it from a start.
   */
  const observeTerminal = (event: TerminalEvent) =>
    Effect.suspend((): Effect.Effect<void> => {
      if (!event.terminalId.startsWith(LOAN_TERMINAL_PREFIX)) return Effect.void;
      switch (event.type) {
        case "exited":
        case "error":
        case "closed":
        case "restarted":
          // Reading the session takes seconds and the terminal manager awaits its listeners.
          return endOpenLoan(
            event.threadId as ThreadId,
            (loan) => loan.terminalId === event.terminalId,
          ).pipe(Effect.forkIn(layerScope), Effect.asVoid);
        default:
          return Effect.void;
      }
    });

  const watchTerminals: NativeCliLoan["Service"]["watchTerminals"] = () =>
    Effect.acquireRelease(terminals.subscribe(observeTerminal), (unsubscribe) =>
      Effect.sync(unsubscribe),
    ).pipe(Effect.andThen(forkParked(endLoansOfPreviousServer)));

  return NativeCliLoan.of({ start, finish, fork, watchTerminals });
});

export const layer = Layer.effect(NativeCliLoan, make);
