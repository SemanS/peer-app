import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { NativeCliTerminalLaunch, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { create } from "zustand";

import { terminalEnvironment } from "../../state/terminal";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  nativeCliFailureTitle,
  releaseUnusedLoan,
  type NativeCliAgent,
  type NativeCliOperation,
} from "./nativeCli.logic";

const INITIAL_TERMINAL_COLS = 120;
const INITIAL_TERMINAL_ROWS = 30;

/**
 * Outlives ChatView and the thread that is on screen: the first continue can install an adapter for
 * minutes, and neither navigating away nor a second click may start it twice.
 */
const useNativeCliOperationStore = create<{
  readonly byThreadKey: Readonly<Record<string, NativeCliOperation>>;
}>(() => ({ byThreadKey: {} }));

function setOperation(threadKey: string, operation: NativeCliOperation | null) {
  useNativeCliOperationStore.setState(({ byThreadKey }) => {
    const { [threadKey]: _finished, ...rest } = byThreadKey;
    return { byThreadKey: operation === null ? rest : { ...rest, [threadKey]: operation } };
  });
}

function reportFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Every step names its thread from the click, not the latest render: the thread on screen can
 * change while the server prepares the terminal, and the loan belongs to the thread it started on.
 */
export function useNativeCliHandoff(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly worktreePath: string | null;
}) {
  const { threadRef, worktreePath } = input;
  const continueInCli = useAtomCommand(threadEnvironment.continueInCli, { reportFailure: false });
  const returnFromCli = useAtomCommand(threadEnvironment.returnFromCli, { reportFailure: false });
  const forkInCli = useAtomCommand(threadEnvironment.forkInCli, { reportFailure: false });
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const canOperate = useAtomValue(
    threadEnvironment.continueInCli.permissionAtom(threadRef?.environmentId ?? null),
  );
  const operation = useNativeCliOperationStore((state) =>
    threadRef === null ? null : (state.byThreadKey[scopedThreadKey(threadRef)] ?? null),
  );

  /**
   * The open comes before the viewport mounts. A viewport attaching first would start the shell
   * without the instance's env, and the open that follows would then restart it.
   */
  const launch = async (ref: ScopedThreadRef, launchInput: NativeCliTerminalLaunch) => {
    const opened = await openTerminal({
      environmentId: ref.environmentId,
      input: {
        threadId: ref.threadId,
        terminalId: launchInput.terminalId,
        cwd: launchInput.cwd,
        ...(worktreePath !== null ? { worktreePath } : {}),
        cols: INITIAL_TERMINAL_COLS,
        rows: INITIAL_TERMINAL_ROWS,
        providerInstanceId: launchInput.providerInstanceId,
      },
    });
    if (opened._tag === "Failure") return opened;
    useTerminalUiStateStore.getState().newTerminal(ref, launchInput.terminalId);
    useTerminalUiStateStore.getState().setTerminalOpen(ref, true);
    return writeTerminal({
      environmentId: ref.environmentId,
      input: {
        threadId: ref.threadId,
        terminalId: launchInput.terminalId,
        data: `${launchInput.command}\r`,
      },
    });
  };

  const start = async (kind: "continue" | "fork", agent: NativeCliAgent) => {
    if (threadRef === null) return;
    const threadKey = scopedThreadKey(threadRef);
    if (useNativeCliOperationStore.getState().byThreadKey[threadKey] !== undefined) return;
    setOperation(threadKey, kind);
    const command = kind === "continue" ? continueInCli : forkInCli;
    const started = await command({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (started._tag === "Failure") {
      setOperation(threadKey, null);
      if (!isAtomCommandInterrupted(started)) {
        reportFailure(nativeCliFailureTitle(kind, agent), squashAtomCommandFailure(started));
      }
      return;
    }
    const launched = await launch(threadRef, started.value);
    if (launched._tag === "Failure") {
      if (!isAtomCommandInterrupted(launched)) {
        reportFailure(nativeCliFailureTitle(kind, agent), squashAtomCommandFailure(launched));
      }
      // No CLI was started, so nothing can end this loan by itself.
      if (kind === "continue") {
        await releaseUnusedLoan({
          closeTerminal: () =>
            closeTerminal({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, terminalId: started.value.terminalId },
            }),
          returnFromCli: () =>
            returnFromCli({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId },
            }),
        });
      }
    }
    setOperation(threadKey, null);
  };

  const finish = async (agent: NativeCliAgent) => {
    if (threadRef === null) return;
    const threadKey = scopedThreadKey(threadRef);
    if (useNativeCliOperationStore.getState().byThreadKey[threadKey] !== undefined) return;
    setOperation(threadKey, "return");
    const returned = await returnFromCli({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    setOperation(threadKey, null);
    if (returned._tag === "Success" || isAtomCommandInterrupted(returned)) return;
    reportFailure(nativeCliFailureTitle("return", agent), squashAtomCommandFailure(returned));
  };

  const showTerminal = (terminalId: string) => {
    if (threadRef === null) return;
    useTerminalUiStateStore
      .getState()
      .ensureTerminal(threadRef, terminalId, { open: true, active: true });
  };

  return { canOperate, operation, start, finish, showTerminal };
}
