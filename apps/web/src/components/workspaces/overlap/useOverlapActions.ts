import {
  PERSON_OVERLAP_RESOLUTION,
  type EnvironmentId,
  type PeerOverlap,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { failureMessage } from "../WorkspaceAccess";

/**
 * What a person can do about an overlap: ask its agents to settle it (with a message for both, or
 * none), or close it themselves once nobody answered. The agents write the agreement.
 */
export function useOverlapActions(environmentId: EnvironmentId, overlap: PeerOverlap) {
  const settle = useAtomCommand(serverEnvironment.peerHubSettleOverlap, { reportFailure: false });
  const resolve = useAtomCommand(serverEnvironment.peerHubResolveOverlap, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const scope = { workspace: overlap.workspace, project: overlap.project, overlap: overlap.id };
  const act = async (
    title: string,
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await action();
      const message = failureMessage(result);
      if (message !== null) {
        toastManager.add(stackedThreadToast({ type: "error", title, description: message }));
      }
      return result._tag === "Success";
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    /** Asks both agents to settle it; true once the hub has the request. */
    ask: (message: string) =>
      act("Could not ask the agents", () =>
        settle({
          environmentId,
          input: { ...scope, ...(message.trim() === "" ? {} : { message: message.trim() }) },
        }),
      ),
    /** Closes it without the agents, once they did not answer. */
    close: () =>
      act("Could not close the overlap", () =>
        resolve({ environmentId, input: { ...scope, resolution: PERSON_OVERLAP_RESOLUTION } }),
      ),
  };
}
