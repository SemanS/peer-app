import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { failureMessage } from "../WorkspaceAccess";

/**
 * Runs one Slack action at a time for a part of the section. Its controls wait while it runs,
 * everything is read again once it succeeded, and a failure stays on screen until the next action.
 * `done` is the line a success leaves; resolves true when the action succeeded.
 */
export function useSlackRun(refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
    done: string | null = null,
  ) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await action();
      const failure = failureMessage(result);
      if (failure !== null) setError(failure);
      if (result._tag === "Failure") return false;
      setMessage(done);
      refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, error, run };
}

export type SlackRun = ReturnType<typeof useSlackRun>["run"];
