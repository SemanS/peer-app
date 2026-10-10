import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

/**
 * Runs one Slack action at a time. Its controls wait while it runs, the queries are read again once
 * it succeeded, and a failure stays on screen until the next action.
 */
export function useSlackRun(refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
